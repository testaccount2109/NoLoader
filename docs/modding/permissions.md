# Extension permissions

NoLoader extensions declare the capabilities they need in `noloader.mod.json`. Missing permissions reject API calls. The extension manager shows requested permissions when an extension is enabled.

| Permission | API |
| --- | --- |
| `ui.pages` | `registerPage`, `updatePage` |
| `ui.navigation` | `registerNavigationItem` |
| `ui.home` | `registerHomeWidget`, `updateHomeWidget` |
| `ui.globalStyles` | `theme.registerGlobalStyles`, `theme.updateGlobalStyles` |
| `launcher.profiles.read` | `profiles.list`, `servers.listForProfile` |
| `launcher.lastServer.read` | `servers.getLastPlayed`, `servers.getLastPlayedStatus` |
| `launcher.launch` | `launcher.launchProfile` |
| `launcher.features.manage` | `features.setEnabled`, `features.getSnapshot` |
| `launcher.performance.read` | `performance.getSnapshot` |
| `launcher.notifications` | `notifications.show` |
| `launcher.openExternal` | `launcher.openExternal` |
| `launcher.windows` | `windows.openPage`, `windows.close` |
| `launcher.clientRuntime` | `client.execute` |
| `system.clipboard` | `clipboard.readText`, `clipboard.writeText` |
| `system.dialog` | `dialogs.openFile`, `openDirectory`, `saveFile`, `confirm` |
| `system.files` | `system.files.*` |
| `system.process` | `system.process.run`, `spawn`, `start`, `read`, `write`, `close`, `open` |
| `network.http` | `network.request` |
| `storage.mod` | `storage.get`, `storage.set`, `storage.delete` |
| `events.publish` | `events.emit` |
| `events.subscribe` | `events.on` |

## PC access

`system.files` allows an extension to read, write, list, create, remove, copy, and move files and directories using absolute paths. `system.process.run` runs an executable with arguments and returns bounded output; `spawn` starts a detached process without a time limit; `open` opens a path with the operating system. These capabilities can affect any data and applications available to the current Windows user. Grant them only to extensions whose authors and source you trust.

The extension host applies manifest checks before forwarding these calls. The worker is not an operating-system security boundary: an extension with process access can run tools with the user's privileges. NoLoader does not ask Windows to elevate those privileges.

`launcher.windows` opens standalone windows only for pages registered by the same extension. `launcher.openExternal` opens HTTP, HTTPS, or mail links and requires a direct user action. Notifications and clipboard calls are mediated by the host.

`launcher.clientRuntime` is the highest-trust client capability. It lets an extension execute a bundled JavaScript module in NoRisk Client's main webview or one of its own standalone extension windows. That module can directly access the DOM and the running client renderer, replacing or extending any client UI. Treat it as full client code execution: it can break the interface, inspect rendered information, and invoke capabilities available to the webview. Grant it only to code you have audited and trust completely.

`system.dialog` opens native file/folder pickers and confirmation dialogs. These calls require a direct extension UI action, so a page or button must be active when they are requested.

`launcher.features.manage` controls the documented optional launcher features: CurseForge integration, news, animated effects, and ad UI. Overrides are cleared when the extension stops; a disable request takes precedence when extensions disagree. `launcher.performance.read` exposes extension counts and API timing samples only.

`storage.mod` gives each extension a persistent JSON store bound to its manifest ID. Values are limited to 64 KiB and the complete store to 256 KiB. `events.publish` and `events.subscribe` exchange transient, namespaced JSON events between running extensions.

## Request permissions carefully

Start with an empty `permissions` list and add a capability only when code needs it. For example, a page with a button needs `ui.pages` and often `ui.navigation`; reading profile information needs `launcher.profiles.read`; opening a native file picker needs `system.dialog`. The manifest parser rejects unknown permission names. In standard trust mode, a request made without its permission fails in the host API and returns an error to the extension.

Permissions are a review aid and API gate, not a sandbox. They do not limit direct operating-system actions performed by a process started with `system.process`. High-trust imports bypass the standard extension API boundary and should be treated as fully trusted launcher code. See the [security status](security.md).
