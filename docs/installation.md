# Installing NoLoader

NoLoader is integrated into the normal NoRisk Launcher application. The desktop entry point mounts `NoLoaderProvider` before the router, so enabled extensions start when the launcher starts; users do not need to open the NoLoader manager first. The clip-overlay window is intentionally excluded.

## Installer behavior

The plain Windows installer source is in `apps/installer`. It locates the NoRisk Launcher install folder from the Windows uninstall registry when possible, and also allows choosing the folder. Installing into the existing folder preserves the normal shortcut path, so it opens the NoLoader-enabled launcher afterward.

Before replacing an existing folder, the installer asks for confirmation. It verifies the signed release catalog and archive size/SHA-256, extracts to a staging directory, then swaps the selected directory. Previous program folders remain beside it with a `.noloader-backup-...` suffix. The installer tracks the original NoRisk folder separately from later NoLoader update backups, so **Restore original NoRisk** can put the stock launcher back at the shortcut path. The active NoLoader folder is retained as `.noloader-current-...`; neither folder is deleted. Launcher app data is not replaced. The installer creates the same mods path used by the native launcher: `%APPDATA%\gg.norisk.NoRiskClientLauncherV3\NoLoader\mods`.

## Mod installation

The NoLoader manager supports unpacked extensions. Put each extension in its own subfolder under the mods directory. See the [modding guide](modding/getting-started.md) and the manifest, API, lifecycle, permissions, and security references in `docs/modding/`.

Any distributed build is an unofficial community fork. Source and bundled runtime notices are documented in [third-party software notes](third-party.md); the launcher uses NoRisk services and retains their upstream identifiers.

## Build and release status

The launcher source can be built with the upstream Tauri process after installing Node, Yarn, Rust, and the platform prerequisites. See the [development guide](development.md). The current source commit is `bfc2e0564f9c0c96d3ce9062deab316647932c64`.

The installer verifies signed release metadata, but no NoLoader prepared launcher artifact, release catalog URL, or publisher key was provided in this checkout. Its development build therefore keeps installation disabled. A distribution build requires `NOLOADER_RELEASE_CATALOG_URL` and `NOLOADER_RELEASE_PUBLIC_KEY_PEM`, plus a published prepared Windows x64 artifact and catalog signed by the matching private key. The private key must remain with the publisher and is never embedded in the installer.
