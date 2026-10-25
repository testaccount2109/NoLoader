# Extension lifecycle

The launcher performs these steps whenever NoLoader starts or the user refreshes the manager:

1. Resolve the app-data `NoLoader/mods` directory and read versioned settings.
2. Discover mod folders in a deterministic directory order and read bounded manifest files.
3. Parse each manifest and reject invalid fields or paths.
4. Check update feeds for installed extensions that declare them. If a newer version is found and `updates.autoInstall` is `true`, download and validate its ZIP package, replace the extension folder, and refresh discovery so the installed version is used. Update checks also run for disabled extensions; installation does not enable them.
5. Skip individually disabled mods, then check API and launcher compatibility, required exact pins, conflicts, duplicate IDs, and dependency cycles.
6. Start compatible mods in a stable topological order, so required dependencies start first.
7. Read entry points again through the native path validator, require the manifest to be unchanged since discovery, and dynamically import the bundled ES module inside a dedicated Web Worker. The module receives only the NoLoader API; host communication uses a private message port.
8. Validate each message against the manifest permissions and UI descriptor schema before registering it.
9. On failure, mark the mod failed, terminate its worker, remove its pages and navigation items, and block any dependent mod that has not started yet.

Disabling a mod, toggling safe mode, refreshing, or closing the launcher terminates workers and clears their UI registrations and event subscriptions. A mod's `activate(api)` function may return a cleanup function; this runs when the worker receives a graceful shutdown. The host also terminates the worker after 250 ms so a mod cannot prevent cleanup by hanging. Persistent data in `api.storage` is retained across these lifecycle transitions.

Safe mode is stored in `NoLoader/settings.json`. When active, NoLoader discovers and validates extensions but does not start any workers. Per-mod enabled settings are preserved, so the user can turn safe mode off after diagnosing a problem.
