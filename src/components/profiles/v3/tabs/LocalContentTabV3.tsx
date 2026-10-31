"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { VirtuosoGrid } from "react-virtuoso";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { toast } from "react-hot-toast";
import type { Profile } from "../../../../types/profile";
import { ModPlatform, type UnifiedVersion } from "../../../../types/unified";
import {
  type LocalContentItem,
  type LocalContentType,
  useLocalContentManager,
} from "../../../../hooks/useLocalContentManager";
import { useVersionOptions } from "../../../../hooks/useVersionOptions";
import { getUpdateIdentifier } from "../../../../utils/update-identifier-utils";
import * as FlagsmithService from "../../../../services/flagsmith-service";
import UnifiedService from "../../../../services/unified-service";
import { useThemeStore } from "../../../../store/useThemeStore";
import { useAppDragDropStore } from "../../../../store/appStore";
import { ContentType as BackendContentType } from "../../../../types/content";
import { Tooltip } from "../../../ui/Tooltip";
import { ModUpdateText } from "../../../ui/ModUpdateText";
import { ConfirmDeleteDialog } from "../../../modals/ConfirmDeleteDialog";
import { BrowseContentSideSheetV3 } from "../BrowseContentSideSheetV3";
import { preloadIcons } from "../../../../lib/icon-utils";
import { useDelayedTrue } from "../../../../hooks/useDelayedTrue";
import { EmptyStateV3 } from "../shared/EmptyStateV3";
import { FloatingActionBar, type FABActionConfig } from "../shared/FloatingActionBar";
import { SearchWithFilters } from "../../../ui/SearchWithFilters";
import { ContentActionButtons, type ContentActionButton } from "../../../ui/ContentActionButtons";
import type { DropdownOption } from "../../../ui/CustomDropdown";
import { ContentTile } from "./local-content/ContentTile";
import { NoriskPackSelector } from "./local-content/NoriskPackSelector";
import { SyncModTile } from "./local-content/SyncModTile";
import { useProfileSyncMods } from "./local-content/useProfileSyncMods";
import { ContentGroupDivider } from "./local-content/ContentGroupDivider";
import { syncModKey, syncModPlatform, type ProfileSyncPackMod } from "../../../../types/syncPacks";
import {
  filterSyncMods,
  gridEntryKey,
  groupGridEntries,
  localItemKey,
  mergeGridEntries,
  type GridEntry,
} from "./local-content/contentGrid";
import { ToggleSwitch } from "../../../ui/ToggleSwitch";
import { ModGroupDialog } from "./local-content/ModGroupDialog";
import { ModPresetsDialog } from "./local-content/ModPresetsDialog";
import { useModGroups, type ModGroup } from "../../../../hooks/useModGroups";
import { ThemedDropdown, ThemedDropdownItem, ThemedDropdownDivider, ThemedDropdownHeader } from "../shared/ThemedDropdown";

preloadIcons([
  "solar:magnifer-linear", "solar:filter-bold", "solar:sort-vertical-bold",
  "solar:alt-arrow-down-linear", "solar:refresh-bold", "solar:refresh-circle-bold",
  "solar:add-circle-bold", "solar:shield-check-bold", "solar:close-circle-linear",
  "solar:bolt-bold-duotone", "solar:menu-dots-bold", "solar:folder-linear",
  "solar:trash-bin-trash-linear", "solar:trash-bin-trash-bold", "solar:tag-linear",
  "solar:check-circle-bold", "solar:check-read-linear", "solar:arrow-up-bold",
  "solar:play-bold", "solar:pause-bold", "solar:volume-cross-bold",
  "solar:volume-cross-linear", "solar:volume-loud-linear", "solar:volume-loud-bold",
  "solar:box-bold", "solar:danger-triangle-bold", "solar:close-circle-bold",
  "solar:sort-from-top-to-bottom-bold", "solar:ruler-bold", "solar:list-bold",
  "solar:hand-stars-bold", "solar:link-round-bold",
]);

type SortKey = "name" | "size" | "type" | "updates";
type FilterKey =
  | "all" | "enabled" | "disabled"
  | "hasUpdate" | "fromModpack" | "manuallyAdded" | "fromSyncPack" | "updatesPaused" | "noriskIssues";

interface LocalContentTabV3Props<T extends LocalContentItem> {
  profile: Profile;
  contentType: LocalContentType;
  getDisplayFileName: (item: T) => string;
  itemTypeName: string;
  itemTypeNamePlural: string;
  addContentButtonText: string;
  emptyStateIconOverride?: string;
  onRefreshRequired?: () => void;
}

const SORT_OPTIONS: { value: SortKey; labelKey: string; icon: string }[] = [
  { value: "name",    labelKey: "profiles.v3.sort.name",          icon: "solar:sort-from-top-to-bottom-bold" },
  { value: "updates", labelKey: "profiles.v3.sort.updatesFirst",  icon: "solar:arrow-up-bold" },
  { value: "size",    labelKey: "profiles.v3.sort.size",          icon: "solar:ruler-bold" },
  { value: "type",    labelKey: "profiles.v3.sort.source",        icon: "solar:box-bold" },
];

interface FilterOption {
  value: FilterKey;
  labelKey: string;
  icon: string;
  separator?: boolean;
  nrcOnly?: boolean;
  syncOnly?: boolean;
}

