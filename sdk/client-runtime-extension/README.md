# Client Runtime Extension Example

This API 5 example demonstrates:

- opening a standalone Tauri webview window;
- running a self-contained JavaScript ES module in the NoRisk Client renderer;
- opening a native save dialog and writing the chosen file;
- starting a local process and displaying its output.

The `launcher.clientRuntime`, `system.files`, `system.process`, and `system.dialog` permissions are intentionally powerful. The client module can manipulate the entire NoRisk Client webview, and the PC integrations run with the current Windows user's privileges. Review this example before enabling it and never grant these permissions to an extension you do not trust.

Build with `yarn sdk:client-runtime-extension:build`, then copy the folder including `dist/` into the NoLoader extensions directory. It targets the NoLoader API 5 launcher version declared in its manifest.
