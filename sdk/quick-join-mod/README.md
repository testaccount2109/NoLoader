# NoLoader Last Server Quick Join

This extension adds a quick-join widget below the Play controls. It watches a selected Minecraft profile's `logs/latest.log` for connections, shows the server host, MOTD, and player count, and joins with one click. Its manifest currently requests NoLoader API 5 and targets host version `0.6.30-noloader.4`.

Build the extension:

```powershell
yarn install --frozen-lockfile
yarn sdk:quick-join-mod:build
```

Copy this folder, including `dist/index.js`, `noloader.mod.json`, and `styles.css`, into the folder opened by **NoLoader → Open extensions folder**. Then refresh NoLoader and enable **Last Server Quick Join**. The code uses the public declarations in `sdk/types/no-loader.d.ts`; its required APIs and permissions are listed in the manifest.

The first time, click **Minecraft-Profilordner wählen** and select the folder that contains that profile's `logs` folder. NoLoader then checks `logs/latest.log` every three seconds, so manual joins are detected without installing a Minecraft mod. The log path stays on the PC; to display player counts the extension sends the detected server address to the public `mcsrvstat.us` status API, which caches results for five minutes. Select the profile folder again if you switch Minecraft profiles. The extension has no per-Minecraft-version binaries.
