using System.Security.Cryptography;
using NoLoader.Installer.Core;

namespace NoLoader.Installer.Tests;

public sealed class LauncherInstallCoordinatorTests
{
    [Fact]
    public async Task InstallsOnlyTheSignedVerifiedArchive()
    {
        using var key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var archive = InstallerTestFixture.CreateArchive("verified launcher");
        var descriptor = InstallerTestFixture.CreateRelease(archive);
        using var provider = InstallerTestFixture.CreateProvider(key, [(descriptor, archive)]);
        var catalog = await provider.GetCatalogAsync(TestContext.Current.CancellationToken);
        var target = Path.Combine(InstallerTestFixture.TemporaryDirectory(), "managed", "Launcher");
        try
        {
            var result = await new LauncherInstallCoordinator(provider).InstallAsync(
                catalog.Releases[0], target, confirmReplaceExistingInstallation: false,
                cancellationToken: TestContext.Current.CancellationToken);

            Assert.Equal(descriptor.Version, result.Release.Version);
            Assert.Equal("verified launcher", await File.ReadAllTextAsync(Path.Combine(target, "bin", "NoLoader.exe"), TestContext.Current.CancellationToken));
            var installed = await LauncherInstallCoordinator.ReadInstalledReleaseAsync(target, TestContext.Current.CancellationToken);
            Assert.Equal(descriptor.Version, installed?.Version);
        }
        finally { DeleteParent(target); }
    }

    [Fact]
    public async Task UpdatesKeepUnrecognizedFilesAndLeaveARollbackCopy()
    {
        using var key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var oldArchive = InstallerTestFixture.CreateArchive("old launcher");
        var newArchive = InstallerTestFixture.CreateArchive("new launcher");
        var oldRelease = InstallerTestFixture.CreateRelease(oldArchive, "1.0.0");
        var newRelease = InstallerTestFixture.CreateRelease(newArchive, "1.1.0");
        using var provider = InstallerTestFixture.CreateProvider(key, [(oldRelease, oldArchive), (newRelease, newArchive)]);
        var catalog = await provider.GetCatalogAsync(TestContext.Current.CancellationToken);
        var selected = LauncherInstallCoordinator.SelectRelease(catalog, "stable");
        var target = Path.Combine(InstallerTestFixture.TemporaryDirectory(), "Launcher");
        var coordinator = new LauncherInstallCoordinator(provider);
        try
        {
            await coordinator.InstallAsync(catalog.Releases.Single(item => item.Version == "1.0.0"), target, false,
                cancellationToken: TestContext.Current.CancellationToken);
            Directory.CreateDirectory(Path.Combine(target, "profiles"));
            await File.WriteAllTextAsync(Path.Combine(target, "profiles", "local.json"), "keep-me", TestContext.Current.CancellationToken);

            var result = await coordinator.InstallAsync(selected, target, true, cancellationToken: TestContext.Current.CancellationToken);

            Assert.Equal("1.0.0", result.PreviousVersion);
            Assert.Equal("new launcher", await File.ReadAllTextAsync(Path.Combine(target, "bin", "NoLoader.exe"), TestContext.Current.CancellationToken));
            Assert.Equal("keep-me", await File.ReadAllTextAsync(Path.Combine(target, "profiles", "local.json"), TestContext.Current.CancellationToken));
            Assert.Single(Directory.GetDirectories(Path.GetDirectoryName(target)!, Path.GetFileName(target) + ".noloader-backup-*"));
        }
        finally { DeleteParent(target); }
    }

    [Fact]
    public async Task RefusesToReplaceAnExistingLauncherFolderWithoutConfirmation()
    {
        using var key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var archive = InstallerTestFixture.CreateArchive();
        var release = InstallerTestFixture.CreateRelease(archive);
        using var provider = InstallerTestFixture.CreateProvider(key, [(release, archive)]);
        var catalog = await provider.GetCatalogAsync(TestContext.Current.CancellationToken);
        var parent = InstallerTestFixture.TemporaryDirectory();
        var target = Path.Combine(parent, "existing");
        Directory.CreateDirectory(target);
        var userFile = Path.Combine(target, "notes.txt");
        await File.WriteAllTextAsync(userFile, "keep", TestContext.Current.CancellationToken);

        try
        {
            await Assert.ThrowsAsync<NoLoaderInstallException>(() => new LauncherInstallCoordinator(provider).InstallAsync(
                catalog.Releases[0], target, confirmReplaceExistingInstallation: false,
                cancellationToken: TestContext.Current.CancellationToken));
            Assert.Equal("keep", await File.ReadAllTextAsync(userFile, TestContext.Current.CancellationToken));
        }
        finally { Directory.Delete(parent, recursive: true); }
    }

