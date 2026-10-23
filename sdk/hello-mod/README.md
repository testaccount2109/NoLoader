# Hello NoLoader SDK example

This example is a small TypeScript extension. It builds to a single ES module with the SDK's Vite configuration and exports `activate(api)`.

```powershell
yarn install --frozen-lockfile
yarn sdk:hello-mod:build
```

After building, copy this directory, including `dist/index.js`, `noloader.mod.json`, and `styles.css`, into the NoLoader mods folder. The launcher verifies the manifest and renders the example page and action.

The example uses only the public declarations in `../../types/no-loader.d.ts`. See the [API reference](../../docs/modding/api-reference.md) and [manifest reference](../../docs/modding/manifest.md) for the implemented interface.
