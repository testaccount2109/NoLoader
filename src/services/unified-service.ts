import {
  ModPlatform,
  type UnifiedModSearchParams,
  type UnifiedModSearchResponse,
  type UnifiedModVersionsParams,
  type UnifiedModpackVersionsResponse,
  type UnifiedVersionResponse,
  type UnifiedProjectType,
  type UnifiedSortType,
  type UnifiedUpdateCheckRequest,
  type UnifiedUpdateCheckResponse,
  type UnifiedVersion,
  type ModpackSwitchRequest,
  type ModpackSwitchResponse,
} from "../types/unified";
import type { CacheBehaviour, ModPackSource } from "../types/profile";
import type { SwitchContentVersionPayload, ContentType } from "../types/content";
import type { LocalContentItem } from "../types/profile";
import { invoke } from "@tauri-apps/api/core";
import { getModFeature } from "../noloader/core/feature-policy";

function requireCurseForgeEnabled(): void {
    if (!getModFeature("curseforge.integration")) {
        throw new Error("CurseForge has been disabled by an enabled NoLoader mod.");
    }
}

export interface BatchUpdateResult {
    applied: number[];
    failed: number[];
}

class UnifiedService {
    static async searchMods(params: UnifiedModSearchParams): Promise<UnifiedModSearchResponse> {
        const effectiveParams = !getModFeature("curseforge.integration") && params.source === ModPlatform.CurseForge
            ? { ...params, source: ModPlatform.Modrinth }
            : params;
        return invoke<UnifiedModSearchResponse>("search_mods_unified_command", { params: effectiveParams });
    }

    static async getModVersions(params: UnifiedModVersionsParams): Promise<UnifiedVersionResponse> {
        if (params.source === ModPlatform.CurseForge) requireCurseForgeEnabled();
        return invoke<UnifiedVersionResponse>("get_mod_versions_unified_command", { params });
    }

    static async checkModUpdates(request: UnifiedUpdateCheckRequest, cacheBehaviour?: CacheBehaviour): Promise<UnifiedUpdateCheckResponse> {
        if (Object.values(request.hash_platforms ?? {}).includes(ModPlatform.CurseForge)) requireCurseForgeEnabled();
        return invoke<UnifiedUpdateCheckResponse>("check_mod_updates_unified_command", { request, cacheBehaviour });
    }

    static async getModpackVersions(modpackSource: ModPackSource, cacheBehaviour?: CacheBehaviour): Promise<UnifiedModpackVersionsResponse> {
        if (modpackSource.source === "curse_forge") requireCurseForgeEnabled();
        return invoke<UnifiedModpackVersionsResponse>("get_modpack_versions_unified_command", {
            modpackSource,
            cacheBehaviour
        });
    }

    static buildSwitchContentVersionPayload(
        profileId: string,
        contentType: ContentType,
        currentItem: LocalContentItem,
        newVersion: UnifiedVersion
    ): SwitchContentVersionPayload {
        return {
            profile_id: profileId,
            content_type: contentType,
            current_item_details: { ...currentItem, path_str: currentItem.path_str },
            new_version_details: newVersion,
        };
    }

    static async switchContentVersion(
        profileId: string,
        contentType: ContentType,
        currentItem: LocalContentItem,
        newVersion: UnifiedVersion
    ): Promise<void> {
        if (newVersion.source === ModPlatform.CurseForge) requireCurseForgeEnabled();
        const payload = UnifiedService.buildSwitchContentVersionPayload(
            profileId,
            contentType,
            currentItem,
            newVersion
        );

        return invoke("switch_content_version", { payload });
    }

    static async switchContentVersions(
        payloads: SwitchContentVersionPayload[]
    ): Promise<BatchUpdateResult> {
        if (payloads.some(({ new_version_details }) => new_version_details.source === ModPlatform.CurseForge)) requireCurseForgeEnabled();
        return invoke<BatchUpdateResult>("update_contents_from_profile", { payloads });
    }

    static async switchModpackVersion(request: ModpackSwitchRequest): Promise<ModpackSwitchResponse> {
        if (request.modpack_source.source === "curse_forge") requireCurseForgeEnabled();
        console.log("Switching modpack version", request);

        return invoke("switch_modpack_version_command", { request });
    }

    static async getCurseForgeFileChangelog(modId: number, fileId: number): Promise<string> {
        requireCurseForgeEnabled();
        console.log("Getting CurseForge file changelog:", { modId, fileId });

        return invoke("get_curseforge_file_changelog_command", { modId, fileId });
    }
}

export default UnifiedService;
