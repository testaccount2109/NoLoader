# NoLoader Quick Join Probe

This example adds the most recent NoRisk Quick Play server directly below the Play controls. It demonstrates the after-play home slot, last-server API, and gesture-gated quick launch.

Build the extension:

```powershell
yarn install --frozen-lockfile
yarn sdk:quick-join-mod:build
```

Copy this folder, including `dist/index.js`, `noloader.mod.json`, and `styles.css`, into the folder opened by **NoLoader → Open extensions folder**. Then refresh NoLoader and enable **Quick Join Probe**. The sample uses NoLoader API 2 and works with current API 4 clients through the compatibility layer.

The server display tracks the most recent multiplayer server started with NoRisk Quick Play. Joining a server manually inside Minecraft is not tracked yet. This example is a NoRisk Client extension: it adds a launcher action that starts a profile and joins the saved server.
