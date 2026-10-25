# Hello NoLoader SDK example

This example is a small TypeScript extension for NoRisk Client. It builds to a single ES module with the SDK's Vite configuration and exports `activate(api)`. Its `noloader.mod.json` shows the minimum metadata, launcher UI permissions, and the generated entry point.

```powershell
yarn install --frozen-lockfile
yarn sdk:hello-mod:build
```

After building, copy this directory, including `dist/index.js`, `noloader.mod.json`, and `styles.css`, into the directory opened by **NoLoader → Open extensions folder**. Refresh NoLoader and enable **Hello NoLoader**. The launcher validates the manifest, loads the ES module in an extension worker, then renders the page and action through the host UI components.

Edit `src/index.ts` for extension behavior and `noloader.mod.json` for its stable ID, version, compatibility, and required permissions. Rebuild after source changes. Read the [first-extension tutorial](../../docs/modding/getting-started.md) before adding desktop permissions or publishing updates.

The example uses only the public declarations in `../../types/no-loader.d.ts`. See the [API reference](../../docs/modding/api-reference.md) and [manifest reference](../../docs/modding/manifest.md) for the implemented interface.
