# Build a NoRisk Client extension

NoLoader extends NoRisk Client itself. Extensions run with the launcher, add pages and actions, and can request integrations with the desktop and operating system. This SDK does not build or install Minecraft mods.

## Build and install an example

```powershell
yarn install --frozen-lockfile
yarn sdk:quick-join-mod:build
yarn sdk:performance-mod:build
```

1. Open **NoLoader** in NoRisk Client and choose **Open extensions folder**.
2. Copy an SDK example folder, including its generated `dist` directory, into the opened folder.
3. Return to NoLoader, refresh, and enable the mod.

The `sdk/quick-join-mod` sample demonstrates a launcher page, profile metadata, stored settings, and launching a profile into the last Quick Play server. The performance sample demonstrates feature controls and metrics.

The `sdk/client-runtime-extension` sample demonstrates direct client JavaScript execution, a custom standalone window, native file selection, file writing, and process execution. It requests full-trust permissions and should be read carefully before enabling.

## Create an extension

Copy an SDK example and edit `noloader.mod.json`. Each mod contains its manifest, bundled JavaScript entrypoint, and optional styles. The entrypoint exports `activate(api)` and may return a cleanup callback. Build the frontend as a self-contained ES module; see the SDK's Vite configuration.

Use `api.registerPage` and related registrations for launcher UI, `api.events` to coordinate with other extensions, `api.storage` for extension-owned data, and the `launcher.*` or `system.*` APIs for integrations. Each capability must be listed in `permissions`; NoLoader shows those capabilities in the extension manager. `system.files` and `system.process` grant powerful access to the user's PC.

Extensions can declare an HTTPS update feed in `updates.manifestUrl`. The launcher checks feeds at startup and lists newer versions. It reports a download link but does not replace code automatically.

Read the [API reference](api-reference.md), [manifest schema](manifest.md), [lifecycle](lifecycle.md), [permissions](permissions.md), and [security status](security.md) before publishing.
