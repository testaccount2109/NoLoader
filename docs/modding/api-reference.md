# NoLoader extension API, version 6

An extension exports `activate(api)` from its bundled ES module. It runs in an isolated Web Worker and communicates with NoRisk Client through a private host channel. The public TypeScript declarations are in [`sdk/types/no-loader.d.ts`](../../sdk/types/no-loader.d.ts).

## Launcher UI

Request `ui.pages` to call `api.registerPage({ id, title, content })` and `api.updatePage(id, page)`. Request `ui.navigation` for `api.registerNavigationItem({ id, label, pageId, icon? })`; request `ui.home` for `api.registerHomeWidget({ id, title, content, position? })` and its update method. `api.onAction(callback)` receives actions fired by buttons, toggles, inputs, and selects in those descriptors. Registration methods return cleanup functions.

Request `ui.globalStyles` to use `api.theme.registerGlobalStyles(css)` or `updateGlobalStyles(css)`. Global CSS can affect the launcher's appearance across screens. Styles are validated and removed when the extension stops. Pages use a validated component catalog (text, PNG image, heading, button, toggle, input, select, progress, stack, card); arbitrary React nodes are not accepted.

`api.windows.openPage({ id, title, pageId, width?, height? })` requires `launcher.windows` and opens a registered page in its own desktop window. `api.windows.open({ id, title, width?, height? })` opens a blank extension-owned webview outside the main launcher UI; `api.windows.close(id)` closes that extension's window.

`api.client.execute(source, windowId?)` requires `launcher.clientRuntime`. It schedules a self-contained JavaScript ES module (up to 8 MiB) in the main NoRisk Client webview, or in an extension-owned standalone window when `windowId` is supplied. This code runs in the real client renderer with direct DOM access and full webview context; it can replace any launcher UI or modify client runtime behavior. Bundle all module dependencies into `source`. The module receives a `noLoaderExtension` context with an `AbortSignal` and `onDispose(cleanup)`; cleanup runs when the extension is disabled, fails, or is reloaded. Register listeners, observers, timers, and created DOM nodes for cleanup. This capability removes the UI descriptor restrictions and is equivalent to trusting client code. Errors are reported to the target webview console.

```ts
const windowId = await api.windows.open({ id: "dashboard", title: "My dashboard" });
await api.client.execute(`
  const root = document.querySelector("#noloader-extension-root");
  root.innerHTML = "<h1>Custom dashboard</h1><button id='refresh'>Refresh</button>";
  const button = root.querySelector("#refresh");
  const onRefresh = () => location.reload();
  button.addEventListener("click", onRefresh);
  noLoaderExtension.onDispose(() => { button.removeEventListener("click", onRefresh); root.replaceChildren(); });
`, windowId);
```

The SDK types declare `noLoaderExtension` globally for modules executed this way. Use its signal for cancellable work and `onDispose` for timers, observers, event listeners, and other resources. Modules loaded into standalone windows are disposed when their extension-owned window closes; modules in the main client are disposed when the extension stops or reloads.

## Launcher data and controls

- `api.profiles.list()` (`launcher.profiles.read`) returns profile ID, name, game version, loader, last-played time, and last-played status.
- `api.servers.getLastPlayed()` (`launcher.lastServer.read`) returns the most recent Quick Play target or `null`.
- `api.servers.getLastPlayedStatus()` (`launcher.lastServer.read`) pings only that saved target and returns its MOTD, online/max player counts, favicon, and latency.
- `api.servers.listForProfile(profileId)` (`launcher.profiles.read`) returns saved server names and icons from that profile's Minecraft server list.
- `api.launcher.launchProfile({ profileId, serverAddress? })` (`launcher.launch`) launches an installed NoRisk profile. A supplied address uses the launcher's Quick Play flow. This must be called directly from a user-triggered extension action.
- `api.features.setEnabled(id, enabled)` and `getSnapshot()` (`launcher.features.manage`) manage the documented IDs `curseforge.integration`, `launcher.news`, `launcher.effects`, and `launcher.ads`. Overrides last only while the extension is enabled.
- `api.performance.getSnapshot()` (`launcher.performance.read`) reports extension count and API request/latency metrics.
- `api.notifications.show({ title, body?, kind? })` (`launcher.notifications`) shows an in-launcher notice. Kinds are `info`, `success`, and `error`.
- `api.launcher.openExternal(url)` (`launcher.openExternal`) opens HTTP(S) or mail links and requires a direct user action.
- `api.clipboard.readText()` and `writeText(text)` (`system.clipboard`) access text on the system clipboard.
- `api.dialogs.openFile(options?)`, `openDirectory()`, and `saveFile(options?)` (`system.dialog`) show native pickers; `confirm(title, message)` shows a confirmation. All require a direct user action. File pickers return `null` when cancelled.

