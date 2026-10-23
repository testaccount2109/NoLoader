# NoLoader threat model

## Assets and trust boundaries

- Launcher account and session state, user files, settings, and native commands remain inside the launcher process.
- Extension folders and their manifests, JavaScript, and CSS are untrusted input.
- The React host and native Tauri commands are privileged relative to extension code.
- Worker messages cross the extension-to-host trust boundary and must be treated as untrusted.

## Attacker capabilities

An installed extension may be malicious or malformed. It can choose its manifest and entry-point contents, send repeated or oversized messages, return invalid UI descriptors, throw during activation or cleanup, and attempt to read paths or invoke APIs outside the documented NoLoader surface.

## Abuse cases and controls

| Abuse path                                               | Control                                                                                | Remaining risk                                                             |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Execute mod code with launcher-window Tauri access       | Run entry points in Web Workers; do not import them into React                         | Browser vulnerabilities; worker may use web APIs allowed by the WebView    |
| Forge host lifecycle or API messages from mod code       | Host control uses a private `MessagePort`; worker-global messages are not consumed     | A compromised browser worker boundary remains in scope                     |
| Escape the managed mod folder                            | Lexical validation, canonical-path checks, symlink rejection                           | Native checks still require platform build and runtime verification        |
| Exhaust UI memory with huge descriptors                  | Message and descriptor size/depth/node limits, per-mod page counts, 32-worker cap      | No hard worker memory/CPU budget                                           |
| Add navigation without permission                        | Host checks `ui.navigation`; page APIs require `ui.pages`                              | Permissions govern the host API only                                       |
| Keep a stale or duplicate page alive                     | Namespaced registries, duplicate checks, worker termination, cleanup on reload/disable | Abrupt application termination does not run mod cleanup code               |
| Enable a faulty extension and make the launcher unusable | Persistent safe mode skips all worker startup                                          | User must open the desktop launcher and change settings to resume          |
| Trigger settings corruption or path replacement          | Bounded reads, schema version, unique temp file, replacement write                     | Concurrency and platform-specific filesystem behavior require native tests |
| Read or overwrite another extension's saved configuration | Host binds requests to the running manifest ID, validates IDs and keys, caps file/value sizes, rejects linked storage files, and serializes atomic updates | Malware running as the same OS user can still inspect user-owned app-data files |
| Flood another extension with events                       | Namespaced publishers, explicit publish/subscribe permissions, 16 KiB payloads, 10 emits/second, and worker message limits | Events are application-level trust between extensions, not a secret channel |
| Load CSS that reaches outside the extension page         | Shadow DOM and rejection of common imports/URLs/executable forms                       | CSS filtering is defense in depth and must not be treated as a sandbox     |

## Out of scope

The current implementation does not provide signed extension packages, a remote extension registry, hard resource quotas, native extensions, backend extensions, or access to Minecraft process memory. It does not verify the publisher identity of a mod. The Windows installer verifies the signed release catalog and archive hash, and the launcher updater verifies signed Windows update artifacts. Both update feeds point to the NoLoader fork. No external security audit has been performed.
