## NoLoader developer preview

NoLoader is an unofficial community build based on NoRisk Launcher. It is not affiliated with or endorsed by NoRisk Client. The upstream name and marks identify the software this build extends; their owners retain those rights.

This branch integrates NoLoader into the NoRisk Launcher source. Enabled extensions start with the normal launcher and can add validated pages, navigation, home widgets, global styles, per-mod storage, and extension-to-extension events. The documented launcher API can read limited profile metadata, retrieve the last recorded multiplayer Quick Play server, and request a click-confirmed launch that connects directly to that server. A TypeScript SDK and working example are in `sdk/hello-mod`.

Extensions run in dedicated workers and use a bounded, permission-checked API. They do not patch Minecraft files, inject into the game process, or receive arbitrary Tauri commands, account secrets, or unrestricted native access. Version 1 does not support arbitrary React components, native plug-ins, or backend modules. See the [modding guide](docs/modding/getting-started.md), [security status](docs/modding/security.md), and [development guide](docs/development.md).

The repository also includes source for a plain Windows installer that verifies signed catalogs, preserves the old launcher folder, and can restore the original NoRisk installation. A local prepared launcher archive has been built, but no signed public release catalog, publisher key, or public NoLoader release is configured yet. The installer intentionally keeps installation disabled until those release inputs exist. See [installation status](docs/installation.md), [third-party notices](docs/third-party.md), and [release requirements](docs/releases.md).

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
