# NoLoader architecture

NoLoader is a launcher extension framework integrated into the NoRisk Client desktop application. It is made of a TypeScript/React user interface, a Rust/Tauri desktop host, a public TypeScript API for extension authors, and a signed Windows installer/release pipeline. This page describes how those pieces fit together; use the [extension tutorial](modding/getting-started.md) if your goal is to make a mod.

## What an extension is

An extension is a folder in the launcher's NoLoader data directory. It contains a strict JSON manifest, a bundled JavaScript ES module, and optional CSS/assets. The manifest supplies a stable ID and version, names the entry point, declares the NoLoader API and launcher host versions supported, and lists requested permissions.

Extensions run with the launcher, not inside the Minecraft game. They cannot directly import React components into the launcher UI. Instead, standard extensions run in dedicated Web Workers and ask the host to register validated data-only pages, widgets, buttons, and styles through the public API. The host translates permitted API requests into narrowly scoped Tauri commands.

## Startup and extension flow

1. `NoLoaderProvider` asks the native host to read the extensions folder and per-user settings.
2. The frontend validates each manifest and resolves duplicate IDs, API/host compatibility, conflicts, dependencies, and dependency cycles.
3. Declared HTTPS update feeds are checked. An extension opts into ZIP replacement with `updates.autoInstall: true`; otherwise new versions are reported with links.
4. Compatible enabled extensions are loaded in deterministic dependency order. Their single bundled module is executed in a worker with the NoLoader API.
5. Every registration and API request is checked against the extension's manifest permissions and descriptor limits. On stop or refresh, workers and registrations are cleaned up.

The main integration points are:

| Area | Source |
| --- | --- |
| Strict manifest and SemVer validation | `src/noloader/core/manifest.ts` |
| Compatibility and dependency graph | `src/noloader/core/dependency-resolver.ts` |
| UI descriptor and stylesheet validation | `src/noloader/core/ui-extension.ts`, `style-extension.ts` |
| Worker API and private message channel | `src/noloader/runtime/mod-worker.ts` |
| Discovery, lifecycle, API routing, permissions | `src/noloader/NoLoaderContext.tsx` |
| Extension manager and host-rendered UI | `src/noloader/NoLoaderPages.tsx`, `ModUiTree.tsx` |
| Native folder access, updates, storage, desktop APIs | `src-tauri/src/noloader.rs` |
| Public extension types and examples | `sdk/types/`, `sdk/` |

## Compatibility and versioning

Three numbers have different purposes:

- **Product release**, such as `1.0.11`, identifies the downloadable NoLoader Launcher app.
- **Extension host version**, currently `0.6.30-noloader.4`, is checked against `launcherVersions` or `launcherVersionRange` in an extension manifest.
- **NoLoader API version**, currently `6`, identifies methods and capabilities available to extension code. Current builds retain support for older APIs 1 through 5.

An extension author can list exact compatible host versions or provide a constrained SemVer range. NoLoader cannot determine automatically that a launcher update did not affect an extension; a range is the author's compatibility promise. See [manifest version rules](modding/manifest.md).

## Isolation and trust

Worker-based extensions do not receive the main launcher DOM, React state, or Tauri command object. They still execute code with the user's account and can make network calls if allowed. `launcher.clientRuntime` deliberately executes a module in the real launcher webview and is full client-code access. `system.files` and `system.process` can read/modify user-accessible files and start programs. These are powerful capabilities, not sandboxed APIs. Review [permissions](modding/permissions.md) and [security limits](modding/security.md) before granting them.

## Installer and releases

The Windows installer is in `apps/installer`. It obtains a signed catalog from the `noloader-catalog` branch and verifies catalog signature, artifact length, and SHA-256 before staging and replacing the selected launcher folder. Backups allow restoration of the original NoRisk launcher. Tagged `noloader-v*` releases use `.github/workflows/noloader-release.yml` to build the prepared launcher, installer, updater signature/manifest, and signed catalog. The latest published release is listed on the [GitHub Releases page](https://github.com/testaccount2109/noriskclient-launcher/releases).

The signed catalog key and Tauri updater signing key are separate GitHub Actions secrets. Private signing keys must never be copied into the repository or distributed with a mod. See [installation](installation.md) and [release process](releases.md).

## Repository and license

This is a community fork based on NoRisk Launcher upstream commit `bfc2e0564f9c0c96d3ce9062deab316647932c64`. Its source is published under the repository's GPL-3.0 license. NoLoader is unofficial and is not affiliated with or endorsed by NoRisk Client. Bundled native components and external services have their own terms; see [third-party notices](third-party.md) before redistributing a build.