    [Fact]
    public async Task ReplacesExistingLauncherFolderAfterConfirmationAndKeepsCompleteBackup()
    {
        using var key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        const string launcherExecutable = "noriskclient-launcher-v3.exe";
        var archive = InstallerTestFixture.CreateArchive("NoLoader launcher files", launcherExecutable);
        var updatedArchive = InstallerTestFixture.CreateArchive("Updated NoLoader launcher files", launcherExecutable);
        var release = InstallerTestFixture.CreateRelease(archive, "1.0.0", launcherExecutable: launcherExecutable);
        var updatedRelease = InstallerTestFixture.CreateRelease(updatedArchive, "1.1.0", launcherExecutable: launcherExecutable);
        using var provider = InstallerTestFixture.CreateProvider(key, [(release, archive), (updatedRelease, updatedArchive)]);
        var catalog = await provider.GetCatalogAsync(TestContext.Current.CancellationToken);
        var parent = InstallerTestFixture.TemporaryDirectory();
        var target = Path.Combine(parent, "NoRisk Launcher");
        Directory.CreateDirectory(target);
        await File.WriteAllTextAsync(Path.Combine(target, launcherExecutable), "original launcher", TestContext.Current.CancellationToken);
        await File.WriteAllTextAsync(Path.Combine(target, "launcher-settings.json"), "original settings", TestContext.Current.CancellationToken);
        await File.WriteAllTextAsync(Path.Combine(target, "uninstall.exe"), "original uninstaller", TestContext.Current.CancellationToken);
        Directory.CreateDirectory(Path.Combine(target, "licenses"));
        await File.WriteAllTextAsync(Path.Combine(target, "licenses", "upstream.txt"), "upstream notice", TestContext.Current.CancellationToken);

        try
        {
            var result = await new LauncherInstallCoordinator(provider).InstallAsync(
                catalog.Releases.Single(item => item.Version == release.Version), target, confirmReplaceExistingInstallation: true,
                cancellationToken: TestContext.Current.CancellationToken);

            Assert.Equal("NoLoader launcher files", await File.ReadAllTextAsync(Path.Combine(target, launcherExecutable), TestContext.Current.CancellationToken));
            Assert.Equal("original uninstaller", await File.ReadAllTextAsync(Path.Combine(target, "uninstall.exe"), TestContext.Current.CancellationToken));
            Assert.Equal("upstream notice", await File.ReadAllTextAsync(Path.Combine(target, "licenses", "upstream.txt"), TestContext.Current.CancellationToken));
            var backup = Assert.Single(Directory.GetDirectories(parent, "NoRisk Launcher.noloader-backup-*"));
            Assert.Equal("original launcher", await File.ReadAllTextAsync(Path.Combine(backup, launcherExecutable), TestContext.Current.CancellationToken));
            Assert.Equal("original settings", await File.ReadAllTextAsync(Path.Combine(backup, "launcher-settings.json"), TestContext.Current.CancellationToken));
            Assert.Null(result.PreviousVersion);

            await new LauncherInstallCoordinator(provider).InstallAsync(
                catalog.Releases.Single(item => item.Version == updatedRelease.Version), target, confirmReplaceExistingInstallation: true,
                cancellationToken: TestContext.Current.CancellationToken);
            Assert.Equal("Updated NoLoader launcher files", await File.ReadAllTextAsync(Path.Combine(target, launcherExecutable), TestContext.Current.CancellationToken));

            var restore = await LauncherInstallCoordinator.RestoreOriginalLauncherAsync(target, TestContext.Current.CancellationToken);

            Assert.Equal(target, restore.RestoredDirectory);
            Assert.Equal("original launcher", await File.ReadAllTextAsync(Path.Combine(target, launcherExecutable), TestContext.Current.CancellationToken));
            Assert.Equal("original uninstaller", await File.ReadAllTextAsync(Path.Combine(target, "uninstall.exe"), TestContext.Current.CancellationToken));
            Assert.Equal("upstream notice", await File.ReadAllTextAsync(Path.Combine(target, "licenses", "upstream.txt"), TestContext.Current.CancellationToken));
            Assert.Equal("Updated NoLoader launcher files", await File.ReadAllTextAsync(Path.Combine(restore.PreservedNoLoaderDirectory, launcherExecutable), TestContext.Current.CancellationToken));
            Assert.Null(await LauncherInstallCoordinator.ReadInstalledReleaseAsync(target, TestContext.Current.CancellationToken));
        }
        finally { Directory.Delete(parent, recursive: true); }
    }

