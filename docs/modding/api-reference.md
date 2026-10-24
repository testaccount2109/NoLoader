# NoLoader frontend API, version 2

An entry point exports `activate(api)`. No global launcher object is exposed. API calls use a private `MessagePort`, are validated by the host, and are available only to the extension module in its worker. Direct messages sent through the worker global are ignored.

## Available mod features

Launcher mods can add validated launcher pages, home widgets, navigation links, scoped or global themes, persistent mod-owned settings, and namespaced events for other mods. With explicit manifest permissions they can also read basic profile metadata, open a JAR picker or install a bundled game-mod JAR into a selected loader profile, start a profile from a button, or control the launcher's documented optional features. The [TypeScript declarations](../../sdk/types/no-loader.d.ts) describe the complete API surface.

Enabled launcher mods start automatically when NoLoader starts. Minecraft game mods are Java JARs loaded by Fabric, Forge, Quilt, or NeoForge when a selected profile starts; installing one does not load code into a game that is already running. NoLoader does not provide an API for arbitrary client source patches or silent game-process injection. See [game mods](game-mods.md) for the separate Minecraft-side workflow.

## `api.registerPage(page)`

Requires the `ui.pages` permission. `page` has `{ id, title, content }`. IDs use lowercase letters, digits, `_`, or `-`; titles are at most 80 characters. Content is a bounded tree of the component types documented below. The returned function unregisters the page and navigation items that point to it.

## `api.updatePage(pageId, page)`

Requires `ui.pages`. The page must already be registered by this mod. The descriptor's `id` must match `pageId`; the entire descriptor is validated before it replaces the current page.

## `api.registerNavigationItem(item)`

Requires `ui.navigation`. `item` has `{ id, label, pageId, icon? }`. The page must already be registered by the same mod. The only supported icons are `puzzle`, `sparkles`, and `info`. The returned function removes the item.

## `api.registerHomeWidget(widget)` and `api.updateHomeWidget(widgetId, widget)`

Require `ui.home`. Widgets use `{ id, title, content, position? }`. `position` may be `before-play` (the default) or `after-play`, which places the widget directly below the Play controls. A mod may register up to 8 widgets. Updates must keep the registered ID; the returned function removes the widget.

## `api.theme.registerGlobalStyles(styles)` and `api.theme.updateGlobalStyles(styles)`

Require `ui.globalStyles`. This adds a stylesheet to the launcher document, so a mod can restyle existing screens and layout selectors across the whole launcher. Stylesheets are limited to 96 KiB and reject `@import`, `url()`, `expression()`, `-moz-binding`, and `behavior:`. Treat global styles as a powerful visual override; they are removed automatically when the extension stops, and the returned function removes the stylesheet early.

## `api.onAction(callback)`

Registers the function that receives action IDs from buttons and controls in the mod's pages. The callback receives `(action, value?)`, where a toggle supplies a boolean and text/select controls supply a string. It returns a function that removes that handler. A mod with interactive controls must register its handler during activation and keep it registered while those controls are visible. Action IDs use lowercase letters, digits, `_`, or `-`.

Button nodes contain `{ type: "button", id, label, action }`. The `id` identifies the UI node; `action` is passed to the callback.

## Launcher and multiplayer APIs

These calls use the same private request/response channel as the UI API. They are checked against the mod's manifest permissions by the launcher host; extensions cannot call Tauri commands directly. Profile and last-server reads are available after activation to mods whose users approved the corresponding manifest permissions. Quick Play and game-mod installation remain bound to a direct button action.

- `api.profiles.list()` requires `launcher.profiles.read` and returns only profile ID, name, game version, loader, last-played time, and whether the profile is the launcher's last-played profile. Profile paths, settings, and account data are not included.
- `api.servers.getLastPlayed()` requires `launcher.lastServer.read` and returns the most recent multiplayer Quick Play target requested through NoRisk as `{ profileId, address, playedAt }`, or `null` if none has been recorded. Manual server joins made inside Minecraft are not tracked yet.
- `api.launcher.launchProfile({ profileId, serverAddress? })` requires `launcher.launch`. The profile must exist in the installed launcher configuration. When `serverAddress` is supplied, NoRisk's existing Quick Play path starts Minecraft and requests a direct multiplayer connection. Accepted launcher Quick Play requests are recorded for the last-server API.
- `api.gameMods.importFromPicker(profileId)` requires `game.mods.install`. It opens NoRisk's native JAR picker and imports the chosen game mods into an existing Fabric, Forge, Quilt, or NeoForge profile. It must be called directly from a NoLoader button action.
- `api.gameMods.installBundled(profileId, jarPath)` requires `game.mods.install`. It copies a `.jar` shipped inside the launcher mod's folder into the selected Fabric, Forge, Quilt, or NeoForge profile. `jarPath` is relative to that mod folder, such as `game-mods/feature-addon.jar`; paths cannot escape the folder. The call must come directly from a NoLoader button action. Existing filenames are never overwritten. The loader picks up the JAR on the next game launch, so a running game must be restarted. Minecraft game JARs execute code in the game process and should be reviewed and trusted.
- `api.features.setEnabled(featureId, enabled)` requires `launcher.features.manage`. Supported feature IDs are `curseforge.integration`, `launcher.news`, `launcher.effects` (animated player and background effects), and `launcher.ads`. Changes apply while the mod is enabled and are removed when it stops. When multiple mods set the same feature, a disabled value takes precedence.
- `api.features.getSnapshot()` requires `launcher.features.manage` and returns the effective values for those four feature IDs.
- `api.performance.getSnapshot()` requires `launcher.performance.read` and reports active extension count, API requests in the last minute, and sampled average/maximum API latency. It does not report whole-process CPU or memory usage.