const FILTER_OPTIONS: FilterOption[] = [
  { value: "all",           labelKey: "profiles.v3.filter.all",            icon: "solar:list-bold" },
  { value: "enabled",       labelKey: "profiles.v3.filter.enabled",        icon: "solar:check-circle-bold" },
  { value: "disabled",      labelKey: "profiles.v3.filter.disabled",       icon: "solar:close-circle-bold" },
  { value: "hasUpdate",     labelKey: "profiles.v3.filter.hasUpdate",      icon: "solar:arrow-up-bold",        separator: true },
  { value: "updatesPaused", labelKey: "profiles.v3.filter.updatesPaused",  icon: "solar:volume-cross-bold" },
  { value: "fromModpack",   labelKey: "profiles.v3.filter.fromModpack",    icon: "solar:box-bold",             separator: true },
  { value: "manuallyAdded", labelKey: "profiles.v3.filter.manuallyAdded",  icon: "solar:hand-stars-bold" },
  { value: "fromSyncPack",  labelKey: "profiles.v3.filter.fromSyncPack",   icon: "solar:link-round-bold",      syncOnly: true },
  { value: "noriskIssues",  labelKey: "profiles.v3.filter.noriskIssues",   icon: "solar:danger-triangle-bold", separator: true, nrcOnly: true },
];

