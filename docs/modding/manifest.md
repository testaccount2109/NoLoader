# NoLoader mod manifest, schema version 1

The core reads UTF-8 JSON named `noloader.mod.json`. It rejects malformed JSON, unknown fields, unsupported schema versions, invalid SemVer, unknown permissions, duplicate IDs within a list, and unsafe entry-point paths. The manifest is limited to 256 KiB.

```json
{
  "schemaVersion": 1,
  "id": "org.noloader.hello",
  "name": "Hello NoLoader",
  "version": "1.0.0",
  "description": "A small example of a NoLoader launcher page and action.",
  "authors": ["Alex Example"],
  "apiVersion": 1,
  "launcherVersions": ["0.6.30-noloader.4"],
  "launcherVersionRange": ">=0.6.30-noloader.4 <0.6.30-noloader.5",
  "updates": {
    "manifestUrl": "https://example.org/mod/latest.json",
    "autoInstall": false
  },
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
- `updates.manifestUrl`: optional HTTPS JSON feed URL. The feed returns `{ "id": "org.example.hello", "version": "1.2.0", "downloadUrl": "https://…", "changelogUrl": "https://…" }`. `downloadUrl` and `changelogUrl` may be omitted for notification-only feeds; automatic installation requires `downloadUrl`. Every supplied link must use HTTPS.
- `updates.autoInstall`: optional boolean, default `false`. When `true`, NoLoader downloads and installs a newer version on startup or when the mod manager refreshes. `downloadUrl` must point to a ZIP whose root contains `noloader.mod.json` and the mod files; the manifest ID and version must match the feed. The ZIP is staged and checked before replacing the installed folder.
- `apiVersion`: required positive integer. API 6 is the current API; current NoLoader builds also support API 1 through 5. Set this to the oldest API version that includes every API method your extension calls. It is not the launcher product version.
- `launcherVersions`: required non-empty list of at most 32 SemVer versions. Compatibility is an exact SemVer precedence match against the running extension host version.
- `launcherVersionRange`: optional SemVer range made of up to eight space-separated comparisons, for example `>=0.6.30-noloader.4 <0.6.30-noloader.5`. It is checked against the extension host version, not the launcher product version. When present, it takes precedence over `launcherVersions`. Declare versions as compatible only after checking that your code works there; NoLoader cannot infer whether a launcher change affects an extension.
- `entrypoints.frontend`: required relative `.js` or `.mjs` file path.
- `entrypoints.styles`: optional relative `.css` file path.
- The frontend file is a self-contained ES module bundle with a named `activate(api)` export. Bundle dependencies into the entry point; the SDK's Vite configuration emits one module file.
- Styles are limited to 2 MiB and mounted in a Shadow DOM. Common `@import`, `url()`, `expression()`, `-moz-binding`, and `behavior:` forms are rejected.
- `dependencies`: optional list of `{ "id": string, "version": SemVer }` exact pins. A missing or mismatched required dependency blocks the mod.
- `optionalDependencies`: same shape as required dependencies. Missing or mismatched optional dependencies do not block the mod and do not affect load order.
- `conflicts`: optional list of mod IDs. A conflict declared by either installed mod blocks both.
- `permissions`: optional list of documented `ui.*`, `launcher.*`, `system.*`, `storage.mod`, `events.*`, and `network.http` capabilities. The parser rejects unknown permission names; see [permissions](permissions.md) for the current list. File and process access are powerful PC-level capabilities. Permissions are enforced by the NoLoader host API, not by the operating system.

If an older launcher reports `permissions[n]: Unknown permission`, the installed core predates the requested capability. Install a launcher build that supports the mod's API and permission list. Replacing the permission with a different existing one is unsafe because it changes what the user is approving.

SemVer values are parsed numerically. Required dependency pins and exact launcher versions compare numeric major/minor/patch and prerelease ordering; build metadata does not change precedence. Launcher ranges support `>`, `>=`, `<`, `<=`, and `=` comparisons joined with spaces; every comparison must match. For example, `>=0.6.30-noloader.4 <0.6.30-noloader.5` accepts host version `.4` but rejects `.5`. IDs and paths are case-sensitive. The native loader canonicalizes entry points against the mod directory and rejects symlinks outside it; frontend lexical validation alone is not a filesystem boundary.

The application release version (for example `1.0.11`) and extension host version (for example `0.6.30-noloader.4`) are different version numbers. The product release identifies the downloadable launcher; `launcherVersions` and `launcherVersionRange` match the extension host version returned by NoLoader.

The parser, dependency resolver, feature policy, and bounded UI descriptor validators are implemented in `src/noloader/core`. The UI catalog supports text, headings, buttons, toggles, inputs, selects, progress indicators, stacks, and cards; it does not accept arbitrary HTML or React code.
