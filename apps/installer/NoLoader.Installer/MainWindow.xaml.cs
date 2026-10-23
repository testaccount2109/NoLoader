using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using Microsoft.Win32;
using NoLoader.Installer.Core;

namespace NoLoader.Installer;

public partial class MainWindow : Window
{
    private const uint DwmBorderColor = 34;
    private const uint DwmCaptionColor = 35;
    private const uint DwmTextColor = 36;

    [DllImport("dwmapi.dll", PreserveSig = true)]
    private static extern int DwmSetWindowAttribute(IntPtr window, uint attribute, ref uint value, uint valueSize);

    private SignedReleaseProvider? _provider;
    private ReleaseCatalog? _catalog;
    private VerifiedLauncherRelease? _stableRelease;
    private VerifiedLauncherRelease? _betaRelease;
    private VerifiedLauncherRelease? _selectedRelease;
    private InstalledLauncher? _installed;
    private string? _originalLauncherBackup;
    private CancellationTokenSource? _operationCancellation;
    private bool _existingTargetHasFiles;
    private bool _isBusy;
    private bool _isLoadingCatalog;
    private long _targetCheckRevision;

    public MainWindow()
    {
        InitializeComponent();
        SourceInitialized += MainWindow_SourceInitialized;
        InstallPathTextBox.Text = LauncherInstallCoordinator.GetDefaultInstallDirectory();
        Loaded += MainWindow_Loaded;
        Closed += (_, _) => _provider?.Dispose();
    }

    private void MainWindow_SourceInitialized(object? sender, EventArgs e)
    {
        if (!OperatingSystem.IsWindowsVersionAtLeast(10, 0, 22000)) return;

        var window = new WindowInteropHelper(this).Handle;
        SetWindowColor(window, DwmCaptionColor, 0x00000000);
        SetWindowColor(window, DwmTextColor, 0x00FFFFFF);
        SetWindowColor(window, DwmBorderColor, 0x00262626);
    }

    private static void SetWindowColor(IntPtr window, uint attribute, uint color)
    {
        _ = DwmSetWindowAttribute(window, attribute, ref color, sizeof(uint));
    }

    private async void MainWindow_Loaded(object sender, RoutedEventArgs e)
    {
        await RefreshInstallTargetAsync();
        await RefreshReleaseCatalogAsync();
    }

    private async Task RefreshReleaseCatalogAsync()
    {
        SetCatalogLoading(true);
        CatalogStateText.Text = "Connecting to the signed GitHub catalog…";
        ProgressStatusText.Text = "Checking GitHub";
        ProgressDetailText.Text = "The release signature and version metadata are being verified.";
        MainProgressBar.IsIndeterminate = true;

        try
        {
            _provider ??= new SignedReleaseProvider(
                new Uri(NoLoaderReleaseConfiguration.CatalogUrl),
                NoLoaderReleaseConfiguration.PublicKeyPem);
            _catalog = await _provider.GetCatalogAsync();
            _stableRelease = TrySelectRelease(_catalog, "stable");
            _betaRelease = TrySelectRelease(_catalog, "beta");
            _selectedRelease = _stableRelease ?? _betaRelease;
            if (_selectedRelease is null)
                throw new NoLoaderInstallException("GitHub has no compatible Windows x64 launcher release.");

            DisplayReleaseVersions(_selectedRelease);
            CatalogStateText.Text = "GitHub catalog verified";
            ProgressStatusText.Text = "GitHub versions loaded";
            ProgressDetailText.Text = "Release signatures, archive size and SHA-256 are checked before patching.";
        }
        catch (Exception exception)
        {
            _catalog = null;
            _stableRelease = null;
            _betaRelease = null;
            _selectedRelease = null;
            LatestVersionText.Text = "Release list unavailable";
            ChannelVersionsText.Text = "Stable —   ·   Beta —";
            ComponentVersionsText.Text = "Core —   ·   Mod API —";
            CommitText.Text = "Commit —";
            CatalogValidityText.Text = "Catalog could not be verified";
            CatalogStateText.Text = "Could not connect to GitHub";
            ProgressStatusText.Text = "GitHub check failed";
            ProgressDetailText.Text = exception is NoLoaderInstallException
                ? exception.Message
                : "Check your internet connection, then try again.";
        }
        finally
        {
            MainProgressBar.IsIndeterminate = false;
            MainProgressBar.Value = 0;
            SetCatalogLoading(false);
        }
    }

