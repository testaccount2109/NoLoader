# Extension permissions

NoLoader extensions declare the capabilities they need in `noloader.mod.json`. Missing permissions reject API calls. The extension manager shows requested permissions when an extension is enabled.

| Permission | API |
| --- | --- |
| `ui.pages` | `registerPage`, `updatePage` |
| `ui.navigation` | `registerNavigationItem` |
| `ui.home` | `registerHomeWidget`, `updateHomeWidget` |
| `ui.globalStyles` | `theme.registerGlobalStyles`, `theme.updateGlobalStyles` |
| `launcher.profiles.read` | `profiles.list` |
| `launcher.lastServer.read` | `servers.getLastPlayed` |
| `launcher.launch` | `launcher.launchProfile` |
| `launcher.features.manage` | `features.setEnabled`, `features.getSnapshot` |
| `launcher.performance.read` | `performance.getSnapshot` |
| `launcher.notifications` | `notifications.show` |
| `launcher.openExternal` | `launcher.openExternal` |
| `launcher.windows` | `windows.openPage`, `windows.close` |
| `system.clipboard` | `clipboard.readText`, `clipboard.writeText` |
| `system.dialog` | `dialogs.openFile`, `openDirectory`, `saveFile`, `confirm` |
| `system.files` | `system.files.*` |
| `system.process` | `system.process.run`, `system.process.open` |
| `network.http` | `network.request` |
| `storage.mod` | `storage.get`, `storage.set`, `storage.delete` |
| `events.publish` | `events.emit` |
| `events.subscribe` | `events.on` |

## PC access

`system.files` allows an extension to read, write, list, create, remove, copy, and move files and directories using absolute paths. `system.process` can run an executable with arguments and open a path with the operating system. A process is stopped after 60 seconds and captured output is limited to 1 MiB per stream. These capabilities can affect any data and applications available to the current Windows user. Grant them only to extensions whose authors and source you trust.

The extension host applies manifest checks before forwarding these calls. The worker is not an operating-system security boundary: an extension with process access can run tools with the user's privileges. NoLoader does not ask Windows to elevate those privileges.

`launcher.windows` opens standalone windows only for pages registered by the same extension. `launcher.openExternal` opens HTTP, HTTPS, or mail links and requires a direct user action. Notifications and clipboard calls are mediated by the host.

`system.dialog` opens native file/folder pickers and confirmation dialogs. These calls require a direct extension UI action, so a page or button must be active when they are requested.

`launcher.features.manage` controls the documented optional launcher features: CurseForge integration, news, animated effects, and ad UI. Overrides are cleared when the extension stops; a disable request takes precedence when extensions disagree. `launcher.performance.read` exposes extension counts and API timing samples only.

`storage.mod` gives each extension a persistent JSON store bound to its manifest ID. Values are limited to 64 KiB and the complete store to 256 KiB. `events.publish` and `events.subscribe` exchange transient, namespaced JSON events between running extensions.

Permissions are a review aid and API gate, not a sandbox. See the [security status](security.md).
