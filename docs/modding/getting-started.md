# Build a NoLoader extension

NoLoader extensions add pages and validated widgets to the NoRisk Launcher. They do not modify Minecraft or run inside the game process.

## Build and install the example

Build the TypeScript example with the SDK's checked-in Vite configuration:

```powershell
yarn install --frozen-lockfile
yarn sdk:hello-mod:build
```

1. Start the NoRisk Launcher with NoLoader.
2. Open **NoLoader** and choose **Open mods folder**.
3. Copy the `sdk/hello-mod` folder, including its generated `dist` directory, into the folder that opened.
4. Return to NoLoader and choose **Refresh**.
5. Select **Hello NoLoader** and follow its **Hello** navigation item.

The example page includes a button whose action updates the page through the worker API. It also demonstrates listing launcher profiles and joining the most recent multiplayer Quick Play server when one has been recorded.

## Create a mod

Copy `sdk/hello-mod` and edit `noloader.mod.json`. Each mod lives in its own directory and must contain the manifest and every declared entry point. The `launcherVersions` list must contain the exact launcher version shown by the NoLoader manager. The stable API version is `1`.

The frontend entry point is a self-contained ES module bundle with a named `activate(api)` export. Bundle dependencies into the single file. The returned cleanup function runs when the mod is disabled, restarted, or the launcher tears down its worker.

Declare only the permissions the mod uses. The API includes `ui.pages`, `ui.navigation`, `ui.home`, `ui.globalStyles`, `launcher.profiles.read`, `launcher.lastServer.read`, `launcher.launch`, `storage.mod`, `events.publish`, and `events.subscribe`. A permission controls calls through the NoLoader API; it is not an operating-system permission. The manager's mod details show the permissions requested in the manifest.

See [the manifest reference](manifest.md), [the API reference](api-reference.md), [lifecycle](lifecycle.md), [permissions](permissions.md), and [security status](security.md) before distributing an extension.
