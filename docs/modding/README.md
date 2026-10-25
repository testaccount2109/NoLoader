# NoLoader extension development

NoLoader extensions add features to the **NoRisk Client launcher**. They run when the launcher is open. They do not load into Minecraft and are not Minecraft JAR mods.

## Start here

1. Follow [Create your first extension](getting-started.md) to build, install, and edit the Hello example.
2. Use the [manifest reference](manifest.md) to set the extension ID, version, host compatibility, entry points, dependencies, and permissions.
3. Look up methods in the [API reference](api-reference.md) and choose only the capabilities listed in [permissions](permissions.md).
4. Learn how NoLoader starts and stops extensions in the [lifecycle guide](lifecycle.md).
5. Read the [security notes](security.md) before requesting access to client runtime, files, processes, or automatic updates.

The public TypeScript definitions are in [`sdk/types/no-loader.d.ts`](../../sdk/types/no-loader.d.ts). Buildable examples are in [`sdk/hello-mod`](../../sdk/hello-mod/README.md), [`sdk/quick-join-mod`](../../sdk/quick-join-mod/README.md), [`sdk/performance-mod`](../../sdk/performance-mod/README.md), and [`sdk/client-runtime-extension`](../../sdk/client-runtime-extension/README.md).

## How extensions work

An installed extension is a folder containing `noloader.mod.json` and a bundled ES module entry point such as `dist/index.js`. The manifest names the extension and lists which APIs it uses. In standard trust mode, the code runs in a dedicated worker and communicates with the launcher through the documented `NoLoaderApi`. The launcher checks each request against the manifest permissions.

NoLoader can render validated pages, navigation items, Play-screen widgets, and buttons declared as data. Extensions may also ask for launcher profile information, saved server details, persistent extension storage, HTTPS calls, events, and selected desktop features. A separately imported high-trust extension can execute directly in the launcher webview; only use that for code you fully trust.

## Compatibility and updates

`apiVersion` identifies the NoLoader API contract. `launcherVersions` and optional `launcherVersionRange` identify launcher **extension host** versions that the author has verified. The visible launcher release number is separate. NoLoader cannot automatically decide whether changes in a host release affect an extension, so authors must check their code before expanding compatibility ranges.

An extension may publish an HTTPS JSON update feed. Updates are only reported by default. With `updates.autoInstall: true`, NoLoader installs newer ZIP packages automatically after checking that the feed and packaged manifest use the same extension ID and version. A valid package still contains executable code, so enable this only for publishers and update hosts you trust.
