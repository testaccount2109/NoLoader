# Extension permissions

Permissions declare which calls an extension uses through the NoLoader API. They do not grant operating-system access.

| Permission                 | Available calls                      |
| -------------------------- | ------------------------------------ |
| `ui.pages`                 | `api.registerPage`, `api.updatePage` |
| `ui.navigation`            | `api.registerNavigationItem`         |
| `ui.home`                  | `api.registerHomeWidget`, `api.updateHomeWidget` |
| `ui.globalStyles`          | `api.theme.registerGlobalStyles`, `api.theme.updateGlobalStyles` |
| `launcher.profiles.read`   | `api.profiles.list`                  |
| `launcher.lastServer.read` | `api.servers.getLastPlayed`          |
| `launcher.launch`          | `api.launcher.launchProfile`         |
| `storage.mod`              | `api.storage.get`, `set`, `delete`   |
| `events.publish`           | `api.events.emit`                    |
| `events.subscribe`          | `api.events.on`                      |

An omitted permission rejects that API request. The NoLoader manager displays the manifest's requested permissions before a user enables an extension. Extensions should request only the capabilities they use. `api.onAction` is available for handling actions from a page or home widget and does not expose launcher state.

`storage.mod` gives an extension persistent JSON values in its own file under the launcher's NoLoader app-data directory. One extension cannot select another extension's ID through this API. Each value is limited to 64 KiB and each extension's complete store to 256 KiB. Storage is retained when an extension is disabled or removed; users may delete it manually.

`events.subscribe` and `events.publish` enable extension-to-extension events over the host's private worker ports. Published names must use the publishing extension's ID, for example `org.example.map:waypoint.added`. Subscribers may listen to any valid extension namespace. Payloads must be JSON data under 16 KiB; each extension may subscribe to 32 event names and publish 10 events per second. Events are transient and are not saved or replayed after startup.

Launcher profile metadata, mod-owned storage, extension events, and Quick Play are available only through the narrow calls above. No API exposes accounts, arbitrary files, launcher settings, arbitrary Tauri commands, or Minecraft-process access. Do not treat a permission string as a sandbox boundary. The worker prevents direct DOM and launcher-window API access, but browser-process and resource-exhaustion risks remain; see [security status](security.md).
