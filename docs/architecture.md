# NoLoader architecture and repository analysis

Status: Phase 0 analysis and the first integrated NoLoader milestone, based on upstream commit `bfc2e0564f9c0c96d3ce9062deab316647932c64` (`v3`).

## Repository and licensing

The working copy is the official [NoRiskClient/noriskclient-launcher](https://github.com/NoRiskClient/noriskclient-launcher) repository, cloned to `NoLoader/` because no launcher checkout was present in the workspace. The checked-in `LICENSE` is GPL-3.0. The upstream README says this applies to source code in the clean repository and warns that additional source used during development or compilation may have separate rights. NoLoader changes and any redistributed launcher therefore need source disclosure and a separate review of bundled/runtime components and their terms.

The commit records `noriskclient-backend` as a gitlink at `7f83c6399b778e69443bfa67ff2d7d8be4c441d4`, but this checkout has no `.gitmodules` file and the directory is empty. Git cannot resolve the submodule URL. This is an upstream checkout issue to resolve before relying on any backend content; no replacement source or URL is assumed here.

There is no root `AGENTS.md`. The always-applied Cursor rule at `.cursor/rules/noriskclient-launcher.mdc` asks contributors to read and maintain `noriskcient-launcher.md`, including the complete SQLite schema. That referenced file was absent, so it is being established at the requested path and records the schema found in the checked-in SQL migrations.

## Confirmed stack and integration points

| Area            | Repository evidence                                                                                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Frontend        | React 18.3.1, TypeScript `~5.6.2`, Vite 6, React Router 7, Zustand 5                                                                                                     |
| Package manager | Yarn Classic 1.22, `yarn.lock`                                                                                                                                           |
| Desktop shell   | Tauri 2; Rust package edition 2021, SQLx SQLite                                                                                                                          |
| UI entry        | `src/main.tsx` mounts `RouterProvider`; `src/lib/router.tsx` owns the hash routes; `src/App.tsx` and `src/components/layout/AppLayout.tsx` provide the application shell |
| Native entry    | `src-tauri/src/main.rs` configures Tauri setup and the IPC handler; `src-tauri/src/lib.rs` declares native modules                                                       |
| State           | SQLite migrations live in `src-tauri/migrations`; several other stores are file-backed                                                                                   |
| Frontend tests  | Upstream had no frontend test runner; NoLoader adds a dev-only `tsx` runner for Node's built-in `node:test`                                                              |
| Native tests    | Rust integration tests exist under `src-tauri/tests`                                                                                                                     |

The main Tauri capability grants the launcher window broad filesystem access, including read/write scopes for user locations, and process/plugin access. NoLoader therefore dynamically imports mod ES modules in dedicated Web Workers and never imports them into the launcher React context. The module receives only the NoLoader API; the host communicates with the worker bootstrap through a private `MessagePort` and validates API permissions and UI descriptors. This boundary does not provide an OS sandbox or hard CPU/memory quotas. See the current [security status](modding/security.md) and [threat model](security/threat-model.md).

The Tauri updater has no configured endpoints. The installer uses its own versioned signed catalog. The public fork now pins a P-256 verification key and has a release workflow, but no public launcher artifact or catalog has been published yet.

## Baseline environment and commands

The upstream README lists Node 18+, stable Rust, Yarn, `yarn install`, `yarn tauri dev`, and `yarn tauri build`. This environment has Node `v24.16.0`, Yarn `1.22.22`, a local .NET SDK `10.0.402`, and an installed Rust toolchain. The Windows Tauri build and NoLoader Rust tests have completed.

`yarn install --frozen-lockfile` completed. It reported existing unmet peer dependency warnings for `@types/three` and a Yarn workspace warning. The baseline `node node_modules/typescript/bin/tsc --noEmit` passed. The baseline `node node_modules/vite/bin/vite.js build` passed and emitted a production frontend bundle, but reported existing warnings: `installProfile` is imported but not exported, CSS contains literal `${getHoverBoxShadow()}` / `${getActiveBoxShadow()}` values, two imports are both static and dynamic, and two output chunks exceed 2.5 MB. The configured `prebuild` and Tauri build scripts also stage native capture dependencies and invoke Cargo, so they are not a frontend-only baseline command.

Windows build setup downloads a pinned native dependency archive and checks its SHA-256 in `scripts/setup-native-deps.mjs`; `scripts/stage-native-deps.mjs` invokes Cargo and stages binaries. These scripts were inspected before attempting them. Do not report a full app build based only on a TypeScript or Vite build.

## Integration plan to validate during implementation

1. Keep the NoLoader core in a dedicated frontend module tree and add only the narrow integration points required by the actual router and app shell.
2. Keep manifest parsing, compatibility checks, dependency resolution, and lifecycle state separate from React view components.
3. Add native filesystem operations only through dedicated Tauri commands with path validation. Do not grant mods arbitrary native commands or duplicate loader logic in the installer.
4. Define a versioned manifest and API from the needs of a working example mod; do not document suggested APIs before they exist.
5. Prove how runtime entry points can be loaded in the packaged Tauri app, and verify the security boundary before describing mods as isolated.
6. Keep the installer as a separate concern that consumes signed or otherwise verifiable release metadata for a NoLoader-prepared launcher build. Do not fall back to arbitrary upstream releases or overwrite existing installs silently.

The integrated milestone includes strict manifest parsing, SemVer comparison, API 1 and 2 compatibility, deterministic dependency resolution, a private-port worker API, host-rendered pages and home widgets, scoped global styles, extension storage/events, safe mode, native app-data discovery, and startup loading from the normal launcher entry point. API 2 adds bounded interactive UI controls, owner-scoped feature overrides for CurseForge/news/effects/ads, and extension API request/latency snapshots. Example mods cover Quick Join, native JAR import, and optional launcher performance controls. The Play screen supports widgets before and after its launch controls. Game JARs run through the profile's Fabric, Forge, Quilt, or NeoForge loader; a separate Gradle starter demonstrates that game-side pipeline. Windows installer source verifies signed release metadata, preserves previous folders, can restore the recorded original NoRisk folder after multiple updates, and creates the native mods directory.

The frontend integration lives in `src/lib/router.tsx`, `src/components/layout/AppLayout.tsx`, `src/main.tsx`, and `src/noloader/`. Native commands are declared in `src-tauri/src/noloader.rs` and registered from `src-tauri/src/main.rs`.

## Open questions and risks

- The `noriskclient-backend` gitlink has no mapping or checked-out source in this commit. Confirm its intended source before any build or behavior that depends on it.
- Workers prevent direct access to the launcher DOM and Tauri bridge, but they do not provide hard resource quotas. Platform behavior and CSP enforcement need native runtime verification.
- No upstream frontend test framework was configured. The NoLoader core uses Node's built-in `node:test` API through a dev-only TypeScript runner; no test framework or runtime dependency was added.
- The public source fork has published signed Windows launcher releases. The installer checks the signed catalog, while the launcher uses a separate Tauri update key and the fork's `latest.json` release manifest.
- The brief names a Windows `Noloader.exe` installer, while upstream packaging targets Windows, macOS, and Linux. Treat Windows as the initial installer target unless later requirements establish otherwise.
- License compatibility of every shipped dependency and native binary must be checked before redistributing a prepared build.

## Current verification status

The repository's prior verification results are recorded above. This API 2 extension update has been typechecked and its three SDK example bundles built. The native launcher has not yet been rebuilt with these changes in this turn.

The source branch is public at `https://github.com/testaccount2109/noriskclient-launcher`. The release workflow builds the Windows launcher archive, signed Tauri update, installer, and signed catalog. A successful build does not complete a legal review of every bundled dependency; retain the packaged license notices and verify upstream component source availability before announcing binary releases.