NoLoader provides a **Zuletzt gespielter Server** button on the Play screen for Quick Play servers. An extension can offer its own one-click join by reading the saved target and calling `launchProfile` from its button action:

```ts
api.onAction(async (action) => {
  if (action !== "join-last-server") return;
  const server = await api.servers.getLastPlayed();
  if (server) await api.launcher.launchProfile({
    profileId: server.profileId,
    serverAddress: server.address,
  });
});
```

## PC integration

`system.files` is a powerful permission for absolute-path access from the extension host:

```ts
await api.system.files.createDirectory("C:/Users/me/Documents/example", true);
await api.system.files.writeText("C:/Users/me/Documents/example/settings.json", "{}\n");
const entries = await api.system.files.listDirectory("C:/Users/me/Documents/example");
```

The API also provides `readText`, `readBinary`/`writeBinary` (base64), `remove`, `copy`, `move`, and `exists`. Calls cap individual text/binary transfers at 8 MiB. Filesystem scope follows the current user's available access. Recursive removal should be used with care.

`system.process` provides operating-system integration:

```ts
const result = await api.system.process.run({
  program: "git",
  args: ["--version"],
  cwd: "C:/projects/example",
});
const serverPid = await api.system.process.spawn({ program: "my-local-server.exe", args: ["--port", "25565"] });
await api.system.process.open("C:/projects/example");
```

For interactive tools, `api.system.process.start(request)` returns a managed session with a PID. Poll `read(sessionId)` for buffered stdout/stderr, send text with `write(sessionId, text)`, and call `close(sessionId)` to terminate it. Sessions capture output up to 1 MiB and close automatically when their owning extension stops; an extension can manage up to 32 sessions at once. This supports local tools, scripts, development servers, and command-line integrations without leaving orphaned sessions after an extension reload.

`run` captures output, limits each stream to 1 MiB, and terminates after 60 seconds. `spawn` starts a detached long-running process and returns its process ID without capturing output. Neither method elevates privileges. With `system.process`, an extension can run any executable available to the user, so only enable it for code you trust. See [permissions](permissions.md) and [security status](security.md).

## Network, updates, storage, and events

- `api.network.request({ url, method?, headers?, body? })` (`network.http`) supports HTTPS GET/POST/PUT/PATCH/DELETE, up to 32 headers, 256 KiB request body and 1 MiB response. Redirects are disabled.
- `api.updates.check()` checks the HTTPS update feed declared in the extension manifest. NoLoader checks feeds at startup and when refreshing the manager. When `updates.autoInstall` is enabled in the manifest, a newer ZIP package is installed automatically; otherwise NoLoader only reports download/changelog links.
- `api.storage.get/set/delete` (`storage.mod`) persists JSON for this extension only. Values are limited to 64 KiB; a store to 256 KiB.
- `api.events.on/emit` (`events.subscribe`/`events.publish`) sends transient namespaced JSON events to other running extensions. A publisher can emit only under its own ID; payloads are limited to 16 KiB.

## Manifest and lifecycle

See the [manifest reference](manifest.md), [getting started guide](getting-started.md), and [permission list](permissions.md). The manifest declares requested capabilities, exact dependencies and launcher compatibility. API calls without the corresponding permission fail with an error. Extensions can return a cleanup function from `activate(api)`; all registered UI, events, and worker resources are cleared on stop.

NoLoader extensions extend NoRisk Client and its desktop integration; this API does not create or install Minecraft mods. Minecraft profile launch is available as a normal launcher action.
