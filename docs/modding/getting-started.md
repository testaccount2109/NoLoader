# Build a NoLoader extension

NoLoader uses two extension paths. JavaScript extensions add launcher pages, Quick Join widgets, and permission-gated launcher features. Game mods are Java JARs loaded in Minecraft by a profile's Fabric, Forge, Quilt, or NeoForge loader. NoLoader extensions do not run inside the game process; use the loader's game-mod API for Minecraft changes.

## Build and install the example

Build the TypeScript example with the SDK's checked-in Vite configuration:

```powershell
yarn install --frozen-lockfile
yarn sdk:quick-join-mod:build
yarn sdk:game-mod-import:build
yarn sdk:performance-mod:build
```

1. Start the NoRisk Launcher with NoLoader.
2. Open **NoLoader** and choose **Open mods folder**.
3. Copy the `sdk/quick-join-mod` folder, including its generated `dist` directory, into the folder that opened.
4. Return to NoLoader and choose **Refresh**.
5. Select **Quick Join Probe**.

The launcher shows a built-in button for the latest server launched through NoRisk Quick Play below the Play controls. The `sdk/quick-join-mod` example also demonstrates that feature through the mod API. To add separate examples, build and install `sdk/game-mod-import` or `sdk/performance-mod` in the same way. The game-mod importer opens the native file picker from a user click. The performance page can disable CurseForge integration, news, background and skin effects, and ad UI, and reports mod API latency.

## Modify Minecraft itself

Create a JAR game mod for the same Minecraft version and loader as the target NoRisk profile. NoRisk already directs each supported profile to its managed mods directory and can import local JARs through its native picker. Fabric entrypoints support initialization and callbacks; Fabric Mixins can transform Minecraft and other mod classes. See the [game-mod API](api-reference.md#launcher-and-multiplayer-apis) and [official Fabric Loader guide](https://docs.fabricmc.net/develop/loader/) for the in-game extension model.

## Create a mod

Copy an SDK example and edit `noloader.mod.json`. Each launcher extension lives in its own directory and must contain the manifest and every declared entry point. The `launcherVersions` list must contain the exact launcher version shown by the NoLoader manager. NoLoader API 2 is current and continues to load API 1 extensions. NoLoader 1.0.1 clients support only API 1 and cannot run API 2 extensions.

The frontend entry point is a self-contained ES module bundle with a named `activate(api)` export. Bundle dependencies into the single file. The returned cleanup function runs when the mod is disabled, restarted, or the launcher tears down its worker.

Declare only the permissions the extension uses. The API includes `ui.pages`, `ui.navigation`, `ui.home`, `ui.globalStyles`, `launcher.profiles.read`, `launcher.lastServer.read`, `launcher.launch`, `game.mods.install`, `launcher.features.manage`, `launcher.performance.read`, `storage.mod`, `events.publish`, and `events.subscribe`. A permission controls calls through the NoLoader API; it is not an operating-system permission. The manager's mod details show the permissions requested in the manifest.

See [the manifest reference](manifest.md), [the API reference](api-reference.md), [lifecycle](lifecycle.md), [permissions](permissions.md), and [security status](security.md) before distributing an extension.

For the separate Minecraft-side pipeline, see [game mods](game-mods.md) and the [Fabric game-mod template](../../sdk/game-mod-template/README.md).
