## NoLoader Launcher

**Modification notice (2026-10-23):** This work modifies NoRisk Launcher upstream commit `bfc2e0564f9c0c96d3ce9062deab316647932c64` by adding the NoLoader framework, API, installer, and release tooling. The source and build scripts are published here under GPL-3.0; the work is provided without warranty.

NoLoader is an unofficial community build based on NoRisk Launcher. It is not affiliated with or endorsed by NoRisk Client. The upstream name and marks identify the software this build extends; their owners retain those rights.

This branch integrates NoLoader into NoRisk Client as an extension framework. Extensions can add launcher pages, navigation, widgets, global styles, standalone windows, storage, inter-extension events, HTTPS integrations, clipboard and notification features, and explicitly permissioned PC file/process access. The API also offers an explicit `launcher.clientRuntime` capability for running custom JavaScript in the NoRisk Client renderer. NoLoader extensions customize the launcher; they do not create or install Minecraft game mods.

## Build your first extension

Start with the [extension documentation index](docs/modding/README.md) and follow the [step-by-step guide](docs/modding/getting-started.md) to build and install the Hello example. The index links to the manifest, API, permissions, lifecycle, and security references. Ready-to-build examples live in `sdk/`.

To build an example from the repository root, use Node.js 18 or later and Yarn Classic 1.22:

```powershell
yarn install --frozen-lockfile
yarn sdk:hello-mod:build
```

Copy `sdk/hello-mod` including its generated `dist/` folder into the directory opened by **NoLoader → Open extensions folder**. Refresh NoLoader and enable the extension. You do not need Rust or the full launcher source to build an extension.

The repository also includes a Windows installer that verifies signed catalogs, preserves the old launcher folder, and can restore the original NoRisk installation. [NoLoader Launcher 1.0.11](https://github.com/testaccount2109/noriskclient-launcher/releases/tag/noloader-v1.0.11) is the latest release at the time of writing. Tagged NoLoader releases publish the prepared launcher, installer, and signed Tauri update manifest. The Windows launcher checks only this fork's signed GitHub release feed; it does not query NoRisk's official updater. Existing installations must first be migrated once with NoLoader Setup, which verifies the catalog on the `noloader-catalog` branch. See [installation details](docs/installation.md), [third-party notices](docs/third-party.md), and [release process](docs/releases.md).

## Issues

If you notice any bugs or missing features, you can let us know by opening an issue [here](https://norisk.gg/issues).

## License

This code is originally forked and still uses a small amount of code from [LiquidLauncher](https://github.com/CCBlueX/LiquidLauncher).

Therefore, this project is also subject to the [GNU General Public License v3.0](LICENSE). This does only apply for source code located directly in this clean repository. During the development and compilation process, additional source code may be used to which we have obtained no rights. Such code is not covered by the GPL license.
This project entirely or partially for free and even commercially. However, please consider the following:

- **You must disclose the source code of your modified work and the source code you took from this project. This means you are not allowed to use code from this project (even partially) in a closed-source (or even obfuscated) application.**
- **Your modified application must also be licensed under the GPL**

Do the above and share your source code with everyone; just like we do.

## Compile it yourself!

### Prerequisites

- **Node.js** (v18 or higher) - [Download here](https://nodejs.org/en/download)
- **Rust** (latest stable) - [Install here](https://www.rust-lang.org/tools/install)
- **Yarn** package manager - `npm install -g yarn`

### Setup Instructions

1. Clone the repository:

   ```bash
   git clone --recurse-submodules https://github.com/NoRiskClient/noriskclient-launcher
   cd noriskclient-launcher
   ```

2. Install dependencies:

   ```bash
   yarn install
   ```

3. Start development mode:

   ```bash
   yarn tauri dev
   ```

4. Build for production:
   ```bash
   yarn tauri build
   ```

## Contributing

We appreciate contributions. So if you want to support us, feel free to make changes to NoRisk source code and submit a pull request.
