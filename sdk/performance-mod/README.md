# Launcher Performance Controls

This mod uses NoLoader API 2 to disable optional launcher features. Turning off News prevents its panel and requests from mounting; turning off CurseForge hides its source selector and blocks direct CurseForge service calls; turning off Effects disables the animated player renderer and background grid; turning off Ads unmounts the ad component. Disabling this mod removes its overrides and restores default behavior.

The performance page reports active extension count and extension API request volume/latency. These are launcher extension metrics, not a claim about whole-process CPU or memory. Build with `yarn sdk:performance-mod:build`, then copy this directory with `dist/index.js` and `noloader.mod.json` into the NoLoader mods folder. Requires a launcher build with NoLoader API 2.
