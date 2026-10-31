# NoRisk Client Launcher

The official desktop launcher for NoRisk Client. Create and manage Minecraft profiles, install mods and modpacks, manage skins, and launch the game from one place.

**[Download the latest release](https://github.com/NoRiskClient/noriskclient-launcher/releases/latest)** · [Report a bug](https://norisk.gg/issues) · [Get support on Discord](https://discord.norisk.gg)

## What you can do

- Create separate Minecraft profiles with Fabric, Forge, NeoForge, Quilt, or Vanilla.
- Find and manage mods, modpacks, resource packs, shader packs, and data packs.
- Browse community skins from The Skindex and save them to your launcher library.
- Rejoin the last server from the Play screen using Quick Server Join.
- Manage Minecraft accounts, skins, capes, cosmetics, and launcher settings.
- Import and export profiles and modpacks.

Quick Server Join and SkinAPI are built-in launcher mods. You can switch either feature on or off in **Settings → Launcher Mods**.

## Downloads

Choose the installer for your operating system from the [latest GitHub release](https://github.com/NoRiskClient/noriskclient-launcher/releases/latest).

| Platform | Download | Notes |
| --- | --- | --- |
| Windows | `NoRiskClient-Windows-setup.exe` | 64-bit Windows installer |
| macOS Apple Silicon | `NoRiskClient-MacOS-arm64.dmg` | Apple Silicon (ARM64) |
| macOS Intel | `NoRiskClient-MacOS-x86_64.dmg` | Intel (x86_64) |
| Linux | `NoRiskClient-Linux.AppImage` | x86_64; recommended for most distributions |
| Debian / Ubuntu | `NoRiskClient-Linux.deb` | x86_64; install with your package manager |
| Fedora / compatible RPM distributions | `NoRiskClient-Linux.rpm` | x86_64; install with your package manager |

### Linux compatibility

The Linux release is built for **x86_64**. The AppImage is the most portable option across distributions, while the `.deb` and `.rpm` packages integrate with Debian/Ubuntu and Fedora/RHEL-family package managers respectively.

The launcher uses Tauri and WebKitGTK. Linux systems need a compatible **WebKitGTK 4.1** runtime and Ayatana AppIndicator library. On Debian or Ubuntu, install the runtime libraries with:

```bash
sudo apt install libwebkit2gtk-4.1-0 libayatana-appindicator3-1
```

AppImage may also require FUSE support on older distributions. If your distribution does not provide WebKitGTK 4.1, use a compatible distribution or install the missing runtime packages before launching the AppImage. Linux ARM64 and an official Flatpak package are not currently published.

## Updating

When a new launcher version is available, the launcher shows its version and release notes. Choose **Open installer** to open that version's release page, download the installer for your system, close the launcher, and run the installer. Profiles and launcher settings are kept. The new version's changelog appears once after the update; you can also suppress a specific update prompt.

Updater signature files are intentionally not published as release downloads. Launcher updates use the platform installer shown in the release assets.

## Build from source

### Requirements

- Node.js LTS (18 or newer)
- Yarn
- Rust stable
- Tauri's platform build prerequisites; see the [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/)

For Ubuntu/Debian Linux development builds:

```bash
sudo apt update
sudo apt install build-essential curl wget file libxdo-dev libssl-dev \
  libayatana-appindicator3-dev librsvg2-dev patchelf libwebkit2gtk-4.1-dev
```

### Development and production build

```bash
git clone --recurse-submodules https://github.com/NoRiskClient/noriskclient-launcher.git
cd noriskclient-launcher
yarn install
yarn tauri dev
```

Build a production installer for the current platform with:

```bash
yarn tauri build
```

The CI release workflow builds Windows x86_64, macOS ARM64 and x86_64, and Linux x86_64 packages.

## Contributing and issues

Contributions are welcome. Please open an issue for bugs or feature requests and include your operating system, launcher version, and relevant logs. See the [GitHub issue tracker](https://norisk.gg/issues).

## License and third-party notices

This repository contains code originally forked from [LiquidLauncher](https://github.com/CCBlueX/LiquidLauncher) and is distributed under the [GNU General Public License v3.0](LICENSE). Third-party libraries and assets may have separate license terms; see [THIRD_PARTY_ICONS.md](THIRD_PARTY_ICONS.md) and the relevant upstream notices.
