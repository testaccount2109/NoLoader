# NoLoader mod manifest, schema version 1

The core reads UTF-8 JSON named `noloader.mod.json`. It rejects malformed JSON, unknown fields, unsupported schema versions, invalid SemVer, unknown permissions, duplicate IDs within a list, and unsafe entry-point paths. The manifest is limited to 256 KiB.

```json
{
  "schemaVersion": 1,
  "id": "org.noloader.hello",
  "name": "Hello NoLoader",
  "version": "1.0.0",
  "description": "A small example of a NoLoader launcher page and action.",
  "apiVersion": 1,
  "launcherVersions": ["0.6.29"],
  "entrypoints": {
    "frontend": "dist/index.js",
    "styles": "styles.css"
  },
  "dependencies": [],
  "optionalDependencies": [],
  "conflicts": [],
  "permissions": ["ui.pages", "ui.navigation"]
}
```

## Field rules

- `schemaVersion`: required integer; only `1` is supported.
- `id`: required lowercase namespaced ID such as `org.example.hello`.
- `name`: required, non-empty, at most 80 characters.
- `version`: required SemVer.
- `description`: optional, at most 2,048 characters.
- `authors`: optional array of at most 32 non-empty names.
- `license`: optional non-empty label; it does not grant redistribution rights.
- `repository`: optional HTTPS URL.
- `apiVersion`: required positive integer. API 2 is current; current NoLoader builds continue to support API 1 extensions. NoLoader 1.0.1 supports API 1 only.
- `launcherVersions`: required non-empty list of at most 32 SemVer versions. Compatibility is an exact SemVer precedence match against the running launcher version.
- `entrypoints.frontend`: required relative `.js` or `.mjs` file path.
- `entrypoints.styles`: optional relative `.css` file path.
- The frontend file is a self-contained ES module bundle with a named `activate(api)` export. Bundle dependencies into the entry point; the SDK's Vite configuration emits one module file.
- Styles are limited to 2 MiB and mounted in a Shadow DOM. Common `@import`, `url()`, `expression()`, `-moz-binding`, and `behavior:` forms are rejected.
- `dependencies`: optional list of `{ "id": string, "version": SemVer }` exact pins. A missing or mismatched required dependency blocks the mod.
- `optionalDependencies`: same shape as required dependencies. Missing or mismatched optional dependencies do not block the mod and do not affect load order.
- `conflicts`: optional list of mod IDs. A conflict declared by either installed mod blocks both.
- `permissions`: optional list of `ui.navigation`, `ui.pages`, `ui.home`, `ui.globalStyles`, `launcher.profiles.read`, `launcher.lastServer.read`, `launcher.launch`, `game.mods.install`, `launcher.features.manage`, `launcher.performance.read`, `storage.mod`, `events.publish`, and `events.subscribe`. These labels govern documented NoLoader API calls only; they do not create an operating-system security boundary.

If an older launcher reports `permissions[n]: Unknown permission`, the installed core predates the requested capability. Install a launcher build that supports the mod's API and permission list. Replacing the permission with a different existing one is unsafe because it changes what the user is approving.

SemVer values are parsed numerically. Required dependency pins and launcher compatibility are exact matches by SemVer precedence: numeric major/minor/patch and prerelease ordering are respected, and build metadata does not change precedence. Version ranges are not accepted in schema version 1. IDs and paths are case-sensitive. The native loader must canonicalize entry points against the mod directory and reject symlinks outside it; frontend lexical validation alone is not a filesystem boundary.

The parser, dependency resolver, feature policy, and bounded UI descriptor validators are implemented in `src/noloader/core`. The UI catalog supports text, headings, buttons, toggles, inputs, selects, progress indicators, stacks, and cards; it does not accept arbitrary HTML or React code.
