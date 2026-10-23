# Game mods in NoRisk Client

NoLoader separates launcher extensions from game mods because they run in different processes:

- **Launcher extensions** are TypeScript modules in a restricted Web Worker. They can add launcher UI and call the capabilities granted by their `noloader.mod.json` permissions.
- **Game mods** are Java JARs. Fabric, Forge, Quilt, or NeoForge loads them inside Minecraft for the matching profile. They can use their loader's entrypoints, game APIs, events, and supported class transformation system.

## Install a game mod

1. Select a NoRisk profile that has Fabric, Forge, Quilt, or NeoForge installed.
2. Obtain a JAR built for that profile's Minecraft version and loader.
3. Use **NoRisk profile → Mods → Import local mods**, or install and use the `sdk/game-mod-import` extension. It demonstrates `api.gameMods.importFromPicker(profileId)`.
4. Start that profile again. NoRisk directs the profile's loader to its managed mods directory.

The local JAR picker asks the player to choose files and does not prove that they are compatible or safe. Mods execute as code in the game process. Use sources you trust and check the required game version, loader, and dependencies.

## Build a game mod

Start from [`sdk/game-mod-template`](../../sdk/game-mod-template/README.md). It is a Fabric Loom client mod with a key binding and an in-game chat message, demonstrating a visible Minecraft-side change. Update its Minecraft, Loader, Fabric API, and Java versions to match the target profile before building.

Fabric Loader discovers JARs through `fabric.mod.json` and entrypoints. Fabric API events cover common hooks; Mixins transform Minecraft classes and other mod classes when a deeper change is needed. See the [Fabric Loader guide](https://docs.fabricmc.net/develop/loader/), [metadata reference](https://docs.fabricmc.net/develop/loader/fabric-mod-json), and [events guide](https://docs.fabricmc.net/develop/events/).

## NoLoader extension API

An extension may request `game.mods.install`. The host then exposes only `api.gameMods.importFromPicker(profileId)`, which:

- must be called from a button action, with a short-lived, single-use gesture token;
- verifies that the selected profile exists and has a supported game loader;
- uses NoRisk's native JAR picker and existing local-mod import command.

The extension does not receive the selected file paths or arbitrary file access. It cannot call Tauri commands directly or inject code into a running Minecraft process. The selected game's loader starts the imported JARs on a later game launch.
