# NoRisk Launcher project notes

This file is maintained because `.cursor/rules/noriskclient-launcher.mdc` requires project notes and the complete SQLite schema here. The schema below is transcribed from `src-tauri/migrations/0001_init_cache.sql` through `0005_profile_sync_mod_exclusions.sql`. When a migration changes, update this document in the same change.

## Repository facts

- Upstream: `https://github.com/NoRiskClient/noriskclient-launcher`
- Analyzed revision: `bfc2e0564f9c0c96d3ce9062deab316647932c64` (`v3`)
- License: GPL-3.0; check `LICENSE` and `README.md` before redistribution.
- Frontend: React 18, TypeScript, Vite, Yarn Classic.
- Desktop/backend: Tauri 2, Rust 2021, SQLx with SQLite.
- Native database file: `app.db`; connection lifecycle and migrations are implemented in `src-tauri/src/state/db.rs`.
- The complete NoLoader repository analysis is in [`docs/architecture.md`](docs/architecture.md).

## NoLoader manifest contract (schema version 1)

- `schemaVersion` is the integer `1`; unsupported values are rejected.
- `apiVersion` is a positive integer. API compatibility requires exact equality, not lexical or SemVer range comparison.
- Mod `version`, `launcherVersions`, and dependency `version` values use valid SemVer strings. Launcher compatibility is membership in the manifest's exact version list; comparison uses SemVer precedence (numeric core and prerelease ordering, with build metadata ignored). Dependencies pin one exact SemVer precedence; ranges are not accepted.
- Required dependencies must exist at the pinned version and load first. Optional dependencies never block a mod and do not impose ordering; they are reported as available only when the matching mod is eligible.
- IDs are lowercase and namespaced. Manifest fields and dependency objects are strict; unknown fields and permissions are rejected.
- Frontend entry points must be relative `.js` or `.mjs` paths; styles must be relative `.css` paths. Lexical traversal, absolute paths, backslashes, encoded paths, and unsupported extensions are rejected. Native commands canonicalize paths and reject symlinks that leave the managed mod root; this needs a Rust/Windows runtime check.
- `permissions` is currently limited to `ui.navigation` and `ui.pages`; NoLoader checks it at the host API boundary.
- UI pages use a validated component catalog (`text`, `heading`, `button`, `stack`, `card`). Arbitrary HTML and React components are not accepted.
- The parser rejects manifests larger than 256 KiB and caps list sizes.
- Mod state is stored in app data at `NoLoader/settings.json` with schema version `1`, a safe-mode flag, and disabled mod folder names. Updates preserve unknown JSON fields.
- The worker host caps startup at 32 mods, 32 pages per mod, 32 navigation items per mod, 100 API messages per second, and 128 KiB per API message.

See [`docs/modding/manifest.md`](docs/modding/manifest.md) for the JSON example and validation behavior. The loader, UI host, worker boundary, safe mode, and native file-system commands are implemented; native build and runtime verification remain outstanding.

## SQLite schema

SQLite declarations below preserve the migration's column types, nullability, defaults, keys, and indexes. Foreign keys are only listed where a migration explicitly declares them.

### `cache` — migration 0001

| Column      | Declaration                    |
| ----------- | ------------------------------ |
| `id`        | `TEXT NOT NULL COLLATE NOCASE` |
| `data_type` | `TEXT NOT NULL`                |
| `alias`     | `TEXT NULL COLLATE NOCASE`     |
| `data`      | `TEXT NULL`                    |
| `expires`   | `INTEGER NOT NULL`             |

Primary key: (`id`, `data_type`). Unique: (`data_type`, `alias`). Index: `cache_expires_idx` on (`data_type`, `expires`). A `NULL` data value is a negative cache entry; expiry is interpreted by Rust so stale entries remain available for stale-while-revalidate.

### `profiles` — migration 0002

