# NoLoader security status

Extensions execute as modules in dedicated Web Workers rather than inside the launcher's React bundle. They have no direct DOM or launcher-window access and use a private host message channel. The host validates manifests and UI descriptors, checks requested capabilities, bounds API message sizes and rates, and supervises worker health.

This describes **standard-trust** extensions. NoLoader also supports a separate high-trust import mode that executes extension code directly in the launcher webview and bypasses the standard worker and API permission boundary. Do not use high trust to avoid adding the correct manifest permissions; reserve it for code you own or have fully reviewed.

Those controls are not an operating-system sandbox. Extensions with `launcher.clientRuntime` can run arbitrary JavaScript in the client webview and control all rendered client UI. Extensions with `system.files` can read, overwrite, move, or delete files available to the current Windows user. Extensions with `system.process` can start programs as that user. The launcher does not elevate them, but they can still use any permissions the logged-in account already has. Review the extension's source and author before granting these capabilities. Network access, global styles, and launcher control also have meaningful effects.

The `system.process.run` host call accepts program, arguments, working directory, and environment; it applies argument/output limits and a 60-second timeout. `system.files` uses Tauri filesystem access with the desktop capability scope. Extension workers do not receive Tauri command objects directly; `launcher.clientRuntime` is an explicit escape hatch that executes code in the client webview and can reach anything exposed to that webview.

## Known limits

The worker has no hard CPU or memory quota. A malicious extension can consume resources or make allowed network requests. Browser/WebView vulnerabilities remain possible. Permission names gate the NoLoader host API, not arbitrary actions performed by a process started with `system.process`. Safe mode stops extension workers but does not reverse changes they already made to files or other programs.

The data-only UI system remains available for extensions that do not request client runtime access. `launcher.clientRuntime` allows custom DOM and client-side scripts without the component catalog.

## Extension updates

Update feeds use HTTPS and NoLoader checks that the feed ID matches the installed extension. When `updates.autoInstall` is enabled, NoLoader downloads the feed's ZIP, checks the package's manifest ID and version, rejects unsafe paths and symbolic links, stages the files, then replaces the installed folder. These checks protect the install process from malformed packages; they do **not** cryptographically identify the author or verify the package's code. The feed host can publish arbitrary executable extension code. Automatic updates should be enabled only when the extension and its update host are trusted. See [update feed format](getting-started.md#add-an-update-feed) and the [manifest rules](manifest.md#field-rules).

This is an implementation summary, not an independent security audit. See [permissions](permissions.md) for the capabilities shown to users.
