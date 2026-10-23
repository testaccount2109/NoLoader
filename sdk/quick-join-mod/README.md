# NoLoader Quick Join Probe

This example adds the most recent NoRisk Quick Play server directly below the Play controls. It demonstrates the after-play home slot, last-server API, and gesture-gated quick launch.

Build the extension:

```powershell
yarn install --frozen-lockfile
yarn sdk:quick-join-mod:build
```

Copy this folder, including `dist/index.js`, `noloader.mod.json`, and `styles.css`, into the folder opened by **NoLoader → Open mods folder**. Then refresh NoLoader and enable **Quick Join Probe**. This package requires NoLoader API 2; older 1.0.1 clients report it as incompatible instead of showing an unknown-permission manifest error.

The server display tracks the most recent multiplayer server started with NoRisk Quick Play. Joining a server manually inside Minecraft is not tracked yet. Game mods are Java JARs loaded by the profile's Fabric, Forge, Quilt, or NeoForge loader; they run in Minecraft and can change game behavior. Use mods you trust and match them to the profile's game version and loader. For a buildable Fabric client mod starter, see [`sdk/game-mod-template`](../game-mod-template/README.md).