    private void DisplayReleaseVersions(VerifiedLauncherRelease release)
    {
        LatestVersionText.Text = $"NoLoader Launcher {release.Version}";
        ChannelVersionsText.Text = $"Stable {_stableRelease?.Version ?? "—"}   ·   Beta {_betaRelease?.Version ?? "—"}";
        ComponentVersionsText.Text = $"Core {release.CoreVersion}   ·   Mod API {release.ApiVersion}";
        CommitText.Text = $"Commit {release.UpstreamCommit[..Math.Min(12, release.UpstreamCommit.Length)]}   ·   {FormatBytes(release.Archive.SizeBytes)}";
        CatalogValidityText.Text = _catalog is null
            ? "Catalog —"
            : $"Signed catalog · {_catalog.Releases.Count} release(s) · valid to {_catalog.ExpiresAtUtc.ToLocalTime():g}";
    }

    private static VerifiedLauncherRelease? TrySelectRelease(ReleaseCatalog catalog, string channel)
    {
        try { return LauncherInstallCoordinator.SelectRelease(catalog, channel); }
        catch (NoLoaderInstallException) { return null; }
    }

    private static VerifiedLauncherRelease? GetReleaseForChannel(InstalledLauncher? installed, VerifiedLauncherRelease? stable, VerifiedLauncherRelease? beta)
    {
        if (installed?.Channel == "beta") return beta ?? stable;
        return stable ?? beta;
    }

    private async Task RefreshInstallTargetAsync()
    {
        var revision = Interlocked.Increment(ref _targetCheckRevision);
        var path = InstallPathTextBox.Text.Trim();
        _installed = null;
        _originalLauncherBackup = null;
        _existingTargetHasFiles = false;

        if (string.IsNullOrWhiteSpace(path) || !Path.IsPathRooted(path))
        {
            TargetStateText.Text = "Choose the folder used by your NoRisk shortcut.";
            SetActionStates();
            return;
        }

        try
        {
            var installed = await LauncherInstallCoordinator.ReadInstalledReleaseAsync(path);
            if (!IsCurrentTargetCheck(revision, path)) return;
            var backup = installed is null ? null : await LauncherInstallCoordinator.FindOriginalLauncherBackupAsync(path);
            if (!IsCurrentTargetCheck(revision, path)) return;

            _installed = installed;
            _originalLauncherBackup = backup;
            _existingTargetHasFiles = Directory.Exists(path) && Directory.EnumerateFileSystemEntries(path).Any();
            TargetStateText.Text = installed is not null
                ? $"NoLoader {installed.Version} installed{(backup is null ? string.Empty : " · original NoRisk backup found")}."
                : _existingTargetHasFiles
                    ? "Existing launcher files found · patching keeps a backup beside this folder."
                    : "No managed launcher found in this folder yet.";
        }
        catch (Exception exception)
        {
            if (!IsCurrentTargetCheck(revision, path)) return;
            TargetStateText.Text = exception is NoLoaderInstallException
                ? exception.Message
                : "Could not inspect this folder. Check the path and access permissions.";
        }

        SetActionStates();
    }

    private bool IsCurrentTargetCheck(long revision, string path) =>
        revision == _targetCheckRevision && path.Equals(InstallPathTextBox.Text.Trim(), StringComparison.OrdinalIgnoreCase);

    private async void RefreshButton_Click(object sender, RoutedEventArgs e) => await RefreshReleaseCatalogAsync();

    private async void PatchButton_Click(object sender, RoutedEventArgs e)
    {
        if (_isBusy) return;
        await RefreshReleaseCatalogAsync();
        await RefreshInstallTargetAsync();
        if (_selectedRelease is null || _installed is not null) return;
        await InstallReleaseAsync(_selectedRelease, updating: false);
    }

