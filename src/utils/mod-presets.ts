import { ModPlatform } from "../types/unified";
import type { UnifiedVersion } from "../types/unified";
import { ContentType, type InstallContentPayload } from "../types/content";
import type { LocalContentItem } from "../hooks/useLocalContentManager";
import type { Profile } from "../types/profile";
import { installContentToProfile } from "../services/content-service";
import UnifiedService from "../services/unified-service";

export type PresetPlatform = "modrinth" | "curseforge";

export interface PresetEntry {
  platform: PresetPlatform;
  project_id: string;
  /** Exact version installed at export time (modrinth version id / curseforge file id). */
  version_id: string;
  name: string;
  version_number?: string | null;
  file_name?: string | null;
  download_url?: string | null;
}

export interface ModPreset {
  kind: "norisk-mod-preset";
  version: 1;
  name: string;
  game_version?: string | null;
  loader?: string | null;
  created_at: string;
  items: PresetEntry[];
}

const platformOf = (item: LocalContentItem): PresetPlatform | null => {
  if (item.modrinth_info?.project_id) return "modrinth";
  if (item.curseforge_info?.project_id) return "curseforge";
  return null;
};

const toModPlatform = (p: PresetPlatform): ModPlatform =>
  p === "modrinth" ? ModPlatform.Modrinth : ModPlatform.CurseForge;

/**
 * Builds a shareable preset from the currently installed mods.
 * Custom/local mods and NoRisk pack mods can't be shared (no public
 * source) and are reported as skipped.
 */
export function buildPresetFromItems(
  name: string,
  profile: Profile,
  items: LocalContentItem[]
): { preset: ModPreset; skipped: string[] } {
  const skipped: string[] = [];
  const entries: PresetEntry[] = [];

  for (const item of items) {
    const platform = platformOf(item);
    if (!platform || item.norisk_info) {
      skipped.push(item.filename);
      continue;
    }
    if (platform === "modrinth" && item.modrinth_info) {
      entries.push({
        platform,
        project_id: item.modrinth_info.project_id,
        version_id: item.modrinth_info.version_id,
        name: item.modrinth_info.name,
        version_number: item.modrinth_info.version_number,
        file_name: item.filename,
        download_url: item.modrinth_info.download_url,
      });
    } else if (platform === "curseforge" && item.curseforge_info) {
      entries.push({
        platform,
        project_id: String(item.curseforge_info.project_id),
        version_id: String(item.curseforge_info.file_id),
        name: item.curseforge_info.name,
        version_number: item.curseforge_info.version_number,
        file_name: item.filename,
        download_url: item.curseforge_info.download_url,
      });
    } else {
      skipped.push(item.filename);
    }
  }

  return {
    preset: {
      kind: "norisk-mod-preset",
      version: 1,
      name: name.trim() || "Mod-Preset",
      game_version: profile.game_version ?? null,
      loader: profile.loader ?? null,
      created_at: new Date().toISOString(),
      items: entries,
    },
    skipped,
  };
}