    [Fact]
    public void CreatesTheNativeModsDirectoryUnderTheLauncherAppDataPath()
    {
        var appData = InstallerTestFixture.TemporaryDirectory();
        try
        {
            NoLoaderInstallPaths.EnsureModsDirectory(appData);

            var expected = Path.Combine(appData, NoLoaderInstallPaths.ApplicationIdentifier, "NoLoader", "mods");
            Assert.True(Directory.Exists(expected));
            Assert.Equal(expected, Path.GetFullPath(Path.Combine(appData, NoLoaderInstallPaths.ApplicationIdentifier, "NoLoader", "mods")));
        }
        finally { Directory.Delete(appData, recursive: true); }
    }

    [Fact]
    public async Task FailedUpdateIntegrityCheckLeavesThePreviousVersionActive()
    {
        using var key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var oldArchive = InstallerTestFixture.CreateArchive("working launcher");
        var newArchive = InstallerTestFixture.CreateArchive("expected new launcher");
        var oldRelease = InstallerTestFixture.CreateRelease(oldArchive, "1.0.0");
        var newRelease = InstallerTestFixture.CreateRelease(newArchive, "1.1.0");
        var newPath = new Uri(newRelease.Archive.Url).AbsolutePath;
        var tamperedArchive = newArchive.ToArray();
        tamperedArchive[0] ^= 1;
        using var provider = InstallerTestFixture.CreateProvider(key, [(oldRelease, oldArchive), (newRelease, newArchive)],
            new Dictionary<string, byte[]> { [newPath] = tamperedArchive });
        var catalog = await provider.GetCatalogAsync(TestContext.Current.CancellationToken);
        var target = Path.Combine(InstallerTestFixture.TemporaryDirectory(), "Launcher");
        var coordinator = new LauncherInstallCoordinator(provider);
        try
        {
            await coordinator.InstallAsync(catalog.Releases.Single(item => item.Version == "1.0.0"), target, false,
                cancellationToken: TestContext.Current.CancellationToken);
            var exception = await Assert.ThrowsAsync<NoLoaderInstallException>(() => coordinator.InstallAsync(
                catalog.Releases.Single(item => item.Version == "1.1.0"), target, true,
                cancellationToken: TestContext.Current.CancellationToken));

            Assert.Contains("SHA-256", exception.Message);
            Assert.Equal("working launcher", await File.ReadAllTextAsync(Path.Combine(target, "bin", "NoLoader.exe"), TestContext.Current.CancellationToken));
            Assert.Equal("1.0.0", (await LauncherInstallCoordinator.ReadInstalledReleaseAsync(target, TestContext.Current.CancellationToken))?.Version);
        }
        finally { DeleteParent(target); }
    }

    [Fact]
    public async Task UninstallRemovesTrackedProgramFilesAndPreservesUnrecognizedData()
    {
        using var key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var archive = InstallerTestFixture.CreateArchive();
        var release = InstallerTestFixture.CreateRelease(archive);
        using var provider = InstallerTestFixture.CreateProvider(key, [(release, archive)]);
        var catalog = await provider.GetCatalogAsync(TestContext.Current.CancellationToken);
        var target = Path.Combine(InstallerTestFixture.TemporaryDirectory(), "Launcher");
        try
        {
            await new LauncherInstallCoordinator(provider).InstallAsync(catalog.Releases[0], target, false,
                cancellationToken: TestContext.Current.CancellationToken);
            Directory.CreateDirectory(Path.Combine(target, "mods"));
            await File.WriteAllTextAsync(Path.Combine(target, "mods", "user-mod.zip"), "keep", TestContext.Current.CancellationToken);

            var result = await LauncherInstallCoordinator.UninstallAsync(target, TestContext.Current.CancellationToken);

            Assert.Equal(3, result.RemovedFiles);
            Assert.Equal(1, result.PreservedFiles);
            Assert.Equal("keep", await File.ReadAllTextAsync(Path.Combine(target, "mods", "user-mod.zip"), TestContext.Current.CancellationToken));
            Assert.Null(await LauncherInstallCoordinator.ReadInstalledReleaseAsync(target, TestContext.Current.CancellationToken));
        }
        finally { DeleteParent(target); }
    }

    private static void DeleteParent(string target)
    {
        var parent = Directory.GetParent(target)?.FullName;
        if (parent is not null && Directory.Exists(parent)) Directory.Delete(parent, recursive: true);
    }
}