The launcher also shows a built-in **Zuletzt gespielter Server** button on the Play screen when a server was started through NoRisk Quick Play. Clicking it starts the recorded profile and passes the server address to Minecraft's Quick Play connection path. Launcher mods can make the same action with `servers.getLastPlayed()` followed by `launcher.launchProfile({ profileId, serverAddress })` from a button action.

An extension can check the active feature values and set only a documented feature ID:

```ts
const features = await api.features.getSnapshot();
api.features.setEnabled("launcher.effects", !features["launcher.effects"]);
```

The change applies while the mod is enabled and resets when it stops. A launcher mod can package a game JAR in its directory and install it from a visible button action:

```ts
api.onAction(async (action) => {
  if (action !== "install-feature-addon") return;
  try {
    const filename = await api.gameMods.installBundled(
      profileId,
      "game-mods/feature-addon.jar",
    );
    console.info(`Installed ${filename}; restart Minecraft to load it.`);
  } catch (error) {
    console.error("Could not install the game add-on", error);
  }
});
```

An extension must call `launchProfile`, `gameMods.importFromPicker`, or `gameMods.installBundled` while handling a NoLoader button action. The host uses a short-lived, single-use gesture token, so a mod cannot start Minecraft or install game JARs during activation or later from a timer. Handle a rejected promise, for example when the account is signed out, the profile cannot start, or a bundled JAR is missing. A server address must be a host, optional port, or IPv6 address; it cannot contain whitespace or control characters.

## Extension storage

`api.storage.get(key)`, `api.storage.set(key, value)`, and `api.storage.delete(key)` require `storage.mod`. Keys are non-empty strings of at most 128 UTF-8 bytes. Values must be JSON-serializable and may be at most 64 KiB; the complete persistent store for one mod is limited to 256 KiB. `get` returns `undefined` for a missing key, and `delete` returns whether a value was removed. Each extension is bound to its manifest ID by the host and cannot select another extension's storage file.

Storage is kept in the launcher's NoLoader app-data directory when a mod is disabled or uninstalled. The API never returns launcher settings, account information, or another mod's data. Treat stored data as untrusted input when reading it back.

## Extension events

`api.events.on(eventName, callback)` requires `events.subscribe`; it returns an unregister function. A listener receives the JSON payload and `{ name, source }` metadata. `api.events.emit(eventName, value)` requires `events.publish` and resolves to the number of running listeners that received the event.

Event names use `<publisher-mod-id>:<event-name>`, for example `org.example.map:waypoint.added`. Publishers may use only their own manifest ID. Event names are case-sensitive, and the part after `:` must match `[a-z0-9][a-z0-9._-]{0,63}`. Payloads are JSON data no larger than 16 KiB. Each mod may subscribe to 32 names and publish 10 events per second. Events are in-memory notifications; they are not persisted or replayed after startup. Errors thrown by a listener fail that listener's extension and trigger normal worker cleanup.

## UI component catalog

- `{ type: "text", text }`
- `{ type: "heading", level: 1 | 2 | 3, text }`
- `{ type: "button", id, label, action }`
- `{ type: "toggle", id, label, checked, action, disabled? }`
- `{ type: "input", id, label, value, action, placeholder?, maxLength?, disabled? }`
- `{ type: "select", id, label, value, options, action, disabled? }` where `options` contains 1–32 `{ label, value }` entries
- `{ type: "progress", value, label? }` where `value` is between 0 and 100
- `{ type: "stack", direction: "row" | "column", children }`
- `{ type: "card", title?, children }`

The host rejects unknown fields, HTML nodes, unsupported component types, trees over 256 nodes, nesting deeper than 8 levels, and text beyond the documented size limits. Mod CSS is mounted inside a Shadow DOM to scope selectors to that extension page. Styles that use `@import`, `url()`, `expression()`, `-moz-binding`, or `behavior:` are rejected.

## Cleanup and limits

`activate(api)` may return a cleanup function. UI registrations, event subscriptions, and `api.onAction` each return an unregister function as well. Feature overrides are automatically removed when the mod stops. The host terminates a worker on activation failure, on invalid API messages, when it exceeds 100 API messages per second, or after it stops responding to 5-second health checks for 15 seconds. Entry points are limited to 2 MiB and each API message to 128 KiB. Each mod may register up to 32 pages, 8 home widgets, 32 navigation items, and 32 event subscriptions; NoLoader starts at most 32 extensions simultaneously.

No API for launcher accounts, arbitrary files, arbitrary Tauri commands, or Minecraft-process access is exposed. Game mods imported through the explicit native picker are separate Java archives executed by the selected game loader. A worker is a browser-process boundary, not a complete sandbox; see [security status](security.md).