| Column                        | Declaration                             |
| ----------------------------- | --------------------------------------- |
| `id`                          | `TEXT PRIMARY KEY NOT NULL`             |
| `name`                        | `TEXT NOT NULL`                         |
| `path`                        | `TEXT NOT NULL`                         |
| `game_version`                | `TEXT NOT NULL`                         |
| `loader`                      | `TEXT NOT NULL`                         |
| `loader_version`              | `TEXT NULL`                             |
| `created`                     | `INTEGER NOT NULL`                      |
| `last_played`                 | `INTEGER NULL`                          |
| `state`                       | `TEXT NOT NULL DEFAULT 'not_installed'` |
| `selected_norisk_pack_id`     | `TEXT NULL`                             |
| `source_standard_profile_id`  | `TEXT NULL`                             |
| `group_name`                  | `TEXT NULL`                             |
| `use_shared_minecraft_folder` | `INTEGER NOT NULL DEFAULT 0`            |
| `is_standard_version`         | `INTEGER NOT NULL DEFAULT 0`            |
| `description`                 | `TEXT NULL`                             |
| `preferred_account_id`        | `TEXT NULL`                             |
| `playtime_seconds`            | `INTEGER NOT NULL DEFAULT 0`            |
| `settings`                    | `TEXT NOT NULL DEFAULT '{}'`            |
| `banner`                      | `TEXT NULL`                             |
| `background`                  | `TEXT NULL`                             |
| `norisk_information`          | `TEXT NULL`                             |
| `modpack_info`                | `TEXT NULL`                             |
| `extra`                       | `TEXT NOT NULL DEFAULT '{}'`            |
| `updated_at`                  | `INTEGER NOT NULL DEFAULT 0`            |

Indexes: `profiles_path_idx` on (`path`), `profiles_group_idx` on (`group_name`), and partial index `profiles_source_standard_idx` on `source_standard_profile_id` when it is not `NULL`.

### `profile_mods` — migration 0002

| Column                   | Declaration                  |
| ------------------------ | ---------------------------- |
| `profile_id`             | `TEXT NOT NULL`              |
| `id`                     | `TEXT NOT NULL`              |
| `ordinal`                | `INTEGER NOT NULL`           |
| `source`                 | `TEXT NOT NULL`              |
| `source_type`            | `TEXT NOT NULL`              |
| `project_id`             | `TEXT NULL`                  |
| `version_id`             | `TEXT NULL`                  |
| `file_name`              | `TEXT NULL`                  |
| `enabled`                | `INTEGER NOT NULL DEFAULT 1` |
| `display_name`           | `TEXT NULL`                  |
| `version`                | `TEXT NULL`                  |
| `game_versions`          | `TEXT NULL`                  |
| `file_name_override`     | `TEXT NULL`                  |
| `associated_loader`      | `TEXT NULL`                  |
| `modpack_origin`         | `TEXT NULL`                  |
| `updates_enabled`        | `INTEGER NOT NULL DEFAULT 1` |
| `force_include_versions` | `TEXT NOT NULL DEFAULT '[]'` |
| `extra`                  | `TEXT NOT NULL DEFAULT '{}'` |

Primary key: (`profile_id`, `id`). Foreign key: `profile_id` references `profiles(id) ON DELETE CASCADE`. Indexes: `profile_mods_profile_idx` on (`profile_id`, `ordinal`) and partial `profile_mods_project_idx` on (`source_type`, `project_id`) when `project_id` is not `NULL`.

### `profile_disabled_norisk_mods` — migration 0002

Columns: `profile_id TEXT NOT NULL`, `pack_id TEXT NOT NULL`, `mod_id TEXT NOT NULL`, `game_version TEXT NOT NULL`, `loader TEXT NOT NULL`. Primary key: (`profile_id`, `pack_id`, `mod_id`, `game_version`, `loader`). Foreign key: `profile_id` references `profiles(id) ON DELETE CASCADE`.

### `app_meta` — migration 0002

Columns: `key TEXT PRIMARY KEY NOT NULL`, `value TEXT NOT NULL`.

### `profiles_legacy_import` — migration 0002