/** Compact share-code (base64url JSON) for pasting into Discord etc. */
export function encodePreset(preset: ModPreset): string {
  const json = JSON.stringify(preset);
  const b64 = btoa(unescape(encodeURIComponent(json)));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodePreset(code: string): ModPreset {
  const normalized = code.trim().replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const json = decodeURIComponent(escape(atob(padded)));
  const parsed = JSON.parse(json) as Partial<ModPreset>;
  if (
    !parsed ||
    parsed.kind !== "norisk-mod-preset" ||
    !Array.isArray(parsed.items) ||
    typeof parsed.name !== "string"
  ) {
    throw new Error("invalid_preset");
  }
  const items = parsed.items.filter(
    (e): e is PresetEntry =>
      !!e &&
      (e.platform === "modrinth" || e.platform === "curseforge") &&
      typeof e.project_id === "string" &&
      typeof e.version_id === "string"
  );
  return {
    kind: "norisk-mod-preset",
    version: 1,
    name: parsed.name,
    game_version: parsed.game_version ?? null,
    loader: parsed.loader ?? null,
    created_at: parsed.created_at ?? new Date().toISOString(),
    items,
  };
}

export interface PresetInstallResult {
  installed: string[];
  /** Installed, but exact version wasn't available — latest compatible used. */
  approximated: string[];
  skipped: string[];
  failed: { name: string; error: string }[];
}

const isInstalled = (items: LocalContentItem[], entry: PresetEntry): boolean =>
  items.some((i) =>
    entry.platform === "modrinth"
      ? i.modrinth_info?.project_id === entry.project_id
      : String(i.curseforge_info?.project_id) === String(entry.project_id)
  );

function payloadFromVersion(
  profileId: string,
  entry: PresetEntry,
  version: UnifiedVersion,
  name: string
): InstallContentPayload {
  const primary = version.files.find((f) => f.primary) ?? version.files[0];
  if (!primary) throw new Error("no_files");
  return {
    profile_id: profileId,
    project_id: entry.project_id,
    version_id: version.id,
    file_name: primary.filename,
    download_url: primary.url,
    file_hash_sha1: primary.hashes?.sha1,
    file_fingerprint: primary.fingerprint,
    content_name: name,
    version_number: version.version_number,
    content_type: ContentType.Mod,
    loaders: version.loaders,
    game_versions: version.game_versions,
    source: toModPlatform(entry.platform),
  };
}

/**
 * Installs all preset entries into the target profile.
 * Prefers the exact exported version; falls back to the newest version
 * compatible with the target game version and reports it as approximated.
 */
export async function installPreset(
  profile: Profile,
  preset: ModPreset,
  currentItems: LocalContentItem[],
  onProgress?: (done: number, total: number, name: string) => void
): Promise<PresetInstallResult> {
  const result: PresetInstallResult = { installed: [], approximated: [], skipped: [], failed: [] };
  const targetGameVersion = profile.game_version;

  for (let idx = 0; idx < preset.items.length; idx++) {
    const entry = preset.items[idx];
    onProgress?.(idx, preset.items.length, entry.name);

    if (isInstalled(currentItems, entry)) {
      result.skipped.push(entry.name);
      continue;
    }

    try {
      let payload: InstallContentPayload;
      let exact = false;

      if (entry.download_url) {
        // Direct install — no API round-trip needed.
        payload = {
          profile_id: profile.id,
          project_id: entry.project_id,
          version_id: entry.version_id,
          file_name: entry.file_name ?? `${entry.name}.jar`,
          download_url: entry.download_url,
          content_name: entry.name,
          version_number: entry.version_number ?? undefined,
          content_type: ContentType.Mod,
          loaders: profile.loader ? [profile.loader] : undefined,
          game_versions: targetGameVersion ? [targetGameVersion] : undefined,
          source: toModPlatform(entry.platform),
        };
        exact = true;
      } else {
        const response = await UnifiedService.getModVersions({
          source: toModPlatform(entry.platform),
          project_id: entry.project_id,
          loaders: profile.loader ? [profile.loader] : undefined,
        });
        const versions = response.versions ?? [];
        if (versions.length === 0) throw new Error("no_versions");

        let version = versions.find((v) => v.id === entry.version_id) ?? null;
        if (version) {
          exact = true;
        } else {
          version =
            (targetGameVersion
              ? versions.find((v) => v.game_versions?.includes(targetGameVersion))
              : null) ?? versions[0];
        }
        payload = payloadFromVersion(profile.id, entry, version, entry.name);
      }

      await installContentToProfile(payload);
      if (exact) result.installed.push(entry.name);
      else result.approximated.push(entry.name);
    } catch (err) {
      result.failed.push({
        name: entry.name,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  onProgress?.(preset.items.length, preset.items.length, "");
  return result;
}

// ── Local preset library (localStorage) ──────────────────────────────────

const LIBRARY_KEY = "nrc-mod-presets";

export function loadPresetLibrary(): ModPreset[] {
  try {
    const raw = localStorage.getItem(LIBRARY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p): p is ModPreset =>
        !!p && (p as ModPreset).kind === "norisk-mod-preset" && Array.isArray((p as ModPreset).items)
    );
  } catch {
    return [];
  }
}

export function savePresetToLibrary(preset: ModPreset): ModPreset[] {
  const library = loadPresetLibrary().filter((p) => p.name !== preset.name);
  const next = [preset, ...library].slice(0, 50);
  try {
    localStorage.setItem(LIBRARY_KEY, JSON.stringify(next));
  } catch {
    // Quota exceeded — ignore, export via code still works.
  }
  return next;
}

export function deletePresetFromLibrary(name: string): ModPreset[] {
  const next = loadPresetLibrary().filter((p) => p.name !== name);
  try {
    localStorage.setItem(LIBRARY_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
  return next;
}
