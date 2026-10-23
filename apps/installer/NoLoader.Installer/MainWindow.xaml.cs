using System.Diagnostics;
using System.IO;
using System.Windows;
using System.Windows.Controls;
using Microsoft.Win32;
using NoLoader.Installer.Core;

namespace NoLoader.Installer;

public partial class MainWindow : Window
{
    private SignedReleaseProvider? _provider;
    private ReleaseCatalog? _catalog;
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
        InstallPathTextBox.Text = LauncherInstallCoordinator.GetDefaultInstallDirectory();
        Loaded += MainWindow_Loaded;
        Closed += (_, _) => _provider?.Dispose();
    }

    private async void MainWindow_Loaded(object sender, RoutedEventArgs e)
    {
        await RefreshReleaseCatalogAsync();
        await RefreshInstallTargetAsync();
    }

    private async Task RefreshReleaseCatalogAsync()
    {
        if (!NoLoaderReleaseConfiguration.IsConfigured)
        {
            _catalog = null;
            _selectedRelease = null;
            ReleaseVersionText.Text = "No signed release source configured";
            ReleaseSubtext.Text = "This build needs a publisher HTTPS catalog URL and pinned public key. Installation stays disabled until these are supplied.";
            CoreVersionText.Text = ApiVersionText.Text = CommitText.Text = "—";
            ProgressStatusText.Text = "Waiting for release configuration";
            ProgressDetailText.Text = "No release has been selected and no launcher files have been changed.";
            SetActionStates();
            ShowNotice("Release source missing", "The repository does not include a NoLoader release artifact, catalog URL, or publisher key.");
            return;
        }

        SetCatalogLoading(true);
        try
        {
            _provider ??= new SignedReleaseProvider(new Uri(NoLoaderReleaseConfiguration.CatalogUrl), NoLoaderReleaseConfiguration.PublicKeyPem);
            ProgressStatusText.Text = "Checking signed release catalog";
            ProgressDetailText.Text = "The publisher signature and catalog validity are being checked.";
            MainProgressBar.IsIndeterminate = true;
            _catalog = await _provider.GetCatalogAsync();
            SelectChannelRelease();
            ShowNotice("Release catalog verified", $"Valid until {_catalog.ExpiresAtUtc.ToLocalTime():g}.");
        }
        catch (Exception exception)
        {
            _catalog = null;
            _selectedRelease = null;
            ReleaseVersionText.Text = "Release list unavailable";
            ReleaseSubtext.Text = "The signed catalog could not be verified. No launcher files were changed.";
            CoreVersionText.Text = ApiVersionText.Text = CommitText.Text = "—";
            ProgressStatusText.Text = "Could not verify release list";
            ProgressDetailText.Text = exception is NoLoaderInstallException ? exception.Message : "Check the connection and try again.";
            ShowNotice("Could not load a trusted release", ProgressDetailText.Text);
        }
        finally
        {
            MainProgressBar.IsIndeterminate = false;
            MainProgressBar.Value = 0;
            SetCatalogLoading(false);
        }
    }

    private void SelectChannelRelease()
    {
        if (_catalog is null) return;
        var channel = (ChannelComboBox.SelectedItem as ComboBoxItem)?.Tag as string ?? "stable";
        try
        {
            _selectedRelease = LauncherInstallCoordinator.SelectRelease(_catalog, channel);
            ReleaseVersionText.Text = $"NoLoader Launcher {_selectedRelease.Version} ({_selectedRelease.Channel})";
            ChannelBadgeText.Text = _selectedRelease.Channel.ToUpperInvariant();
            ReleaseSubtext.Text = $"Prepared Windows x64 build · {FormatBytes(_selectedRelease.Archive.SizeBytes)} archive";
            CoreVersionText.Text = _selectedRelease.CoreVersion;
            ApiVersionText.Text = _selectedRelease.ApiVersion;
            CommitText.Text = _selectedRelease.UpstreamCommit[..Math.Min(12, _selectedRelease.UpstreamCommit.Length)];
            ProgressStatusText.Text = "Release signature verified";
            ProgressDetailText.Text = "The archive size and SHA-256 are checked before installation.";
        }
        catch (NoLoaderInstallException exception)
        {
            _selectedRelease = null;
            ReleaseVersionText.Text = "No compatible release";
            ReleaseSubtext.Text = exception.Message;
        }
        SetActionStates();
    }

    private async Task RefreshInstallTargetAsync()
    {
        var revision = Interlocked.Increment(ref _targetCheckRevision);
        var path = InstallPathTextBox.Text.Trim();
        _installed = null;
        _originalLauncherBackup = null;
        _existingTargetHasFiles = false;
        UninstallButton.IsEnabled = false;
        RestoreOriginalButton.IsEnabled = false;
        LaunchButton.IsEnabled = false;
        if (string.IsNullOrWhiteSpace(path) || !Path.IsPathRooted(path))
        {
            ProgressDetailText.Text = "Choose the existing NoRisk Launcher installation folder.";
            SetActionStates();
            return;
        }

        try
        {
            var installed = await LauncherInstallCoordinator.ReadInstalledReleaseAsync(path);
            if (revision != _targetCheckRevision || !path.Equals(InstallPathTextBox.Text.Trim(), StringComparison.OrdinalIgnoreCase)) return;
            var originalBackup = installed is null ? null : await LauncherInstallCoordinator.FindOriginalLauncherBackupAsync(path);
            if (revision != _targetCheckRevision || !path.Equals(InstallPathTextBox.Text.Trim(), StringComparison.OrdinalIgnoreCase)) return;
            _installed = installed;
            _originalLauncherBackup = originalBackup;
            _existingTargetHasFiles = Directory.Exists(path) && Directory.EnumerateFileSystemEntries(path).Any();
            if (installed is not null)
            {
                ProgressDetailText.Text = $"NoLoader installation {installed.Version} found. Its old program files will be backed up when replaced.";
                UninstallButton.IsEnabled = !_isBusy;
                RestoreOriginalButton.IsEnabled = !_isBusy && _originalLauncherBackup is not null;
                LaunchButton.IsEnabled = !_isBusy && File.Exists(Path.Combine(path, installed.LauncherExecutable.Replace('/', Path.DirectorySeparatorChar)));
            }
            else if (_existingTargetHasFiles)
            {
                ProgressDetailText.Text = "Existing launcher files found. Confirm replacement to make this folder start NoLoader from the usual shortcut.";
            }
            else
            {
                ProgressDetailText.Text = "Folder is empty or will be created. To update the normal launcher shortcut, choose its existing folder.";
            }
        }
        catch (Exception exception)
        {
            if (revision != _targetCheckRevision) return;
            ProgressDetailText.Text = "The folder could not be inspected. Check its path and access permissions.";
            if (exception is NoLoaderInstallException) ShowNotice("Install folder needs attention", exception.Message);
        }
        SetActionStates();
    }

    private async void InstallButton_Click(object sender, RoutedEventArgs e)
    {
        if (_provider is null || _selectedRelease is null) return;
        var target = InstallPathTextBox.Text.Trim();
        try
        {
            _existingTargetHasFiles = Directory.Exists(target) && Directory.EnumerateFileSystemEntries(target).Any();
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
            ShowNotice("Install folder cannot be read", "Choose a folder that Windows can inspect and write to.");
            return;
        }
        if (_existingTargetHasFiles)
        {
            var answer = MessageBox.Show(this,
                $"Replace the files in this folder with NoLoader Launcher {_selectedRelease.Version}?\n\nThe normal shortcut will start the NoLoader build after replacement. The complete old folder will remain beside it as a backup. Launcher profiles, settings and mods stay in app data.",
                "Replace NoRisk Launcher files", MessageBoxButton.YesNo, MessageBoxImage.Warning, MessageBoxResult.No);
            if (answer != MessageBoxResult.Yes) return;
        }

        await RunOperationAsync(async cancellationToken =>
        {
            NoLoaderInstallPaths.EnsureModsDirectory();
            ProgressDetailText.Text = $"Mods folder: {NoLoaderInstallPaths.ModsDirectory}";
            var progress = new Progress<DownloadProgress>(value =>
            {
                MainProgressBar.IsIndeterminate = false;
                MainProgressBar.Value = value.Fraction * 100;
                ProgressDetailText.Text = $"Downloaded {FormatBytes(value.BytesReceived)} of {FormatBytes(value.ExpectedBytes)}";
            });
            var status = new Progress<string>(value => ProgressStatusText.Text = value);
            var result = await new LauncherInstallCoordinator(_provider).InstallAsync(
                _selectedRelease, target, confirmReplaceExistingInstallation: _existingTargetHasFiles,
                downloadProgress: progress, status: status, cancellationToken: cancellationToken);
            ProgressStatusText.Text = "NoLoader installed";
            ProgressDetailText.Text = $"The selected launcher folder now starts NoLoader. Mods folder: {NoLoaderInstallPaths.ModsDirectory}";
            ShowNotice("Launcher ready", result.PreviousVersion is null
                ? "The NoLoader build is installed."
                : "The NoLoader build is active. The complete previous folder remains beside it for rollback.");
            await RefreshInstallTargetAsync();
        });
    }

    private async void UninstallButton_Click(object sender, RoutedEventArgs e)
    {
        if (_installed is null) return;
        var answer = MessageBox.Show(this,
            $"Remove tracked NoLoader launcher files for version {_installed.Version}?\n\nUnrecognized files and app data, including mods and settings, are kept. The original launcher backup is not removed.",
            "Remove NoLoader files", MessageBoxButton.YesNo, MessageBoxImage.Warning, MessageBoxResult.No);
        if (answer != MessageBoxResult.Yes) return;
        var target = InstallPathTextBox.Text.Trim();
        await RunOperationAsync(async cancellationToken =>
        {
            var result = await LauncherInstallCoordinator.UninstallAsync(target, cancellationToken);
            ProgressStatusText.Text = "NoLoader program files removed";
            ProgressDetailText.Text = $"Removed {result.RemovedFiles} tracked files; kept {result.PreservedFiles} other files and all launcher app data.";
            await RefreshInstallTargetAsync();
        });
    }

    private async void RestoreOriginalButton_Click(object sender, RoutedEventArgs e)
    {
        if (_installed is null || _originalLauncherBackup is null) return;
        var answer = MessageBox.Show(this,
            $"Restore the original NoRisk Launcher from its verified backup?\n\nThe active NoLoader folder will be kept beside it at a .noloader-current-... path. Mods and launcher app data are kept.",
            "Restore original NoRisk Launcher", MessageBoxButton.YesNo, MessageBoxImage.Warning, MessageBoxResult.No);
        if (answer != MessageBoxResult.Yes) return;
        var target = InstallPathTextBox.Text.Trim();
        await RunOperationAsync(async cancellationToken =>
        {
            var result = await LauncherInstallCoordinator.RestoreOriginalLauncherAsync(target, cancellationToken);
            ProgressStatusText.Text = "Original NoRisk Launcher restored";
            ProgressDetailText.Text = $"The original launcher is active again. NoLoader files remain at '{result.PreservedNoLoaderDirectory}'.";
            ShowNotice("NoRisk Launcher restored", "The usual launcher shortcut now opens the original NoRisk Launcher again.");
        });
    }

    private async void RefreshButton_Click(object sender, RoutedEventArgs e) => await RefreshReleaseCatalogAsync();

    private async void BrowseButton_Click(object sender, RoutedEventArgs e)
    {
        var current = InstallPathTextBox.Text.Trim();
        var dialog = new OpenFolderDialog
        {
            Title = "Select the existing NoRisk Launcher folder",
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

    private void ChannelComboBox_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_catalog is not null) SelectChannelRelease();
    }

    private async void InstallPathTextBox_LostFocus(object sender, RoutedEventArgs e) => await RefreshInstallTargetAsync();

    private void InstallPathTextBox_TextChanged(object sender, TextChangedEventArgs e)
    {
        Interlocked.Increment(ref _targetCheckRevision);
        _installed = null;
        _originalLauncherBackup = null;
        _existingTargetHasFiles = false;
        UninstallButton.IsEnabled = false;
        RestoreOriginalButton.IsEnabled = false;
        LaunchButton.IsEnabled = false;
        SetActionStates();
    }

    private void CancelButton_Click(object sender, RoutedEventArgs e) => _operationCancellation?.Cancel();

    private void LaunchButton_Click(object sender, RoutedEventArgs e)
    {
        if (_installed is null) return;
        var executable = Path.GetFullPath(Path.Combine(InstallPathTextBox.Text.Trim(), _installed.LauncherExecutable.Replace('/', Path.DirectorySeparatorChar)));
        if (!File.Exists(executable))
        {
            ShowNotice("Launcher executable is missing", "Check for a signed release and repair the launcher.");
            return;
        }
        try { Process.Start(new ProcessStartInfo(executable) { UseShellExecute = true }); }
        catch (Exception exception) { ShowNotice("Could not start launcher", exception.Message); }
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
        }
        catch (Exception exception)
        {
            ProgressStatusText.Text = "Operation failed";
            ProgressDetailText.Text = exception is NoLoaderInstallException
                ? exception.Message
                : "The launcher files could not be safely changed. Check folder access and close the launcher before retrying.";
            ShowNotice("Could not complete operation", ProgressDetailText.Text);
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
        ChannelComboBox.IsEnabled = !loading && !_isBusy && _catalog is not null;
        SetActionStates();
    }

    private void SetBusy(bool busy)
    {
        _isBusy = busy;
        InstallPathTextBox.IsEnabled = !busy;
        BrowseButton.IsEnabled = !busy;
        RefreshButton.IsEnabled = !busy && !_isLoadingCatalog;
        ChannelComboBox.IsEnabled = !busy && !_isLoadingCatalog && _catalog is not null;
        CancelButton.IsEnabled = busy;
        UninstallButton.IsEnabled = !busy && _installed is not null;
        RestoreOriginalButton.IsEnabled = !busy && _installed is not null && _originalLauncherBackup is not null;
        SetActionStates();
    }

    private void SetActionStates()
    {
        InstallButton.IsEnabled = !_isBusy && !_isLoadingCatalog && _provider is not null &&
            _selectedRelease is not null && Path.IsPathRooted(InstallPathTextBox.Text.Trim());
        InstallButton.Content = _installed is not null
            ? (_installed.Version == _selectedRelease?.Version ? "Repair NoLoader" : "Update NoLoader")
            : (_existingTargetHasFiles ? "Replace with NoLoader" : "Install NoLoader");
        UninstallButton.IsEnabled = !_isBusy && _installed is not null;
        RestoreOriginalButton.IsEnabled = !_isBusy && _installed is not null && _originalLauncherBackup is not null;
    }

    private void ShowNotice(string title, string body)
    {
        NoticeTitle.Text = title;
        NoticeBody.Text = body;
        NoticeBanner.Visibility = Visibility.Visible;
    }

    private static string FormatBytes(long bytes) => bytes switch
    {
        >= 1024L * 1024 * 1024 => $"{bytes / (1024d * 1024 * 1024):0.0} GB",
        >= 1024L * 1024 => $"{bytes / (1024d * 1024):0.0} MB",
        >= 1024 => $"{bytes / 1024d:0} KB",
        _ => $"{bytes} B"
    };
}
