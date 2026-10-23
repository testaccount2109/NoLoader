using System.IO.Compression;
using System.Text;

namespace NoLoader.Installer.Core;

public static class SafeZipExtractor
{
    public const int MaximumEntries = 100_000;
    public const long MaximumExpandedBytes = 16L * 1024 * 1024 * 1024;
    private const int DosReparsePoint = 0x400;
    private const int UnixTypeMask = 0xF000;
    private const int UnixSymbolicLink = 0xA000;

    public static bool IsSafeRelativeFilePath(string? value, bool requireExe = false)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Length > 1024 || value.Contains('\\') || value.StartsWith('/') || value.Contains('\0')) return false;
        if (requireExe && !value.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)) return false;
        var segments = value.Split('/');
        if (segments.Any(segment => !IsSafeSegment(segment))) return false;
        return true;
    }

    public static IReadOnlyList<string> Extract(Stream archiveStream, string destination, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(archiveStream);
        var root = Path.GetFullPath(destination);
        Directory.CreateDirectory(root);
        if (Directory.EnumerateFileSystemEntries(root).Any())
            throw new InvalidDataException("The extraction destination must be an empty directory.");

        using var archive = new ZipArchive(archiveStream, ZipArchiveMode.Read, leaveOpen: true);
        if (archive.Entries.Count is 0 or > MaximumEntries)
            throw new InvalidDataException($"The archive must contain between 1 and {MaximumEntries} entries.");

        var entries = ValidateEntries(archive.Entries);
        var expandedTotal = entries.Where(item => !item.IsDirectory).Sum(item => item.Entry.Length);
        if (expandedTotal > MaximumExpandedBytes)
            throw new InvalidDataException("The archive expands beyond the supported size limit.");

        var extractedFiles = new List<string>(entries.Count(item => !item.IsDirectory));
        foreach (var item in entries)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var target = ResolveInside(root, item.RelativePath);
            if (item.IsDirectory)
            {
                Directory.CreateDirectory(target);
                continue;
            }

            Directory.CreateDirectory(Path.GetDirectoryName(target)!);
            using var input = item.Entry.Open();
            using var output = new FileStream(target, FileMode.CreateNew, FileAccess.Write, FileShare.None, 128 * 1024, FileOptions.SequentialScan);
            var buffer = new byte[128 * 1024];
            long written = 0;
            while (true)
            {
                cancellationToken.ThrowIfCancellationRequested();
                var count = input.Read(buffer, 0, buffer.Length);
                if (count == 0) break;
                written = checked(written + count);
                if (written > item.Entry.Length || written > MaximumExpandedBytes)
                    throw new InvalidDataException("An archive entry expands beyond its declared size.");
                output.Write(buffer, 0, count);
            }

            if (written != item.Entry.Length)
                throw new InvalidDataException("An archive entry did not match its declared expanded size.");
            output.Flush(flushToDisk: true);
            extractedFiles.Add(item.RelativePath);
        }

        return extractedFiles;
    }

    private static List<ValidatedEntry> ValidateEntries(IReadOnlyList<ZipArchiveEntry> entries)
    {
        var validated = new List<ValidatedEntry>(entries.Count);
        var paths = new Dictionary<string, PathKind>(StringComparer.OrdinalIgnoreCase);
        foreach (var entry in entries)
        {
            var raw = entry.FullName;
            if (raw.Length == 0 || raw.Length > 1024 || raw.Contains('\\') || raw.StartsWith('/') || raw.Contains('\0'))
                throw new InvalidDataException("The archive contains an absolute, malformed, or platform-ambiguous path.");
            if (entry.Length < 0 || entry.CompressedLength < 0)
                throw new InvalidDataException("The archive contains an entry with an invalid size.");
            if ((entry.ExternalAttributes & DosReparsePoint) != 0 || ((entry.ExternalAttributes >> 16) & UnixTypeMask) == UnixSymbolicLink)
                throw new InvalidDataException("The archive contains a symbolic link or reparse point.");

            var isDirectory = raw.EndsWith("/", StringComparison.Ordinal);
            var candidate = isDirectory ? raw[..^1] : raw;
            if (candidate.Length == 0) throw new InvalidDataException("The archive contains an invalid root entry.");
            var segments = candidate.Split('/').Select(segment => segment.Normalize(NormalizationForm.FormC)).ToArray();
            if (segments.Any(segment => !IsSafeSegment(segment)))
                throw new InvalidDataException("The archive contains a path with an unsafe or invalid Windows filename.");
            if (segments[0].Length >= 2 && char.IsAsciiLetter(segments[0][0]) && segments[0][1] == ':')
                throw new InvalidDataException("The archive contains a drive-qualified path.");

            var normalized = string.Join('/', segments);
            if (normalized.Equals(".noloader-install.json", StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("The archive uses a reserved NoLoader installation metadata path.");
            for (var index = 1; index < segments.Length; index++)
            {
                var parent = string.Join('/', segments.Take(index));
                if (paths.TryGetValue(parent, out var parentKind) && parentKind == PathKind.File)
                    throw new InvalidDataException("The archive contains a file/directory path collision.");
                paths[parent] = PathKind.Directory;
            }

            if (paths.TryGetValue(normalized, out var existingKind))
            {
                if (!isDirectory || existingKind == PathKind.File)
                    throw new InvalidDataException("The archive contains duplicate or colliding paths.");
                if (paths.ContainsKey("@explicit:" + normalized))
                    throw new InvalidDataException("The archive contains duplicate directory entries.");
                paths["@explicit:" + normalized] = PathKind.Directory;
            }
            else
            {
                paths[normalized] = isDirectory ? PathKind.Directory : PathKind.File;
                if (isDirectory) paths["@explicit:" + normalized] = PathKind.Directory;
            }

            validated.Add(new ValidatedEntry(entry, normalized, isDirectory));
        }

        return validated;
    }

    private static bool IsSafeSegment(string segment)
    {
        if (segment.Length is 0 or > 255 || segment is "." or ".." || segment.EndsWith(' ') || segment.EndsWith('.')) return false;
        if (segment.Any(character => char.IsControl(character) || character is '<' or '>' or ':' or '"' or '|' or '?' or '*' or '\\' or '/')) return false;
        var deviceBase = segment.Split('.')[0];
        if (IsReservedDeviceName(deviceBase)) return false;
        return true;
    }

    private static bool IsReservedDeviceName(string name)
    {
        var upper = name.ToUpperInvariant();
        if (upper is "CON" or "PRN" or "AUX" or "NUL" or "CLOCK$" or "CONIN$" or "CONOUT$") return true;
        if (upper.Length == 4 && (upper.StartsWith("COM", StringComparison.Ordinal) || upper.StartsWith("LPT", StringComparison.Ordinal)))
        {
            var suffix = upper[3];
            return suffix is >= '1' and <= '9' or '¹' or '²' or '³';
        }
        return false;
    }

    private static string ResolveInside(string root, string relativePath)
    {
        var nativeRelative = relativePath.Replace('/', Path.DirectorySeparatorChar);
        var target = Path.GetFullPath(Path.Combine(root, nativeRelative));
        var prefix = root.EndsWith(Path.DirectorySeparatorChar) ? root : root + Path.DirectorySeparatorChar;
        if (!target.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("An archive entry resolves outside the extraction directory.");
        return target;
    }

    private enum PathKind { File, Directory }
    private sealed record ValidatedEntry(ZipArchiveEntry Entry, string RelativePath, bool IsDirectory);
}
