# NoLoader development

## Project setup

The project is a React/TypeScript frontend inside the upstream Tauri 2 launcher. Use Yarn Classic and the checked-in root `yarn.lock`. The SDK example is a local Yarn workspace and uses the locked Vite and TypeScript toolchain.

```powershell
yarn install --frozen-lockfile
node node_modules/typescript/bin/tsc --noEmit
yarn test:noloader
node node_modules/vite/bin/vite.js build
```

`yarn test:noloader` builds the SDK example first, then runs the Node test suite. To build only the example, run `yarn sdk:hello-mod:build`.

The repository's normal `yarn build` runs `prebuild`, which downloads the pinned native capture dependency and stages native files through Cargo. A full Tauri build also needs a Rust toolchain and platform prerequisites. Do not treat a Vite build as a native app build.

## NoLoader layout

- `src/noloader/core/`: manifest, dependency, UI descriptor, and stylesheet validation.
- `src/noloader/runtime/`: worker bootstrap.
- `src/noloader/NoLoaderContext.tsx`: discovery, lifecycle, worker supervision, API permissions, and registrations.
- `src/noloader/NoLoaderPages.tsx` and `ModUiTree.tsx`: manager, launcher pages, Play-screen widgets, and their host-rendered component tree.
- `src/noloader/runtime/mod-worker.ts` and `sdk/types/no-loader.d.ts`: private worker RPC and the public extension API, including click-gated profile, Quick Play, and launcher-style calls.
- `src-tauri/src/noloader.rs`: app-data discovery, settings, bounded mod asset reads, last-server storage, and per-mod persistent JSON storage.
- `sdk/hello-mod/` and `sdk/types/`: independently buildable Vite example and TypeScript API declarations.
- `docs/modding/`: version 1 manifest, API, lifecycle, permissions, and security documentation.

## Native work

The Rust module is registered from `src-tauri/src/lib.rs`, and its commands are added to the Tauri invoke handler in `src-tauri/src/main.rs`. Rust tests live with the module. Run `cargo test --manifest-path src-tauri/Cargo.toml --lib noloader` and `cargo fmt --manifest-path src-tauri/Cargo.toml --check` when the Rust toolchain is available. The upstream checkout also contains an unresolved backend gitlink; see [architecture](architecture.md).

## Local UI inspection

`node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 1430` starts the web UI. The NoLoader manager route is `/#/noloader`. Native directory discovery and toggles require the Tauri desktop runtime; a browser preview reports that missing bridge rather than fabricating mod data.