export function LocalContentTabV3<T extends LocalContentItem>({
  profile,
  contentType,
  getDisplayFileName,
  itemTypeName,
  itemTypeNamePlural,
  addContentButtonText,
  emptyStateIconOverride,
  onRefreshRequired,
}: LocalContentTabV3Props<T>) {
  const { t } = useTranslation();

  const manager = useLocalContentManager<T>({
    profile,
    contentType,
    getDisplayFileName,
    onRefreshRequired,
  });

  const sync = useProfileSyncMods(profile, contentType === "Mod");

  const accentColor = useThemeStore((s) => s.accentColor);
  const navigate = useNavigate();
  const { setActiveDropContext, registerRefreshCallback, unregisterRefreshCallback } = useAppDragDropStore();

  const backendContentType = contentType as BackendContentType;

  const fetchDataRef = useRef(manager.fetchData);
  fetchDataRef.current = manager.fetchData;
  useEffect(() => {
    if (!profile?.id) return;
    setActiveDropContext(profile.id, backendContentType);
    const refresh = () => fetchDataRef.current(true);
    registerRefreshCallback(backendContentType, refresh);
    return () => {
      setActiveDropContext(null, null);
      unregisterRefreshCallback(backendContentType);
    };
  }, [profile?.id, backendContentType, setActiveDropContext, registerRefreshCallback, unregisterRefreshCallback]);

  const navigateToModDetail = useCallback((item: LocalContentItem) => {
    if (item.modrinth_info?.project_id) {
      navigate(`/mods/modrinth/${item.modrinth_info.project_id}`);
    } else if (item.curseforge_info?.project_id) {
      navigate(`/mods/curseforge/${item.curseforge_info.project_id}`);
    }
  }, [navigate]);

  const [sortBy, setSortBy] = useState<SortKey>("name");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [scrollParent, setScrollParent] = useState<HTMLElement | null>(null);
  const [hoverMenuId, setHoverMenuId] = useState<string | null>(null);

  const versionOptions = useVersionOptions();
  const tileKey = useCallback((item: LocalContentItem): string => item.path_str || item.filename, []);

  // ── Mod-Ordner (Explorer-Prinzip) — nur fuer Mods ─────────────────────
  // Ordner erscheinen inline in der normalen Liste wie Mods. Klick auf einen
  // Ordner geht hinein (nur dessen Mods sichtbar), Pfeil geht zurück.
  // Achtung: echte Unterordner in mods/ wuerden vom Loader NICHT geladen,
  // deshalb sind Ordner rein visuell (nrc-mod-groups.json in der Instanz).
  const groupsEnabled = contentType === "Mod";
  const modGroups = useModGroups(groupsEnabled ? profile?.id : undefined);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [groupDialog, setGroupDialog] = useState<{ mode: "create" | "rename"; groupId?: string } | null>(null);
  const [pendingAssignItem, setPendingAssignItem] = useState<LocalContentItem | null>(null);
  const [openManageGroupId, setOpenManageGroupId] = useState<string | null>(null);
  const [presetsOpen, setPresetsOpen] = useState(false);
  const currentFolder = groupsEnabled
    ? modGroups.groups.find((group) => group.id === currentFolderId) ?? null
    : null;
  const isBrowsing =
    groupsEnabled && !manager.searchQuery.trim() && filter === "all" && !currentFolder;

  // Profilwechsel → zurück zur Root-Ebene.
  useEffect(() => {
    setCurrentFolderId(null);
  }, [profile?.id]);

  const handleGroupDialogConfirm = useCallback((name: string) => {
    if (!groupDialog) return;
    if (groupDialog.mode === "create") {
      const created = modGroups.createGroup(name);
      if (created && pendingAssignItem) modGroups.assign(pendingAssignItem, created.id);
      toast.success(t("mod_groups.created", { name }));
    } else if (groupDialog.groupId) {
      modGroups.renameGroup(groupDialog.groupId, name);
    }
    setGroupDialog(null);
    setPendingAssignItem(null);
  }, [groupDialog, modGroups, pendingAssignItem, t]);

  const handleDeleteGroup = useCallback((groupId: string) => {
    const group = modGroups.groups.find(g => g.id === groupId);
    modGroups.deleteGroup(groupId);
    setOpenManageGroupId(null);
    if (group) toast.success(t("mod_groups.deleted", { name: group.name }));
  }, [modGroups, t]);

  // ── Direkt in einen Ordner installieren ─────────────────────────────
  // Wird das Browse-Sheet aus einem Ordner heraus geöffnet, merkt sich der
  // Tab den Vorher-Stand. Alles, was nach dem Schließen neu in der Liste
  // auftaucht, landet automatisch in diesem Ordner.
  const [addTargetGroupId, setAddTargetGroupId] = useState<string | null>(null);
  const preAddSnapshotRef = useRef<Set<string> | null>(null);
  const assignArmedRef = useRef(false);

  const handleAddToGroup = (groupId: string) => {
    preAddSnapshotRef.current = new Set(manager.items.map((i) => tileKey(i)));
    setAddTargetGroupId(groupId);
    setBrowseSheetOpen(true);
  };

  useEffect(() => {
    if (!assignArmedRef.current) return;
    assignArmedRef.current = false;
    if (!addTargetGroupId || !preAddSnapshotRef.current) return;
    const snapshot = preAddSnapshotRef.current;
    preAddSnapshotRef.current = null;
    const target = addTargetGroupId;
    setAddTargetGroupId(null);
    const fresh = manager.items.filter((i) => !snapshot.has(tileKey(i)));
    for (const item of fresh) modGroups.assign(item, target);
  }, [manager.items, addTargetGroupId, modGroups, tileKey]);

  const [switchingVersionFor, setSwitchingVersionFor] = useState<string | null>(null);
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(null);

  const getItemPlatformAndProjectId = useCallback((item: LocalContentItem): { platform: ModPlatform | null; projectId: string | null } => {
    const plat = item.platform;
    if (plat === ModPlatform.Modrinth) return { platform: plat, projectId: item.modrinth_info?.project_id ?? null };
    if (plat === ModPlatform.CurseForge) return { platform: plat, projectId: item.curseforge_info?.project_id ?? null };
    if (item.modrinth_info?.project_id)  return { platform: ModPlatform.Modrinth,   projectId: item.modrinth_info.project_id };
    if (item.curseforge_info?.project_id) return { platform: ModPlatform.CurseForge, projectId: item.curseforge_info.project_id };
    return { platform: null, projectId: null };
  }, []);

  const handleOpenVersionDropdown = useCallback(async (item: LocalContentItem) => {
    const { platform, projectId } = getItemPlatformAndProjectId(item);
    await versionOptions.toggle(
      localItemKey(item),
      platform && projectId
        ? {
            platform,
            projectId,
            loaders: contentType === "Mod" && profile?.loader ? [profile.loader] : undefined,
            gameVersions: profile?.game_version ? [profile.game_version] : undefined,
          }
        : null,
    );
  }, [contentType, getItemPlatformAndProjectId, profile, versionOptions]);

  const handleSwitchVersion = useCallback(async (item: LocalContentItem, newVersion: UnifiedVersion) => {
    versionOptions.close();
    setSwitchingVersionFor(item.filename);
    try {
      await manager.handleSwitchContentVersion(item as T, newVersion);
    } catch (err) {
      console.error("[V3] Failed to switch version:", err);
      toast.error(t("profiles.v3.versions.switchFailed"));
    } finally {
      setSwitchingVersionFor(null);
    }
  }, [manager, t, versionOptions]);

  const runBatch = useCallback(async (enabled: boolean) => {
    const syncChanged = await sync.setHere(sync.selectedMods, enabled);
    sync.clearSelection();

    const targets = manager.items.filter(
      (item) => manager.selectedItemIds.has(item.filename) && item.is_disabled === enabled,
    );
    let localChanged = 0;
    if (targets.length > 0) {
      setBatchProgress({ current: 0, total: targets.length });
      try {
        localChanged = await manager.handleBatchSetEnabled(enabled);
        setBatchProgress({ current: targets.length, total: targets.length });
      } finally {
        setBatchProgress(null);
      }
    }
    manager.handleSelectAllToggle(false);

    const changed = localChanged + syncChanged;
    if (changed > 0) {
      toast.success(t(enabled ? "profiles.v3.batch.enabled" : "profiles.v3.batch.disabled", { count: changed }));
    }
  }, [manager, sync, t]);

  const handleBatchEnable = useCallback(() => runBatch(true), [runBatch]);
  const handleBatchDisable = useCallback(() => runBatch(false), [runBatch]);

  const batchUpdateChecksConfig = useMemo(() => {
    const selectedItems = Array.from(manager.selectedItemIds)
      .map(id => manager.items.find(i => i.filename === id))
      .filter((i): i is T => !!i && !!i.id);
    if (selectedItems.length === 0) return null;
    const activeCount = selectedItems.filter(i => (i.updates_enabled ?? true)).length;
    const pausedCount = selectedItems.length - activeCount;
    const shouldEnable = pausedCount >= activeCount;
    return { shouldEnable, count: selectedItems.length };
  }, [manager.selectedItemIds, manager.items]);

  const handleBatchToggleUpdateChecks = useCallback(async () => {
    if (!batchUpdateChecksConfig) return;
    await manager.handleBatchToggleSelectedUpdatesEnabled(batchUpdateChecksConfig.shouldEnable);
    manager.handleSelectAllToggle(false);
  }, [manager, batchUpdateChecksConfig]);

  const isNrc = contentType === "NoRiskMod";
  const selectedPackId = profile?.selected_norisk_pack_id ?? null;

  const [isBlockedConfigLoaded, setIsBlockedConfigLoaded] = useState(false);
  useEffect(() => {
    if (profile?.selected_norisk_pack_id) {
      FlagsmithService.getBlockedModsConfig()
        .then(() => setIsBlockedConfigLoaded(true))
        .catch((err) => {
          console.error("[V3] Failed to load NoRisk blocked mods config:", err);
          setIsBlockedConfigLoaded(false);
        });
    } else {
      setIsBlockedConfigLoaded(false);
    }
  }, [profile?.selected_norisk_pack_id]);

  const hasUpdate = useCallback((item: LocalContentItem) => {
    const key = getUpdateIdentifier(item);
    return !!(key && manager.contentUpdates[key]);
  }, [manager.contentUpdates]);

  const visibleItems = useMemo(() => {
    let list = manager.filteredItems;

    switch (filter) {
      case "enabled":       list = list.filter(i => !i.is_disabled); break;
      case "disabled":      list = list.filter(i =>  i.is_disabled); break;
      case "hasUpdate":     list = list.filter(hasUpdate); break;
      case "fromModpack":   list = list.filter(i => !!i.modpack_origin); break;
      case "manuallyAdded": list = list.filter(i => !i.modpack_origin && !i.norisk_info); break;
      case "fromSyncPack":  list = []; break;
      case "updatesPaused": list = list.filter(i => i.updates_enabled === false); break;
      case "noriskIssues":  list = list.filter(i => {
        if (!isBlockedConfigLoaded) return false;
        const status = FlagsmithService.getModNoRiskStatus(
          i.filename,
          i.modrinth_info?.project_id || i.curseforge_info?.project_id,
          i.modrinth_info?.version_id || (i.curseforge_info as any)?.file_id,
        );
        return status === "blocked" || status === "warning";
      }); break;
    }

    const sorted = [...list];
    switch (sortBy) {
      case "name":
        sorted.sort((a, b) => getDisplayFileName(a).localeCompare(getDisplayFileName(b)));
        break;
      case "size":
        sorted.sort((a, b) => (b.file_size ?? 0) - (a.file_size ?? 0));
        break;
      case "type":
        sorted.sort((a, b) => manager.getItemPlatformDisplayName(a).localeCompare(manager.getItemPlatformDisplayName(b)));
        break;
      case "updates":
        sorted.sort((a, b) => {
          const ua = hasUpdate(a) ? 1 : 0;
          const ub = hasUpdate(b) ? 1 : 0;
          if (ua !== ub) return ub - ua;
          return getDisplayFileName(a).localeCompare(getDisplayFileName(b));
        });
        break;
    }
    return sorted;
  }, [manager.filteredItems, manager.getItemPlatformDisplayName, filter, sortBy, getDisplayFileName, hasUpdate, isBlockedConfigLoaded]);

  const canBrowse = contentType !== "NoRiskMod";
  const [isBrowseSheetOpen, setBrowseSheetOpen] = useState(false);
  const handleAddClick = useCallback(() => {
    setBrowseSheetOpen(true);
  }, []);
  const handleBrowseSheetClose = useCallback(() => {
    setBrowseSheetOpen(false);
    // Falls das Sheet aus einem Ordner geöffnet wurde: beim nächsten
    // Listen-Refresh neue Items automatisch zuordnen (siehe Effect oben).
    assignArmedRef.current = true;
    manager.fetchData(true);
  }, [manager]);

  const visibleSyncMods = useMemo(
    () => filterSyncMods(sync.mods, filter, manager.searchQuery),
    [filter, manager.searchQuery, sync.mods],
  );

  const mergedGridEntries = useMemo(
    () => mergeGridEntries(visibleItems, visibleSyncMods, sortBy === "name" ? getDisplayFileName : null),
    [visibleItems, visibleSyncMods, sortBy, getDisplayFileName],
  );

  const gridEntries = useMemo(() => {
    if (!groupsEnabled) return mergedGridEntries;
    if (currentFolder) {
      return mergedGridEntries.filter(
        (entry) => entry.kind === "local" && modGroups.groupOf(entry.item)?.id === currentFolder.id,
      );
    }
    if (isBrowsing) {
      return mergedGridEntries.filter(
        (entry) => entry.kind === "sync" || !modGroups.groupOf(entry.item),
      );
    }
    return mergedGridEntries;
  }, [groupsEnabled, mergedGridEntries, currentFolder, isBrowsing, modGroups]);

  const grouped = sync.mods.length > 0 && !currentFolder;
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const toggleGroup = useCallback((id: string) => {
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  const entryGroups = useMemo(
    () => groupGridEntries(gridEntries, t("profiles.v3.groups.profile")),
    [gridEntries, t],
  );

  const syncVersionPicker = (entry: ProfileSyncPackMod) => {
    const key = syncModKey(entry);
    const platform = syncModPlatform(entry);
    return {
      open: versionOptions.openKey === key,
      versions: versionOptions.versionsFor(key),
      loading: versionOptions.loadingFor(key),
      error: versionOptions.errorFor(key),
      onClose: versionOptions.close,
      onOpen: () => void versionOptions.toggle(
        key,
        platform && entry.project_id
          ? { platform, projectId: entry.project_id, loaders: [profile.loader], gameVersions: [profile.game_version] }
          : null,
      ),
    };
  };

  const sortDropdownOptions: DropdownOption[] = useMemo(
    () => SORT_OPTIONS.map(o => ({ value: o.value, label: t(o.labelKey), icon: o.icon })),
    [t],
  );
  const filterDropdownOptions: DropdownOption[] = useMemo(
    () => FILTER_OPTIONS
      .filter(opt => !opt.nrcOnly || isBlockedConfigLoaded)
      .filter(opt => !opt.syncOnly || sync.mods.length > 0)
      .map(o => ({ value: o.value, label: t(o.labelKey), icon: o.icon, separator: o.separator })),
    [t, isBlockedConfigLoaded, sync.mods.length],
  );

  const isWaitingForContent = !sync.ready || (manager.isLoading && gridEntries.length === 0);
  const shouldShowLoadingSpinner = useDelayedTrue(
    isWaitingForContent,
    500,
  );

  const clearSelectionRef = useRef(() => {});
  clearSelectionRef.current = () => {
    manager.handleSelectAllToggle(false);
    sync.clearSelection();
  };
  const selectionCount = manager.selectedItemIds.size + sync.selection.size;
  const hasSelection = selectionCount > 0;
  useEffect(() => {
    if (!hasSelection) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") clearSelectionRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hasSelection]);

  const batchBusy = manager.isBatchToggling || !!batchProgress;
  // Tile-Renderer (flache Grid-Ansicht + Gruppen-Ansicht teilen sich ihn).
  // Als normale Funktion (kein useCallback), damit keine stale Deps entstehen.
  const renderContentTile = (item: T) => {
    const key = tileKey(item);
    const updateKey = getUpdateIdentifier(item);
    const updateAvailable = updateKey ? manager.contentUpdates[updateKey] ?? null : null;
    const noRiskStatus = isBlockedConfigLoaded
      ? FlagsmithService.getModNoRiskStatus(
          item.filename,
          item.modrinth_info?.project_id || item.curseforge_info?.project_id,
          item.modrinth_info?.version_id || (item.curseforge_info as any)?.file_id,
        )
      : null;

    const tileGroup = groupsEnabled ? modGroups.groupOf(item) : null;
    const groupMenu = groupsEnabled ? (
      <>
        <ThemedDropdownDivider />
        <ThemedDropdownHeader>{t("mod_groups.move_to")}</ThemedDropdownHeader>
        {modGroups.groups
          .filter(g => g.id !== tileGroup?.id)
          .map(g => (
            <ThemedDropdownItem
              key={g.id}
              icon="solar:folder-linear"
              onClick={() => { modGroups.assign(item, g.id); setHoverMenuId(null); }}
            >
              {g.name}
            </ThemedDropdownItem>
          ))}
        <ThemedDropdownItem
          icon="solar:add-folder-bold"
          onClick={() => { setPendingAssignItem(item); setGroupDialog({ mode: "create" }); setHoverMenuId(null); }}
        >
          {t("mod_groups.new_group")}
        </ThemedDropdownItem>
        {tileGroup && (
          <ThemedDropdownItem
            icon="solar:close-circle-linear"
            onClick={() => { modGroups.assign(item, null); setHoverMenuId(null); }}
          >
            {t("mod_groups.remove_from_group")}
          </ThemedDropdownItem>
        )}
      </>
    ) : undefined;

    return (
      <ContentTile
        key={key}
        item={item}
        displayName={getDisplayFileName(item)}
        iconUrl={manager.getItemIcon(item)}
        platformLabel={manager.getItemPlatformDisplayName(item)}
        busy={manager.itemBeingToggled === item.filename || manager.itemBeingDeleted === item.filename}
        onToggle={() => manager.handleToggleItemEnabled(item)}
        onDelete={() => manager.handleDeleteItem(item)}
        onOpenFolder={() => manager.handleOpenItemFolder(item)}
        onNameClick={(item.modrinth_info?.project_id || item.curseforge_info?.project_id) ? () => navigateToModDetail(item) : undefined}
        menuOpen={hoverMenuId === item.filename}
        onMenuToggle={(open) => setHoverMenuId(open ? item.filename : null)}
        selectMode={hasSelection}
        isSelected={manager.selectedItemIds.has(item.filename)}
        onToggleSelection={() => manager.handleItemSelectionChange(item.filename, !manager.selectedItemIds.has(item.filename))}
        onToggleUpdateChecks={item.id ? () => manager.handleToggleItemUpdatesEnabled(item) : undefined}
        onQuickUpdate={updateAvailable
          ? () => manager.handleUpdateContentItem(item, updateAvailable)
          : undefined}
        quickUpdateDisabled={!!updateAvailable && (() => {
          const isFromModPack = !!item.modpack_origin;
          return isFromModPack
            ? item.updates_enabled !== true
            : item.updates_enabled === false;
        })()}
        quickUpdateTooltip={updateAvailable
          ? (
            <div className="max-w-xs text-left">
              <ModUpdateText
                isFromModPack={!!item.modpack_origin}
                updateVersion={updateAvailable}
                currentVersion={(item.modrinth_info as any)?.version_number || (item.curseforge_info as any)?.version_number}
                modpackOrigin={item.modpack_origin}
                updatesEnabled={item.updates_enabled}
              />
            </div>
          )
          : undefined}
        isQuickUpdating={manager.itemsBeingUpdated.has(item.filename)}
        noRiskStatus={noRiskStatus}
        overridesPack={(() => {
          const projectId = item.modrinth_info?.project_id || item.curseforge_info?.project_id;
          return projectId && !item.is_disabled ? sync.overriddenPackByProject.get(projectId) : undefined;
        })()}
        versionDropdownOpen={versionOptions.openKey === key}
        availableVersions={versionOptions.versionsFor(key)}
        isLoadingVersions={versionOptions.loadingFor(key)}
        versionError={versionOptions.errorFor(key)}
        onVersionClick={() => handleOpenVersionDropdown(item)}
        onSwitchVersion={(v) => handleSwitchVersion(item, v)}
        updateAvailable={updateAvailable}
        isSwitchingVersion={switchingVersionFor === item.filename}
        groupBadge={tileGroup?.name ?? null}
        groupMenu={groupMenu}
      />
    );
  };

  const fabActions: FABActionConfig[] = [
    { icon: "solar:play-bold",  label: t("profiles.v3.fab.enable"),  onClick: handleBatchEnable,  disabled: batchBusy },
    { icon: "solar:pause-bold", label: t("profiles.v3.fab.disable"), onClick: handleBatchDisable, disabled: batchBusy },
    ...(batchUpdateChecksConfig ? [{
      icon: batchUpdateChecksConfig.shouldEnable ? "solar:volume-loud-bold" : "solar:volume-cross-bold",
      label: t(batchUpdateChecksConfig.shouldEnable ? "profiles.v3.fab.resumeChecks" : "profiles.v3.fab.muteChecks"),
      onClick: handleBatchToggleUpdateChecks,
    } as FABActionConfig] : []),
    {
      icon: "solar:trash-bin-trash-bold",
      label: manager.isBatchDeleting ? "…" : t("profiles.v3.fab.delete"),
      tone: "danger",
      onClick: manager.handleBatchDeleteSelected,
      disabled: manager.isBatchDeleting || sync.selection.size > 0,
    },
  ];

  const toolbarActions: ContentActionButton[] = [
    ...(manager.updatableContentCount > 0 ? [{
      id: "update-all",
      label: manager.isUpdatingAll
        ? t("profiles.v3.toolbar.updateAll")
        : `${t("profiles.v3.toolbar.updateAll")} (${manager.updatableContentCount})`,
      icon: manager.isUpdatingAll || manager.isCheckingUpdates ? "solar:refresh-bold" : "solar:refresh-circle-bold",
      variant: "highlight" as const,
      disabled: manager.isUpdatingAll,
      loading: manager.isUpdatingAll || manager.isCheckingUpdates,
      tooltip: t("profiles.v3.toolbar.updateAllTitle", { count: manager.updatableContentCount }),
      onClick: manager.handleUpdateAllAvailableContent,
    }] : []),
    {
      id: "refresh",
      icon: "solar:refresh-bold",
      variant: "text" as const,
      disabled: manager.isAnyTaskRunning,
      loading: manager.isAnyTaskRunning,
      tooltip: t("profiles.v3.toolbar.refresh"),
      onClick: () => {
        manager.fetchData(false);
        void sync.reload();
      },
    },
    ...(canBrowse ? [{
      id: "add",
      label: addContentButtonText,
      icon: "solar:add-circle-bold",
      variant: "highlight" as const,
      tooltip: addContentButtonText,
      onClick: handleAddClick,
    }] : []),
    ...(groupsEnabled ? [{
      id: "new-group",
      icon: "solar:add-folder-bold",
      variant: "text" as const,
      tooltip: t("mod_groups.new_group"),
      onClick: () => setGroupDialog({ mode: "create" }),
    },
    {
      id: "presets",
      icon: "solar:share-bold",
      variant: "text" as const,
      tooltip: t("mod_presets.title"),
      onClick: () => setPresetsOpen(true),
    }] : []),
  ];

  const renderGridEntry = (gridEntry: GridEntry<T>) => {
    if (gridEntry.kind === "sync") {
      const entry = gridEntry.entry;
      const { platform, project_id: projectId } = entry;
      return (
        <SyncModTile
          entry={entry}
          sync={sync}
          mcVersion={profile.game_version}
          selectMode={hasSelection}
          versionPicker={syncVersionPicker(entry)}
          menuOpen={hoverMenuId === syncModKey(entry)}
          onMenuToggle={(open) => setHoverMenuId(open ? syncModKey(entry) : null)}
          onNameClick={platform && projectId ? () => navigate(`/mods/${platform}/${projectId}`) : undefined}
        />
      );
    }
    return renderContentTile(gridEntry.item);
  };
  const insideItems = useMemo(
    () => {
      if (!currentFolder) return [] as T[];
      return (visibleItems as T[]).filter((item) => modGroups.groupOf(item)?.id === currentFolder.id);
    },
    [currentFolder, visibleItems, modGroups],
  );

  return (
    <div className="flex flex-col min-h-0 flex-1 relative">
      <div className="flex items-center gap-3 px-5 py-2.5 border-b border-white/10 flex-shrink-0 bg-black/20 sticky top-0 z-10">
        <SearchWithFilters
          searchValue={manager.searchQuery}
          onSearchChange={manager.setSearchQuery}
          placeholder={t("profiles.v3.toolbar.searchPlaceholder", { type: itemTypeNamePlural.toLowerCase() })}
          sortOptions={sortDropdownOptions}
          sortValue={sortBy}
          onSortChange={(v) => setSortBy(v as SortKey)}
          filterOptions={filterDropdownOptions}
          filterValue={filter}
          onFilterChange={(v) => setFilter(v as FilterKey)}
          dropdownSize="sm"
          className="flex-1"
        />

        {isNrc && (
          <NoriskPackSelector profile={profile} onChanged={onRefreshRequired} />
        )}

        {manager.contentUpdateError && (
          <Tooltip content={manager.contentUpdateError}>
            <div className="h-9 px-3 rounded-lg bg-red-600/20 border border-red-500/30 text-white flex items-center gap-2 font-smallcaps text-base">
              <Icon icon="solar:danger-triangle-bold" className="w-4 h-4" />
              <span style={{ transform: 'translateY(-0.075em)' }}>{t("profiles.v3.toolbar.checkFailed")}</span>
            </div>
          </Tooltip>
        )}

        <ContentActionButtons actions={toolbarActions} size="sm" />
      </div>

      <div
        ref={setScrollParent}
        className={`flex-1 min-h-0 overflow-y-auto p-5 ${hasSelection ? "pb-24" : ""}`}
      >
        {manager.error && (
          <div className="mb-4 flex items-start gap-3 p-3 rounded-lg border border-rose-400/30 bg-rose-500/10">
            <Icon icon="solar:danger-triangle-bold" className="w-5 h-5 text-rose-300 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0 text-xs font-minecraft text-rose-100 break-words">
              {manager.error}
            </div>
            <button
              onClick={() => manager.fetchData(true)}
              className="flex-shrink-0 h-7 px-2 rounded-md text-[10px] font-minecraft uppercase tracking-wider text-rose-100 hover:bg-rose-500/20 transition-colors"
              title={t("profiles.v3.content.retry")}
            >
              {t("profiles.v3.content.retry")}
            </button>
          </div>
        )}
        {isNrc && !selectedPackId ? (
          <EmptyStateV3
            icon="solar:shield-check-bold-duotone"
            title={t("profiles.v3.content.noPackTitle")}
            hint={t("profiles.v3.content.noPackHint")}
          />
        ) : isWaitingForContent ? (
          shouldShowLoadingSpinner ? (
            <div className="flex items-center justify-center h-40 text-white/40 font-minecraft text-sm animate-in fade-in duration-300">
              <Icon icon="svg-spinners:ring-resize" className="w-4 h-4 mr-2" />
              {t("profiles.v3.content.loading")}
            </div>
          ) : (
            <div className="h-40" />
          )
        ) : currentFolder ? (
          <div className="flex flex-col gap-3">
            {/* Zurück-Pfeil + Pfad */}
            <button
              onClick={() => setCurrentFolderId(null)}
              className="flex items-center gap-2 self-start rounded-md px-2 py-1.5 text-white/60 hover:text-white hover:bg-white/5 transition-colors"
              title={t("mod_groups.back")}
            >
              <Icon icon="solar:alt-arrow-left-bold" className="w-4 h-4" />
              <span className="font-minecraft text-sm">
                {itemTypeNamePlural} <span className="text-white/30">/</span> {currentFolder.name}
              </span>
              <span className="font-minecraft text-xs text-white/35 tabular-nums">
                ({insideItems.length})
              </span>
            </button>
            {insideItems.length > 0 ? (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {insideItems.map((item) => renderContentTile(item))}
              </div>
            ) : (
              <div className="px-2 py-3 rounded-lg border border-dashed border-white/10 text-xs font-minecraft text-white/30">
                {t("mod_groups.empty_group")}
              </div>
            )}
            <button
              onClick={() => handleAddToGroup(currentFolder.id)}
              className="flex items-center justify-center gap-2 h-10 rounded-lg border border-dashed border-white/15 text-white/50 hover:text-white hover:border-white/30 hover:bg-white/5 transition-colors text-xs font-minecraft uppercase tracking-wider"
            >
              <Icon icon="solar:add-circle-bold" className="w-4 h-4" />
              {t("mod_groups.add_mods")}
            </button>
          </div>
        ) : gridEntries.length === 0 && !(isBrowsing && modGroups.groups.length > 0) ? (
          <EmptyStateV3
            icon={emptyStateIconOverride ?? "solar:widget-bold-duotone"}
            title={manager.searchQuery
              ? t("profiles.v3.content.noMatch", { type: itemTypeNamePlural.toLowerCase(), query: manager.searchQuery })
              : t("profiles.v3.content.noItems", { type: itemTypeNamePlural.toLowerCase() })}
            hint={canBrowse
              ? t("profiles.v3.content.emptyHint", { cta: addContentButtonText, type: itemTypeNamePlural.toLowerCase() })
              : undefined}
          />
        ) : (
          <div className="space-y-4">
            {isBrowsing && modGroups.groups.length > 0 && (
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                {[...modGroups.groups]
                  .sort((left, right) => left.name.localeCompare(right.name))
                  .map((group) => (
                    <FolderTile
                      key={group.id}
                      group={group}
                      members={(visibleItems as T[]).filter(
                        (item) => modGroups.groupOf(item)?.id === group.id,
                      )}
                      onOpen={() => setCurrentFolderId(group.id)}
                      onToggleItem={(item) => manager.handleToggleItemEnabled(item)}
                      manageOpen={openManageGroupId === group.id}
                      onManageToggle={() =>
                        setOpenManageGroupId((current) => (current === group.id ? null : group.id))
                      }
                      onRename={() => {
                        setOpenManageGroupId(null);
                        setGroupDialog({ mode: "rename", groupId: group.id });
                      }}
                      onDelete={() => handleDeleteGroup(group.id)}
                    />
                  ))}
              </div>
            )}
            {gridEntries.length > 0 && (
              grouped ? (
                <div className="space-y-4">
                  {entryGroups.map((group) => {
                    const isCollapsed = collapsedGroups.has(group.id);
                    return (
                      <div key={group.id}>
                        <ContentGroupDivider
                          label={group.label}
                          count={group.entries.length}
                          packId={group.packId}
                          packIcon={group.packIcon}
                          collapsed={isCollapsed}
                          onToggle={() => toggleGroup(group.id)}
                          onOpen={group.packId ? () => sync.openPack(group.packId!) : undefined}
                          openLabel={t("profiles.v3.groups.openPack")}
                          tag={group.packId ? t("profiles.v3.groups.syncPackTag") : undefined}
                        />
                        {!isCollapsed && (
                          <div className="mt-2 grid grid-cols-1 gap-3 lg:grid-cols-2">
                            {group.entries.map((gridEntry) => (
                              <div key={gridEntryKey(gridEntry)}>{renderGridEntry(gridEntry)}</div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <VirtuosoGrid
                  data={gridEntries}
                  customScrollParent={scrollParent ?? undefined}
                  listClassName="grid grid-cols-1 gap-3 lg:grid-cols-2"
                  computeItemKey={(index, gridEntry) => `${index}:${gridEntryKey(gridEntry)}`}
                  itemContent={(_, gridEntry) => renderGridEntry(gridEntry)}
                />
              )
            )}
          </div>
        )}
      </div>

      <FloatingActionBar
        visible={hasSelection || !!batchProgress}
        count={selectionCount}
        totalCount={visibleItems.length + visibleSyncMods.length}
        accent={accentColor.value}
        allSelected={manager.areAllFilteredSelected && visibleSyncMods.every((entry) => sync.selection.has(syncModKey(entry)))}
        onSelectAll={() => {
          manager.handleSelectAllToggle(true);
          sync.selectAll(visibleSyncMods);
        }}
        onClear={() => clearSelectionRef.current()}
        batchProgress={batchProgress}
        actions={fabActions}
      />

      <BrowseContentSideSheetV3
        open={isBrowseSheetOpen}
        profile={profile}
        contentType={contentType}
        onClose={handleBrowseSheetClose}
        onInstallSuccess={() => manager.fetchData(true)}
      />

      {sync.confirmDialog}

      <ConfirmDeleteDialog
        isOpen={manager.isConfirmDeleteDialogOpen}
        itemName={
          manager.itemToDeleteForDialog
            ? getDisplayFileName(manager.itemToDeleteForDialog as T)
            : `${manager.selectedItemIds.size} ${manager.selectedItemIds.size === 1 ? itemTypeName : itemTypeNamePlural}`
        }
        onClose={manager.handleCloseDeleteDialog}
        onConfirm={manager.handleConfirmDeletion}
        isDeleting={manager.isDialogActionLoading}
        title={
          manager.itemToDeleteForDialog
            ? t("content.delete_item_title", { name: getDisplayFileName(manager.itemToDeleteForDialog as T) })
            : t("content.delete_selected_title", { itemType: itemTypeNamePlural })
        }
      />
      <ModGroupDialog
        open={!!groupDialog}
        title={t(groupDialog?.mode === "rename" ? "mod_groups.rename_title" : "mod_groups.create_title")}
        confirmLabel={t(groupDialog?.mode === "rename" ? "profiles.v3.chips.save" : "mod_groups.create")}
        initialName={
          groupDialog?.mode === "rename"
            ? modGroups.groups.find(g => g.id === groupDialog.groupId)?.name ?? ""
            : ""
        }
        onClose={() => { setGroupDialog(null); setPendingAssignItem(null); }}
        onConfirm={handleGroupDialogConfirm}
      />
      {groupsEnabled && (
        <ModPresetsDialog
          open={presetsOpen}
          profile={profile}
          items={manager.items}
          onClose={() => setPresetsOpen(false)}
          onImported={() => manager.fetchData(true)}
        />
      )}
    </div>
  );
}

// ─── Folder tile (looks like a mod, opens like the Explorer) ───────────
// Ordner-Kachel in Mod-Größe: Klick geht hinein (Parent blendet dann nur
// dessen Mods ein), Schalter (de)aktiviert alle Mods im Ordner auf einmal.
function FolderTile<T extends LocalContentItem>({
  group,
  members,
  onOpen,
  onToggleItem,
  manageOpen,
  onManageToggle,
  onRename,
  onDelete,
}: {
  group: ModGroup;
  members: T[];
  onOpen: () => void;
  onToggleItem: (item: T) => Promise<void> | void;
  manageOpen: boolean;
  onManageToggle: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);

  const toggleGroup = async () => {
    if (busy || members.length === 0) return;
    setBusy(true);
    try {
      const anyDisabled = members.some(m => m.is_disabled);
      for (const m of members) {
        if (anyDisabled && m.is_disabled) await onToggleItem(m);
        else if (!anyDisabled && !m.is_disabled) await onToggleItem(m);
      }
    } finally {
      setBusy(false);
    }
  };

  const enabledCount = members.filter(m => !m.is_disabled).length;
  const allEnabled = members.length > 0 && enabledCount === members.length;

  return (
    <div className="rounded-lg border border-white/10 bg-black/20 overflow-hidden">
      <div className="flex items-center gap-4 p-3">
        <button
          onClick={onOpen}
          className="relative w-14 h-14 flex-shrink-0 rounded-lg bg-white/5 ring-1 ring-white/10 flex items-center justify-center overflow-hidden hover:bg-white/10 transition-colors"
          title={t("mod_groups.open")}
        >
          {busy ? (
            <Icon icon="svg-spinners:ring-resize" className="w-6 h-6 text-white/50" />
          ) : (
            <Icon icon="solar:folder-bold" className="w-7 h-7 text-white/60" />
          )}
          {members.length > 0 && (
            <span className="absolute bottom-0.5 right-0.5 px-1 rounded bg-black/70 text-[10px] font-minecraft text-white/80 tabular-nums">
              {members.length}
            </span>
          )}
        </button>

        <button
          onClick={onOpen}
          className="flex-1 min-w-0 text-left"
          title={t("mod_groups.open")}
        >
          <div className="text-sm text-white font-minecraft truncate normal-case" title={group.name}>
            {group.name}
          </div>
          <div className="text-xs font-minecraft text-white/40 mt-0.5">
            {t("mod_groups.mods_count", { count: members.length })}
            {members.length > 0 && ` · ${enabledCount}/${members.length} ${t("mod_groups.active")}`}
          </div>
        </button>

        {/* An/Aus: schaltet alle Mods im Ordner */}
        <div
          className="flex-shrink-0"
          title={t(allEnabled ? "mod_groups.disable_all" : "mod_groups.enable_all")}
        >
          <ToggleSwitch
            checked={allEnabled}
            onChange={() => void toggleGroup()}
            disabled={busy || members.length === 0}
            size="sm"
          />
        </div>

        {/* Hinein-Pfeil */}
        <button
          onClick={onOpen}
          className="flex-shrink-0 p-1.5 rounded text-white/40 hover:text-white hover:bg-white/10 transition-colors"
          title={t("mod_groups.open")}
        >
          <Icon icon="solar:alt-arrow-right-bold" className="w-4 h-4" />
        </button>

        {/* Verwalten */}
        <div className="relative flex-shrink-0">
          <button
            onClick={(e) => { e.stopPropagation(); onManageToggle(); }}
            className="p-1.5 rounded text-white/40 hover:text-white hover:bg-white/10 transition-colors"
            title={t("mod_groups.manage")}
          >
            <Icon icon="solar:menu-dots-bold" className="w-4 h-4" />
          </button>
          <ThemedDropdown
            open={manageOpen}
            onClose={onManageToggle}
            width="w-48"
          >
            <ThemedDropdownItem
              icon="solar:pen-bold"
              onClick={onRename}
            >
              {t("mod_groups.rename")}
            </ThemedDropdownItem>
            <ThemedDropdownDivider />
            <ThemedDropdownItem
              icon="solar:trash-bin-trash-linear"
              tone="danger"
              onClick={onDelete}
            >
              {t("mod_groups.delete")}
            </ThemedDropdownItem>
          </ThemedDropdown>
        </div>
      </div>
    </div>
  );
}
