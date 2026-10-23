namespace NoLoader.Installer.Core;

public sealed record ReleaseCatalog(
    int SchemaVersion,
    string ProductId,
    DateTimeOffset GeneratedAtUtc,
    DateTimeOffset ExpiresAtUtc,
    IReadOnlyList<VerifiedLauncherRelease> Releases);

public sealed class VerifiedLauncherRelease
{
    internal VerifiedLauncherRelease(LauncherRelease descriptor)
    {
        Version = descriptor.Version;
        Channel = descriptor.Channel;
        UpstreamCommit = descriptor.UpstreamCommit;
        CoreVersion = descriptor.CoreVersion;
        ApiVersion = descriptor.ApiVersion;
        Platform = descriptor.Platform;
        Architecture = descriptor.Architecture;
        MinimumInstallerVersion = descriptor.MinimumInstallerVersion;
        LauncherExecutable = descriptor.LauncherExecutable;
        Archive = descriptor.Archive;
    }

    public string Version { get; }
    public string Channel { get; }
    public string UpstreamCommit { get; }
    public string CoreVersion { get; }
    public string ApiVersion { get; }
    public string Platform { get; }
    public string Architecture { get; }
    public string MinimumInstallerVersion { get; }
    public string LauncherExecutable { get; }
    public ReleaseArchive Archive { get; }
}

public sealed record LauncherRelease(
    string Version,
    string Channel,
    string UpstreamCommit,
    string CoreVersion,
    string ApiVersion,
    string Platform,
    string Architecture,
    string MinimumInstallerVersion,
    string LauncherExecutable,
    ReleaseArchive Archive);

public sealed record ReleaseArchive(string Format, string Url, string Sha256, long SizeBytes);

public sealed record DownloadProgress(long BytesReceived, long ExpectedBytes)
{
    public double Fraction => ExpectedBytes > 0
        ? Math.Clamp((double)BytesReceived / ExpectedBytes, 0, 1)
        : 0;
}

public sealed record InstallResult(string Directory, VerifiedLauncherRelease Release, string? PreviousVersion);

public sealed record UninstallResult(string Directory, int RemovedFiles, int PreservedFiles);

public sealed record InstalledLauncher(string Version, string Channel, string LauncherExecutable, string UpstreamCommit);

public sealed class NoLoaderInstallException(string message, Exception? innerException = null)
    : Exception(message, innerException);
