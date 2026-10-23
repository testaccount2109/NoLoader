using Microsoft.Win32;

namespace NoLoader.Installer.Core;

public static class NoLoaderInstallPaths
{
    public const string ApplicationIdentifier = "gg.norisk.NoRiskClientLauncherV3";

    public static string ModsDirectory => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        ApplicationIdentifier,
        "NoLoader",
        "mods");

    public static string? FindExistingLauncherDirectory()
    {
        if (!OperatingSystem.IsWindows()) return null;
        foreach (var hiveType in new[] { RegistryHive.CurrentUser, RegistryHive.LocalMachine })
        foreach (var view in new[] { RegistryView.Registry64, RegistryView.Registry32 })
        {
            try
            {
                using var hive = RegistryKey.OpenBaseKey(hiveType, view);
                using var uninstall = hive.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall");
                if (uninstall is null) continue;
                foreach (var subKeyName in uninstall.GetSubKeyNames())
                {
                    using var entry = uninstall.OpenSubKey(subKeyName);
                    if (entry?.GetValue("DisplayName") is not string displayName ||
                        !displayName.Contains("NoRisk", StringComparison.OrdinalIgnoreCase) ||
                        !(displayName.Contains("Launcher", StringComparison.OrdinalIgnoreCase) ||
                          displayName.Contains("Client", StringComparison.OrdinalIgnoreCase)))
                        continue;

                    if (entry.GetValue("InstallLocation") is string location &&
                        !string.IsNullOrWhiteSpace(location) && Directory.Exists(location))
                        return Path.GetFullPath(location);
                    if (entry.GetValue("UninstallString") is string uninstallString &&
                        TryGetExecutablePath(uninstallString, out var uninstallExecutable))
                        return Path.GetDirectoryName(uninstallExecutable);
                }
            }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
            catch (System.Security.SecurityException) { }
        }
        return null;
    }

    public static void EnsureModsDirectory() => EnsureModsDirectory(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData));

    public static void EnsureModsDirectory(string appDataDirectory)
    {
        if (string.IsNullOrWhiteSpace(appDataDirectory) || !Path.IsPathRooted(appDataDirectory))
            throw new NoLoaderInstallException("Windows did not provide a valid launcher app-data folder.");

        var current = Path.GetFullPath(appDataDirectory);
        RejectReparsePointIfPresent(current);
        foreach (var part in new[] { ApplicationIdentifier, "NoLoader", "mods" })
        {
            current = Path.Combine(current, part);
            if (File.Exists(current))
                throw new NoLoaderInstallException("The NoLoader mods path is occupied by a file.");
            Directory.CreateDirectory(current);
            RejectReparsePointIfPresent(current);
        }
    }

    private static void RejectReparsePointIfPresent(string path)
    {
        if (!Directory.Exists(path)) return;
        if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0)
            throw new NoLoaderInstallException("The launcher app-data path contains a symbolic link or reparse point.");
    }

    private static bool TryGetExecutablePath(string value, out string path)
    {
        path = string.Empty;
        var trimmed = value.Trim();
        string candidate;
        if (trimmed.StartsWith('"'))
        {
            var end = trimmed.IndexOf('"', 1);
            if (end <= 1) return false;
            candidate = trimmed[1..end];
        }
        else
        {
            var end = trimmed.IndexOf(".exe", StringComparison.OrdinalIgnoreCase);
            if (end < 0) return false;
            candidate = trimmed[..(end + 4)];
        }
        if (!Path.IsPathRooted(candidate) || !File.Exists(candidate)) return false;
        path = Path.GetFullPath(candidate);
        return true;
    }
}
