# NoLoader security status

Extensions execute as modules in dedicated Web Workers rather than inside the launcher's React bundle. They have no direct DOM or launcher-window access and use a private host message channel. The host validates manifests and UI descriptors, checks requested capabilities, bounds API message sizes and rates, and supervises worker health.

Those controls are not an operating-system sandbox. Extensions with `launcher.clientRuntime` can run arbitrary JavaScript in the client webview and control all rendered client UI. Extensions with `system.files` can read, overwrite, move, or delete files available to the current Windows user. Extensions with `system.process` can start programs as that user. The launcher does not elevate them, but they can still use any permissions the logged-in account already has. Review the extension's source and author before granting these capabilities. Network access, global styles, and launcher control also have meaningful effects.

The `system.process.run` host call accepts program, arguments, working directory, and environment; it applies argument/output limits and a 60-second timeout. `system.files` uses Tauri filesystem access with the desktop capability scope. Extension workers do not receive Tauri command objects directly; `launcher.clientRuntime` is an explicit escape hatch that executes code in the client webview and can reach anything exposed to that webview.

## Known limits

The worker has no hard CPU or memory quota. A malicious extension can consume resources or make allowed network requests. Browser/WebView vulnerabilities remain possible. Permission names gate the NoLoader host API, not arbitrary actions performed by a process started with `system.process`. Safe mode stops extensions but does not reverse changes they already made to files or other programs.

The data-only UI system remains available for extensions that do not request client runtime access. `launcher.clientRuntime` allows custom DOM and client-side scripts without the component catalog. Update feeds are checked at startup, but new versions are shown with links and are not silently downloaded or installed.

This is an implementation summary, not an independent security audit. See [permissions](permissions.md) for the capabilities shown to users.
