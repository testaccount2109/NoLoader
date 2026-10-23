# NoRisk game-mod starter

This is the Minecraft-side part of the NoLoader mod pipeline. It builds a Fabric JAR with a client entrypoint and a key binding: in game, press **O** to print a probe message in chat. It is a real game mod, separate from a TypeScript launcher extension.

## Build

Use JDK 25, then run the checked-in wrapper:

```powershell
.\gradlew.bat build
```

On macOS or Linux, run `bash ./gradlew build`.

The JAR is written to `build/libs/noloader-game-mod-probe-1.0.0.jar`.

## Install in NoRisk Client

1. Create or select a NoRisk profile with Fabric.
2. Set `minecraft_version`, `loader_version`, and `fabric_api_version` in `gradle.properties` to versions compatible with that profile. Keep the matching Minecraft and Java requirements in `fabric.mod.json`.
3. Build the JAR and import it into the profile through **NoRisk profile → Mods → Import local mods**, or from a NoLoader extension that requests `game.mods.install` and calls `api.gameMods.importFromPicker(profileId)` from a button action.
4. Start that profile. NoRisk points Fabric at its profile-specific mods directory, and Fabric loads the JAR there.
5. Open **Options → Controls**, find **NoLoader Game Mod Probe**, and press **O** in a world to see the chat message.

This starter targets Minecraft 26.3 with the current upstream Fabric toolchain. Use matching Fabric versions for other NoRisk profiles; game mods are compiled against Minecraft and their game loader. Extend the client entrypoint with Fabric API events for common hooks, or add a Mixin for a class-level change. Fabric documents entrypoints and Mixins as its in-game loading and transformation points.

See the [NoLoader extension SDK](../quick-join-mod/README.md) for launcher UI modules and the [NoLoader API reference](../../docs/modding/api-reference.md) for the native game-mod import permission.
