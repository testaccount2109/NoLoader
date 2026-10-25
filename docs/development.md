# NoLoader development

## Project setup

The project is a React/TypeScript frontend inside the Tauri 2 launcher with a Rust desktop host. Use Yarn Classic and the checked-in root `yarn.lock`. The extension SDK examples are local Yarn workspaces and use the locked Vite and TypeScript toolchain. Extension authors can follow the [first-extension guide](modding/getting-started.md) without building the launcher; this guide is for contributors changing NoLoader or the launcher itself.

```powershell
yarn install --frozen-lockfile
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vite/bin/vite.js build
```

Build the separate examples with `yarn sdk:hello-mod:build`, `yarn sdk:quick-join-mod:build`, `yarn sdk:performance-mod:build`, or `yarn sdk:client-runtime-extension:build`.

The repository's normal `yarn build` runs `prebuild`, which downloads the pinned native capture dependency and stages native files through Cargo. A full Tauri build also needs a Rust toolchain and platform prerequisites. Do not treat a Vite build as a native app build.

## NoLoader layout

- `src/noloader/core/`: manifest, dependency, UI descriptor, feature-policy, and stylesheet validation.
- `src/noloader/runtime/`: worker bootstrap.
- `src/noloader/NoLoaderContext.tsx`: discovery, lifecycle, worker supervision, API permissions, and registrations.
- `src/noloader/NoLoaderPages.tsx` and `ModUiTree.tsx`: manager, launcher pages, Play-screen widgets, and their host-rendered component tree.
- `src/noloader/runtime/mod-worker.ts` and `sdk/types/no-loader.d.ts`: private worker RPC and the public NoRisk Client and desktop extension API.
- `src-tauri/src/noloader.rs`: app-data discovery, settings, bounded extension assets, ZIP update installation, last-server storage, per-extension JSON storage, and permission-gated native process/file integration.
- `sdk/hello-mod/`, `sdk/quick-join-mod/`, `sdk/performance-mod/`, `sdk/client-runtime-extension/`, and `sdk/types/`: independently buildable Vite examples and TypeScript API declarations for NoRisk Launcher extensions.
- `docs/modding/`: versioned manifest, API, lifecycle, permissions, and security documentation.

## Native work

The Rust module is registered from `src-tauri/src/lib.rs`, and its commands are added to the Tauri invoke handler in `src-tauri/src/main.rs`. Frontend compatibility/manifest checks are in `src/noloader/core.test.ts`. Run `yarn test:noloader` to build the SDK samples and run those checks. Native Rust checks can be run with `cargo check --manifest-path src-tauri/Cargo.toml --lib` and the NoLoader-focused Rust tests with `cargo test --manifest-path src-tauri/Cargo.toml --lib noloader`. The full Tauri build also needs platform-specific native dependencies; see [architecture](architecture.md).

## Local UI inspection

`node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 1430` starts the web UI. The NoLoader manager route is `/#/noloader`. Native directory discovery and toggles require the Tauri desktop runtime; a browser preview reports that missing bridge rather than fabricating mod data. To inspect the full lifecycle, install the app in development mode and use the NoLoader manager's refresh and safe-mode controls.