    private async void UpdateButton_Click(object sender, RoutedEventArgs e)
    {
        if (_isBusy) return;
        await RefreshReleaseCatalogAsync();
        await RefreshInstallTargetAsync();
        if (_installed is null)
        {
            ProgressStatusText.Text = "NoLoader is not installed";
            ProgressDetailText.Text = "Use Patch NoRisk Launcher first.";
            return;
        }

        var release = GetReleaseForChannel(_installed, _stableRelease, _betaRelease);
        if (release is null) return;
        if (string.Equals(_installed.Version, release.Version, StringComparison.Ordinal))
        {
            ProgressStatusText.Text = "NoLoader is up to date";
            ProgressDetailText.Text = $"GitHub has no newer {_installed.Channel} release than {_installed.Version}.";
            return;
        }

        await InstallReleaseAsync(release, updating: true);
    }

    private async Task InstallReleaseAsync(VerifiedLauncherRelease release, bool updating)
    {
        if (_provider is null) return;
        var provider = _provider;
        var target = InstallPathTextBox.Text.Trim();
        if (string.IsNullOrWhiteSpace(target) || !Path.IsPathRooted(target))
        {
            ProgressStatusText.Text = "Choose the NoRisk folder";
            ProgressDetailText.Text = "Select the launcher folder before patching or updating.";
            return;
        }

        try
        {
            _existingTargetHasFiles = Directory.Exists(target) && Directory.EnumerateFileSystemEntries(target).Any();
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
            ProgressStatusText.Text = "Folder cannot be read";
            ProgressDetailText.Text = "Choose a folder Windows can inspect and write to.";
            return;
        }

        if (_existingTargetHasFiles)
        {
            var description = updating
                ? $"Update NoLoader to {release.Version}? The complete current launcher folder will be kept as a rollback backup."
                : $"Patch this folder with NoLoader {release.Version}? The complete current launcher folder will be kept as a backup.";
            var answer = MessageBox.Show(this,
                $"{description}\n\nLauncher settings and mods remain in app data. The normal NoRisk shortcut will open the patched launcher.",
                updating ? "Update NoLoader" : "Patch NoRisk Launcher",
                MessageBoxButton.YesNo, MessageBoxImage.Question, MessageBoxResult.No);
            if (answer != MessageBoxResult.Yes) return;
        }

        await RunOperationAsync(async cancellationToken =>
        {
            NoLoaderInstallPaths.EnsureModsDirectory();
            var progress = new Progress<DownloadProgress>(value =>
            {
                MainProgressBar.IsIndeterminate = false;
                MainProgressBar.Value = value.Fraction * 100;
                ProgressDetailText.Text = $"Downloading {FormatBytes(value.BytesReceived)} of {FormatBytes(value.ExpectedBytes)}";
            });
            var status = new Progress<string>(value => ProgressStatusText.Text = value);
            var result = await new LauncherInstallCoordinator(provider).InstallAsync(
                release,
                target,
                confirmReplaceExistingInstallation: _existingTargetHasFiles,
                downloadProgress: progress,
                status: status,
                cancellationToken: cancellationToken);

            MainProgressBar.Value = 100;
            ProgressStatusText.Text = updating ? "NoLoader updated" : "NoRisk launcher patched";
            ProgressDetailText.Text = result.PreviousVersion is null
                ? $"NoLoader {release.Version} is ready. Mods folder created: {NoLoaderInstallPaths.ModsDirectory}"
                : $"NoLoader {release.Version} is ready. Previous launcher files are saved beside the install folder.";
        });
    }

    private async void DeinstallButton_Click(object sender, RoutedEventArgs e)
    {
        if (_isBusy || _installed is null) return;
        var target = InstallPathTextBox.Text.Trim();
        var backup = _originalLauncherBackup;
        var restoresOriginal = backup is not null;
        var message = restoresOriginal
            ? $"Restore the original NoRisk Launcher from its backup? The current NoLoader folder will be kept beside it.\n\nMods and settings remain in app data."
            : $"Remove tracked NoLoader files from this folder? Unrecognized files, mods and settings will be kept.";
        var answer = MessageBox.Show(this, message, "Deinstall NoLoader",
            MessageBoxButton.YesNo, MessageBoxImage.Warning, MessageBoxResult.No);
        if (answer != MessageBoxResult.Yes) return;

        await RunOperationAsync(async cancellationToken =>
        {
            if (restoresOriginal)
            {
                await LauncherInstallCoordinator.RestoreOriginalLauncherAsync(target, cancellationToken);
                ProgressStatusText.Text = "Original NoRisk launcher restored";
                ProgressDetailText.Text = "The usual shortcut now opens NoRisk again. The NoLoader folder was kept for rollback.";
            }
            else
            {
                var result = await LauncherInstallCoordinator.UninstallAsync(target, cancellationToken);
                ProgressStatusText.Text = "NoLoader deinstalled";
                ProgressDetailText.Text = $"Removed {result.RemovedFiles} managed files and kept {result.PreservedFiles} other files.";
            }
            MainProgressBar.Value = 100;
        });
    }