Columns: `id TEXT PRIMARY KEY NOT NULL`, `ordinal INTEGER NOT NULL`, `raw TEXT NOT NULL`, `parsed INTEGER NOT NULL DEFAULT 1`, `parse_error TEXT NULL`, `imported_at INTEGER NOT NULL`.

### `sync_packs` — migration 0003

Columns: `id TEXT PRIMARY KEY`, `name TEXT NOT NULL`, `description TEXT NULL`, `icon TEXT NULL`, `enabled INTEGER NOT NULL DEFAULT 1`, `sort_order INTEGER NOT NULL DEFAULT 0`, `created INTEGER NOT NULL`, `updated INTEGER NOT NULL`.

### `sync_pack_targets` — migration 0003

Columns: `id TEXT PRIMARY KEY`, `pack_id TEXT NOT NULL`, `path TEXT NOT NULL`, `enabled INTEGER NOT NULL DEFAULT 1`, `kind TEXT NOT NULL`, `external_path TEXT NULL`. Unique: (`pack_id`, `path`). Index: `sync_pack_targets_pack_idx` on (`pack_id`). The migration does not declare a foreign key for `pack_id`.

### `sync_pack_mods` — migration 0003

Columns: `pack_id TEXT NOT NULL`, `mod_id TEXT NOT NULL`, `data TEXT NOT NULL`, `version_overrides TEXT NOT NULL DEFAULT '{}'`, `icon_url TEXT NULL`. Primary key: (`pack_id`, `mod_id`).

### `sync_pack_mod_resolutions` — migration 0003

Columns: `pack_id TEXT NOT NULL`, `project_key TEXT NOT NULL`, `mc_version TEXT NOT NULL`, `loader TEXT NOT NULL`, `version_id TEXT NOT NULL`, `version_name TEXT NULL`, `filename TEXT NOT NULL`, `download_url TEXT NOT NULL`, `sha1 TEXT NULL`, `file_size INTEGER NULL`, `resolved_at INTEGER NOT NULL`. Primary key: (`pack_id`, `project_key`, `mc_version`, `loader`). Index: `sync_pack_mod_resolutions_pack_idx` on (`pack_id`).

### `sync_pack_target_state` — migration 0003

Columns: `pack_id TEXT NOT NULL`, `target_path TEXT NOT NULL`, `last_sync INTEGER NULL`, `content_sha1 TEXT NULL`, `last_source_profile TEXT NULL`. Primary key: (`pack_id`, `target_path`).

### `sync_pack_adoptions` — migration 0003

Columns: `pack_id TEXT NOT NULL`, `target_path TEXT NOT NULL`, `profile_id TEXT NOT NULL`. Primary key: (`pack_id`, `target_path`, `profile_id`).

### `profile_sync_packs` — migration 0003

Columns: `profile_id TEXT NOT NULL`, `pack_id TEXT NOT NULL`, `ordinal INTEGER NOT NULL`. Primary key: (`profile_id`, `pack_id`). Foreign key: `profile_id` references `profiles(id) ON DELETE CASCADE`. Index: `profile_sync_packs_pack_idx` on (`pack_id`).

### `legal_acceptances` — migration 0004

Columns: `slug TEXT NOT NULL`, `locale TEXT NOT NULL`, `version INTEGER NOT NULL`, `accepted_at INTEGER NOT NULL`. Primary key: (`slug`, `locale`).

### `profile_sync_mod_exclusions` — migration 0005

Columns: `profile_id TEXT NOT NULL`, `pack_id TEXT NOT NULL`, `mod_key TEXT NOT NULL`. Primary key: (`profile_id`, `pack_id`, `mod_key`). Foreign key: `profile_id` references `profiles(id) ON DELETE CASCADE`.

## Migration rules

- Add forward-only SQL migrations under `src-tauri/migrations` and retain the existing migration history.
- Update this schema inventory in the same change as every migration.
- Do not introduce NoLoader state into existing profile tables unless the feature genuinely belongs to launcher profile state; prefer a separate, documented schema or app-data directory when appropriate.
- Preserve user data and follow the database backup/recovery behavior in `src-tauri/src/state/db.rs`.
