# Game Mod Import

This API 2 example opens NoRisk's native JAR picker for an existing Fabric, Forge, Quilt, or NeoForge profile. The permission is declared in the extension manifest and the picker only opens from the user's button click.

Build it with `yarn sdk:game-mod-import:build`, then copy this folder with `dist/index.js` and `noloader.mod.json` into the NoLoader mods directory. NoLoader 1.0.1 predates API 2 and cannot run this extension; install a launcher build with API 2 first.