    private async void BrowseButton_Click(object sender, RoutedEventArgs e)
    {
        var current = InstallPathTextBox.Text.Trim();
        var dialog = new OpenFolderDialog
        {
            Title = "Choose the NoRisk Launcher folder",
            InitialDirectory = Directory.Exists(current)
                ? current
                : Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData)
        };
        if (dialog.ShowDialog(this) == true)
        {
            InstallPathTextBox.Text = dialog.FolderName;
            await RefreshInstallTargetAsync();
        }
    }

    private async void InstallPathTextBox_LostFocus(object sender, RoutedEventArgs e) => await RefreshInstallTargetAsync();

    private void InstallPathTextBox_TextChanged(object sender, TextChangedEventArgs e)
    {
        Interlocked.Increment(ref _targetCheckRevision);
        _installed = null;
        _originalLauncherBackup = null;
        _existingTargetHasFiles = false;
        SetActionStates();
    }

    private void CancelButton_Click(object sender, RoutedEventArgs e) => _operationCancellation?.Cancel();

    private void MainWindow_Closing(object? sender, CancelEventArgs e)
    {
        if (!_isBusy) return;
        e.Cancel = true;
        ProgressStatusText.Text = "An operation is still running";
        ProgressDetailText.Text = "Cancel it and wait for rollback or completion before closing this window.";
    }

    private async Task RunOperationAsync(Func<CancellationToken, Task> operation)
    {
        if (_isBusy) return;
        _operationCancellation = new CancellationTokenSource();
        SetBusy(true);
        MainProgressBar.Value = 0;
        try
        {
            await operation(_operationCancellation.Token);
        }
        catch (OperationCanceledException)
        {
            ProgressStatusText.Text = "Operation cancelled";
            ProgressDetailText.Text = "The active launcher was left unchanged.";
            MainProgressBar.Value = 0;
        }
        catch (Exception exception)
        {
            ProgressStatusText.Text = "Operation failed";
            ProgressDetailText.Text = exception is NoLoaderInstallException
                ? exception.Message
                : "Launcher files could not be safely changed. Close the launcher and check folder access before retrying.";
            MainProgressBar.Value = 0;
        }
        finally
        {
            _operationCancellation.Dispose();
            _operationCancellation = null;
            MainProgressBar.IsIndeterminate = false;
            SetBusy(false);
            await RefreshInstallTargetAsync();
        }
    }

    private void SetCatalogLoading(bool loading)
    {
        _isLoadingCatalog = loading;
        RefreshButton.IsEnabled = !loading && !_isBusy;
        SetActionStates();
    }

    private void SetBusy(bool busy)
    {
        _isBusy = busy;
        InstallPathTextBox.IsEnabled = !busy;
        BrowseButton.IsEnabled = !busy;
        RefreshButton.IsEnabled = !busy && !_isLoadingCatalog;
        CancelButton.IsEnabled = busy;
        CancelButton.Visibility = busy ? Visibility.Visible : Visibility.Collapsed;
        SetActionStates();
    }

    private void SetActionStates()
    {
        var pathIsValid = Path.IsPathRooted(InstallPathTextBox.Text.Trim());
        var canPatch = !_isBusy && !_isLoadingCatalog && _selectedRelease is not null && pathIsValid;
        PatchButton.IsEnabled = canPatch && _installed is null;
        UpdateButton.IsEnabled = canPatch && _installed is not null;
        DeinstallButton.IsEnabled = !_isBusy && _installed is not null;
    }

    private static string FormatBytes(long bytes) => bytes switch
    {
        >= 1024L * 1024 * 1024 => $"{bytes / (1024d * 1024 * 1024):0.0} GB",
        >= 1024L * 1024 => $"{bytes / (1024d * 1024):0.0} MB",
        >= 1024 => $"{bytes / 1024d:0} KB",
        _ => $"{bytes} B"
    };
}
