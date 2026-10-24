using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace NoLoader.Installer.Core;

public sealed class LauncherInstallCoordinator(SignedReleaseProvider? releases = null)
{
    public const string InstallerVersion = "1.0.5";
    private const string MarkerName = ".noloader-install.json";
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = false,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
        WriteIndented = true,
        MaxDepth = 16
    };

    public static VerifiedLauncherRelease SelectRelease(ReleaseCatalog catalog, string channel)
    {
        if (channel is not ("stable" or "beta")) throw new ArgumentOutOfRangeException(nameof(channel));
        var installerVersion = SemanticVersion.Parse(InstallerVersion);
        var candidates = catalog.Releases
            .Where(release => release.Platform == "windows" && release.Architecture == "x64")
            .Where(release => release.Channel == channel)
            .Where(release => SemanticVersion.Parse(release.MinimumInstallerVersion).CompareTo(installerVersion) <= 0)
            .OrderByDescending(release => SemanticVersion.Parse(release.Version))
            .ToArray();
        return candidates.FirstOrDefault()
            ?? throw new NoLoaderInstallException($"No Windows x64 release is available for the {channel} channel and this installer version.");
    }

    public static string GetDefaultInstallDirectory() => NoLoaderInstallPaths.FindExistingLauncherDirectory() ?? string.Empty;

    public async Task<InstallResult> InstallAsync(
        VerifiedLauncherRelease release,
        string installDirectory,
        bool confirmReplaceExistingInstallation,
        IProgress<DownloadProgress>? downloadProgress = null,
        IProgress<string>? status = null,
        CancellationToken cancellationToken = default)
    {
        var signedReleases = releases ?? throw new NoLoaderInstallException("The signed release source is not configured.");
        ValidateSelectedRelease(release);
        return await InstallArchiveAsync(
            release,
            installDirectory,
            confirmReplaceExistingInstallation,
            (archivePath, progress, token) => signedReleases.DownloadAndVerifyAsync(release, archivePath, progress, token),
            "Downloading and verifying the signed launcher artifact",
            downloadProgress,
            status,
            cancellationToken).ConfigureAwait(false);
    }

    private async Task<InstallResult> InstallArchiveAsync(
        VerifiedLauncherRelease release,
        string installDirectory,
        bool confirmReplaceExistingInstallation,
        Func<string, IProgress<DownloadProgress>?, CancellationToken, Task> acquireArchive,
        string acquireStatus,
        IProgress<DownloadProgress>? downloadProgress,
        IProgress<string>? status,
        CancellationToken cancellationToken)
    {
        ValidateSelectedRelease(release);
        var target = NormalizeTarget(installDirectory);
        var parent = Path.GetDirectoryName(target)!;
        RejectReparseAncestors(parent);
        Directory.CreateDirectory(parent);
        using var installLock = AcquireInstallLock(parent, target);

        var oldMarker = await InspectExistingTargetAsync(target, confirmReplaceExistingInstallation, cancellationToken).ConfigureAwait(false);
        if (oldMarker?.Version == release.Version)
            status?.Report($"Repairing NoLoader Launcher {release.Version}");

        var id = Guid.NewGuid().ToString("N");
        var archivePath = Path.Combine(parent, $".noloader-download-{id}.zip");
        var stagingPath = Path.Combine(parent, $".noloader-stage-{id}");
        string? previousPath = null;
        string? previousVersion = oldMarker?.Version;
        try
        {
            cancellationToken.ThrowIfCancellationRequested();
            status?.Report(acquireStatus);
            await acquireArchive(archivePath, downloadProgress, cancellationToken).ConfigureAwait(false);

            cancellationToken.ThrowIfCancellationRequested();
            status?.Report("Safely extracting the verified launcher");
            Directory.CreateDirectory(stagingPath);
            IReadOnlyList<string> ownedFiles;
            await using (var archive = new FileStream(archivePath, FileMode.Open, FileAccess.Read, FileShare.Read, 128 * 1024, FileOptions.Asynchronous | FileOptions.SequentialScan))
            {
                ownedFiles = SafeZipExtractor.Extract(archive, stagingPath, cancellationToken);
            }
            if (!ownedFiles.Contains(release.LauncherExecutable, StringComparer.OrdinalIgnoreCase))
                throw new NoLoaderInstallException("The signed archive does not contain its declared launcher executable.");

            cancellationToken.ThrowIfCancellationRequested();
            status?.Report(oldMarker is null
                ? "Preserving compatible files; files that conflict with NoLoader remain in the original backup"
                : "Preserving files outside the previous launcher release");
            if (Directory.Exists(target))
                PreserveUnownedFiles(target, stagingPath, oldMarker?.OwnedFiles ?? ownedFiles, skipReleaseConflicts: oldMarker is null);
            cancellationToken.ThrowIfCancellationRequested();

            var targetExists = Directory.Exists(target);
            if (File.Exists(target)) throw new NoLoaderInstallException("The selected install path is a file.");
            if (targetExists) previousPath = UniqueBackupPath(target, id);
            var originalBackupDirectory = oldMarker?.OriginalBackupDirectory;
            if (originalBackupDirectory is null && oldMarker is not null)
                originalBackupDirectory = FindOriginalBackupDirectory(target, oldMarker);
            if (originalBackupDirectory is null && oldMarker is null && targetExists && Directory.EnumerateFileSystemEntries(target).Any())
                originalBackupDirectory = Path.GetFileName(previousPath);

            var marker = CreateMarker(release, ownedFiles, originalBackupDirectory);
            await File.WriteAllTextAsync(Path.Combine(stagingPath, MarkerName), JsonSerializer.Serialize(marker, JsonOptions), cancellationToken).ConfigureAwait(false);
            FlushFile(Path.Combine(stagingPath, MarkerName));

            cancellationToken.ThrowIfCancellationRequested();
            status?.Report("Preparing the installation swap");
            if (targetExists)
            {
                Directory.Move(target, previousPath!);
            }

            try
            {
                Directory.Move(stagingPath, target);
            }
            catch (Exception installException)
            {
                if (previousPath is not null && Directory.Exists(previousPath) && !Directory.Exists(target))
                {
                    try
                    {
                        Directory.Move(previousPath, target);
                        previousPath = null;
                    }
                    catch (Exception rollbackException)
                    {
                        throw new NoLoaderInstallException(
                            $"The installation swap failed and the previous launcher could not be restored. Its files remain at '{previousPath}'.",
                            new AggregateException(installException, rollbackException));
                    }
                }
                throw new NoLoaderInstallException("The new launcher could not be activated. The previous installation was restored.", installException);
            }

            status?.Report(previousPath is null ? "Installation complete" : "Update complete; the previous files were kept as a rollback copy");
            return new InstallResult(target, release, previousVersion);
        }
        catch (OperationCanceledException)
        {
            status?.Report("Installation cancelled. The active installation was left unchanged.");
            throw;
        }
        catch (NoLoaderInstallException)
        {
            throw;
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or JsonException)
        {
            throw new NoLoaderInstallException("The launcher could not be installed safely. Check the selected folder and available disk space.", exception);
        }
        finally
        {
            TryDeleteFile(archivePath);
            TryDeleteDirectory(stagingPath);
        }
    }

    public static async Task<UninstallResult> UninstallAsync(string installDirectory, CancellationToken cancellationToken = default)
    {
        var target = NormalizeTarget(installDirectory);
        var parent = Path.GetDirectoryName(target)!;
        RejectReparseAncestors(parent);
        using var installLock = AcquireInstallLock(parent, target);
        cancellationToken.ThrowIfCancellationRequested();
        var marker = await ReadMarkerAsync(target, cancellationToken).ConfigureAwait(false)
            ?? throw new NoLoaderInstallException("This folder is not a managed NoLoader Launcher installation.");
        var entries = EnumerateTree(target);
        var ownedFiles = new HashSet<string>(marker.OwnedFiles, StringComparer.OrdinalIgnoreCase);
        var removed = 0;
        var preserved = 0;
        foreach (var entry in entries.Files)
        {
            if (entry.RelativePath.Equals(MarkerName, StringComparison.OrdinalIgnoreCase)) continue;
            if (ownedFiles.Contains(entry.RelativePath))
            {
                File.Delete(entry.FullPath);
                removed++;
            }
            else
            {
                preserved++;
            }
        }

        File.Delete(Path.Combine(target, MarkerName));
        removed++;
        foreach (var directory in entries.Directories.OrderByDescending(path => path.Length))
        {
            if (Directory.Exists(directory))
            {
                try { Directory.Delete(directory, recursive: false); }
                catch (IOException) { }
            }
        }
        if (Directory.Exists(target) && !Directory.EnumerateFileSystemEntries(target).Any()) Directory.Delete(target);
        return new UninstallResult(target, removed, preserved);
    }

    public static async Task<string?> FindOriginalLauncherBackupAsync(string installDirectory, CancellationToken cancellationToken = default)
    {
        var target = NormalizeTarget(installDirectory);
        var marker = await ReadMarkerAsync(target, cancellationToken).ConfigureAwait(false);
        return marker is null ? null : FindOriginalBackupDirectory(target, marker);
    }

    public static async Task<RestoreResult> RestoreOriginalLauncherAsync(string installDirectory, CancellationToken cancellationToken = default)
    {
        var target = NormalizeTarget(installDirectory);
        var parent = Path.GetDirectoryName(target)!;
        RejectReparseAncestors(parent);
        using var installLock = AcquireInstallLock(parent, target);
        cancellationToken.ThrowIfCancellationRequested();

        var marker = await ReadMarkerAsync(target, cancellationToken).ConfigureAwait(false)
            ?? throw new NoLoaderInstallException("This folder is not a managed NoLoader Launcher installation.");
        var currentTree = EnumerateTree(target);
        _ = SafeDestination(target, marker.LauncherExecutable);
        if (!currentTree.Files.Any(file => file.RelativePath.Equals(marker.LauncherExecutable, StringComparison.OrdinalIgnoreCase)))
            throw new NoLoaderInstallException("The active NoLoader launcher executable is missing. Repair it before restoring the original launcher.");

        var originalPath = FindOriginalBackupDirectory(target, marker)
            ?? throw new NoLoaderInstallException("The original NoRisk Launcher backup could not be found. No files were moved.");
        var id = Guid.NewGuid().ToString("N");
        var currentPath = target + $".noloader-current-{DateTimeOffset.UtcNow:yyyyMMddHHmmss}-{id}";
        Directory.Move(target, currentPath);
        try
        {
            Directory.Move(originalPath, target);
        }
        catch (Exception restoreException)
        {
            try
            {
                Directory.Move(currentPath, target);
            }
            catch (Exception rollbackException)
            {
                throw new NoLoaderInstallException(
                    $"The original launcher could not be activated and the NoLoader folder could not be moved back. Its files remain at '{currentPath}'.",
                    new AggregateException(restoreException, rollbackException));
            }
            throw new NoLoaderInstallException("The original launcher could not be restored. The active NoLoader launcher was put back.", restoreException);
        }

        return new RestoreResult(target, currentPath);
    }

    public static async Task<InstalledLauncher?> ReadInstalledReleaseAsync(string installDirectory, CancellationToken cancellationToken = default)
    {
        var target = NormalizeTarget(installDirectory);
        var marker = await ReadMarkerAsync(target, cancellationToken).ConfigureAwait(false);
        if (marker is null) return null;
        return new InstalledLauncher(marker.Version, marker.Channel, marker.LauncherExecutable, marker.UpstreamCommit);
    }

    private static void ValidateSelectedRelease(VerifiedLauncherRelease release)
    {
        if (!SemanticVersion.TryParse(release.Version, out _) || !SemanticVersion.TryParse(release.MinimumInstallerVersion, out _) ||
            !SemanticVersion.TryParse(release.CoreVersion, out _) || !SemanticVersion.TryParse(release.ApiVersion, out _))
            throw new NoLoaderInstallException("The selected release has an invalid version.");
        if (release.Platform != "windows" || release.Architecture != "x64" || release.Archive.Format != "zip" ||
            !Uri.TryCreate(release.Archive.Url, UriKind.Absolute, out var artifactUri) || artifactUri.Scheme != Uri.UriSchemeHttps ||
            !SafeZipExtractor.IsSafeRelativeFilePath(release.LauncherExecutable, requireExe: true))
            throw new NoLoaderInstallException("The selected release is not a supported Windows x64 launcher release.");
        if (release.Archive.SizeBytes is <= 0 or > ReleaseCatalogVerifier.MaximumArchiveBytes || release.Archive.Sha256.Length != 64 || !release.Archive.Sha256.All(Uri.IsHexDigit))
            throw new NoLoaderInstallException("The selected release has invalid integrity metadata.");
    }

    private static async Task<InstallMarker?> InspectExistingTargetAsync(string target, bool confirmReplace, CancellationToken cancellationToken)
    {
        if (File.Exists(target)) throw new NoLoaderInstallException("The selected install path is a file.");
        if (!Directory.Exists(target)) return null;
        RejectReparsePoint(target);
        if (!Directory.EnumerateFileSystemEntries(target).Any()) return null;
        if (!confirmReplace)
            throw new NoLoaderInstallException("Replacing the existing launcher files requires explicit confirmation.");
        var markerPath = Path.Combine(target, MarkerName);
        if (!File.Exists(markerPath)) return null;
        return await ReadMarkerAsync(target, cancellationToken).ConfigureAwait(false)
            ?? throw new NoLoaderInstallException("The existing NoLoader installation metadata is missing.");
    }

    private static InstallMarker CreateMarker(VerifiedLauncherRelease release, IReadOnlyList<string> ownedFiles, string? originalBackupDirectory) => new(
        1, ReleaseCatalogVerifier.ProductId, release.Version, release.Channel, release.UpstreamCommit,
        release.CoreVersion, release.ApiVersion, release.MinimumInstallerVersion, release.LauncherExecutable,
        ownedFiles.Order(StringComparer.OrdinalIgnoreCase).ToList(), originalBackupDirectory);

    private static async Task<InstallMarker?> ReadMarkerAsync(string target, CancellationToken cancellationToken)
    {
        if (!Directory.Exists(target)) return null;
        RejectReparsePoint(target);
        var markerPath = Path.Combine(target, MarkerName);
        if (!File.Exists(markerPath)) return null;
        RejectReparsePoint(markerPath);
        var info = new FileInfo(markerPath);
        if (info.Length is <= 0 or > 4 * 1024 * 1024) throw new NoLoaderInstallException("The existing install metadata has an invalid size.");
        await using var stream = new FileStream(markerPath, FileMode.Open, FileAccess.Read, FileShare.Read, 16 * 1024, FileOptions.Asynchronous | FileOptions.SequentialScan);
        using var document = await JsonDocument.ParseAsync(stream, new JsonDocumentOptions { MaxDepth = 16 }, cancellationToken).ConfigureAwait(false);
        EnsureNoDuplicates(document.RootElement);
        var marker = document.RootElement.Deserialize<InstallMarker>(JsonOptions)
            ?? throw new NoLoaderInstallException("The existing install metadata is invalid.");
        if (marker.SchemaVersion != 1 || marker.ProductId != ReleaseCatalogVerifier.ProductId ||
            !SemanticVersion.TryParse(marker.Version, out _) || !SemanticVersion.TryParse(marker.MinimumInstallerVersion, out _) ||
            !SemanticVersion.TryParse(marker.CoreVersion, out _) || !SemanticVersion.TryParse(marker.ApiVersion, out _) ||
            marker.Channel is not ("stable" or "beta") || marker.UpstreamCommit.Length is < 7 or > 64 || !marker.UpstreamCommit.All(Uri.IsHexDigit) ||
            !SafeZipExtractor.IsSafeRelativeFilePath(marker.LauncherExecutable, requireExe: true) ||
            marker.OwnedFiles is null || marker.OwnedFiles.Count > SafeZipExtractor.MaximumEntries ||
            (marker.OriginalBackupDirectory is not null &&
             (Path.GetFileName(marker.OriginalBackupDirectory) != marker.OriginalBackupDirectory ||
              !marker.OriginalBackupDirectory.StartsWith(Path.GetFileName(target) + ".noloader-backup-", StringComparison.OrdinalIgnoreCase))))
            throw new NoLoaderInstallException("The existing install metadata is not a valid NoLoader record.");

        var owned = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var file in marker.OwnedFiles)
        {
            if (!SafeZipExtractor.IsSafeRelativeFilePath(file) || file.Equals(MarkerName, StringComparison.OrdinalIgnoreCase) || !owned.Add(file))
                throw new NoLoaderInstallException("The existing install metadata contains an invalid owned-file path.");
        }
        return marker;
    }

    private static string? FindOriginalBackupDirectory(string target, InstallMarker marker)
    {
        var backupName = marker.OriginalBackupDirectory;
        if (string.IsNullOrWhiteSpace(backupName)) return null;
        var parent = Path.GetDirectoryName(target)!;
        var backupPath = Path.GetFullPath(Path.Combine(parent, backupName));
        if (!string.Equals(Path.GetDirectoryName(backupPath), parent, StringComparison.OrdinalIgnoreCase) || !Directory.Exists(backupPath)) return null;
        RejectReparsePoint(backupPath);
        var backupTree = EnumerateTree(backupPath);
        if (backupTree.Files.Any(file => file.RelativePath.Equals(MarkerName, StringComparison.OrdinalIgnoreCase))) return null;
        return backupTree.Files.Any(file => file.RelativePath.Equals(marker.LauncherExecutable, StringComparison.OrdinalIgnoreCase))
            ? backupPath
            : null;
    }

    private static void EnsureNoDuplicates(JsonElement element)
    {
        if (element.ValueKind == JsonValueKind.Object)
        {
            var properties = new HashSet<string>(StringComparer.Ordinal);
            foreach (var property in element.EnumerateObject())
            {
                if (!properties.Add(property.Name)) throw new NoLoaderInstallException("The existing install metadata contains duplicate fields.");
                EnsureNoDuplicates(property.Value);
            }
        }
        else if (element.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in element.EnumerateArray()) EnsureNoDuplicates(item);
        }
    }

    private static void PreserveUnownedFiles(string currentTarget, string staging, IReadOnlyList<string> ownedFiles, bool skipReleaseConflicts)
    {
        var owned = new HashSet<string>(ownedFiles, StringComparer.OrdinalIgnoreCase);
        var oldTree = EnumerateTree(currentTarget);
        foreach (var directory in oldTree.Directories)
        {
            var relative = NormalizeRelative(Path.GetRelativePath(currentTarget, directory));
            var destination = SafeDestination(staging, relative);
            if (HasFileInPath(staging, relative))
            {
                if (skipReleaseConflicts) continue;
                throw new NoLoaderInstallException($"The update would replace an unrecognized file at '{relative}'. Move or rename that file, then retry.");
            }
            Directory.CreateDirectory(destination);
        }

        foreach (var file in oldTree.Files)
        {
            if (file.RelativePath.Equals(MarkerName, StringComparison.OrdinalIgnoreCase) || owned.Contains(file.RelativePath)) continue;
            var destination = SafeDestination(staging, file.RelativePath);
            if (File.Exists(destination) || Directory.Exists(destination))
            {
                if (skipReleaseConflicts) continue;
                throw new NoLoaderInstallException($"The update would replace an unrecognized file at '{file.RelativePath}'. Move or rename that file, then retry.");
            }
            if (HasFileInPath(staging, file.RelativePath))
            {
                if (skipReleaseConflicts) continue;
                throw new NoLoaderInstallException($"The update would replace an unrecognized file at '{file.RelativePath}'. Move or rename that file, then retry.");
            }
            Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
            File.Copy(file.FullPath, destination, overwrite: false);
        }
    }

    private static bool HasFileInPath(string root, string relative)
    {
        var current = Path.GetFullPath(root);
        foreach (var segment in relative.Split('/'))
        {
            current = Path.Combine(current, segment);
            if (File.Exists(current)) return true;
        }
        return false;
    }

    private static TreeSnapshot EnumerateTree(string root)
    {
        var files = new List<TreeFile>();
        var directories = new List<string>();
        var pending = new Stack<string>();
        pending.Push(root);
        while (pending.TryPop(out var directory))
        {
            foreach (var item in Directory.EnumerateFileSystemEntries(directory))
            {
                RejectReparsePoint(item);
                var attributes = File.GetAttributes(item);
                if ((attributes & FileAttributes.Directory) != 0)
                {
                    directories.Add(item);
                    pending.Push(item);
                }
                else
                {
                    var relative = NormalizeRelative(Path.GetRelativePath(root, item));
                    files.Add(new TreeFile(item, relative));
                }
            }
        }
        return new TreeSnapshot(files, directories);
    }

    private static string NormalizeRelative(string relative) => relative.Replace(Path.DirectorySeparatorChar, '/').Replace(Path.AltDirectorySeparatorChar, '/');

    private static string SafeDestination(string root, string relative)
    {
        if (!SafeZipExtractor.IsSafeRelativeFilePath(relative))
            throw new NoLoaderInstallException("An existing installation contains an unsafe file path.");
        var fullRoot = Path.GetFullPath(root);
        var target = Path.GetFullPath(Path.Combine(fullRoot, relative.Replace('/', Path.DirectorySeparatorChar)));
        var prefix = fullRoot.EndsWith(Path.DirectorySeparatorChar) ? fullRoot : fullRoot + Path.DirectorySeparatorChar;
        if (!target.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
            throw new NoLoaderInstallException("An existing file resolves outside the selected install directory.");
        return target;
    }

    private static string NormalizeTarget(string installDirectory)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(installDirectory);
        var target = Path.GetFullPath(installDirectory.Trim());
        var root = Path.GetPathRoot(target);
        if (string.IsNullOrEmpty(root) || string.Equals(target.TrimEnd(Path.DirectorySeparatorChar), root.TrimEnd(Path.DirectorySeparatorChar), StringComparison.OrdinalIgnoreCase))
            throw new NoLoaderInstallException("Choose a dedicated folder. A drive root cannot be used as the launcher install directory.");
        return target.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
    }

    private static FileStream AcquireInstallLock(string parent, string target)
    {
        var identity = Convert.ToHexString(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(target.ToUpperInvariant())))[..16];
        var lockPath = Path.Combine(parent, $".noloader-install-{identity}.lock");
        try
        {
            return new FileStream(lockPath, FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None, 1, FileOptions.DeleteOnClose);
        }
        catch (IOException exception)
        {
            throw new NoLoaderInstallException("Another NoLoader install or update is already using this folder.", exception);
        }
    }

    private static string UniqueBackupPath(string target, string id) => target + $".noloader-backup-{DateTimeOffset.UtcNow:yyyyMMddHHmmss}-{id}";

    private static void RejectReparsePoint(string path)
    {
        var attributes = File.GetAttributes(path);
        if ((attributes & FileAttributes.ReparsePoint) != 0)
            throw new NoLoaderInstallException("Symbolic links and reparse points are not supported in the managed installation.");
    }

    private static void RejectReparseAncestors(string path)
    {
        var fullPath = Path.GetFullPath(path);
        var root = Path.GetPathRoot(fullPath) ?? throw new NoLoaderInstallException("The install parent path is invalid.");
        var current = root;
        foreach (var segment in fullPath[root.Length..].Split([Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar], StringSplitOptions.RemoveEmptyEntries))
        {
            current = Path.Combine(current, segment);
            if (Directory.Exists(current) || File.Exists(current)) RejectReparsePoint(current);
        }
    }

    private static void FlushFile(string path)
    {
        using var file = new FileStream(path, FileMode.Open, FileAccess.ReadWrite, FileShare.Read);
        file.Flush(flushToDisk: true);
    }

    private static void TryDeleteFile(string path)
    {
        try { if (File.Exists(path)) File.Delete(path); } catch (IOException) { } catch (UnauthorizedAccessException) { }
    }

    private static void TryDeleteDirectory(string path)
    {
        try { if (Directory.Exists(path)) Directory.Delete(path, recursive: true); } catch (IOException) { } catch (UnauthorizedAccessException) { }
    }

    private sealed record InstallMarker(
        int SchemaVersion,
        string ProductId,
        string Version,
        string Channel,
        string UpstreamCommit,
        string CoreVersion,
        string ApiVersion,
        string MinimumInstallerVersion,
        string LauncherExecutable,
        List<string> OwnedFiles,
        string? OriginalBackupDirectory = null);

    private sealed record TreeFile(string FullPath, string RelativePath);
    private sealed record TreeSnapshot(List<TreeFile> Files, List<string> Directories);
}

public sealed record RestoreResult(string RestoredDirectory, string PreservedNoLoaderDirectory);
