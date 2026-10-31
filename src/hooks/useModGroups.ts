"use client";

import { useCallback, useEffect, useState } from "react";
import { exists, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import type { LocalContentItem } from "./useLocalContentManager";
import { getProfileInstancePath } from "../services/profile-service";

export interface ModGroup {
  id: string;
  name: string;
}

interface ModGroupsFile {
  version: 1;
  groups: ModGroup[];
  /** Stable item key -> group id */
  assignment: Record<string, string>;
}

const GROUPS_FILENAME = "nrc-mod-groups.json";
const EMPTY: ModGroupsFile = { version: 1, groups: [], assignment: {} };

/**
 * Stable key for assigning a mod to a group. Project IDs survive mod
 * updates (filenames don't), custom mods fall back to their filename.
 */
export function modGroupKey(item: LocalContentItem): string {
  if (item.modrinth_info?.project_id) return `modrinth:${item.modrinth_info.project_id}`;
  if (item.curseforge_info?.project_id) return `curseforge:${item.curseforge_info.project_id}`;
  return `file:${item.filename}`;
}

async function groupsFilePath(profileId: string): Promise<string> {
  const instancePath = await getProfileInstancePath(profileId);
  return `${instancePath}/${GROUPS_FILENAME}`;
}

export function useModGroups(profileId: string | undefined) {
  const [data, setData] = useState<ModGroupsFile>(EMPTY);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!profileId) {
      setData(EMPTY);
      setLoaded(false);
      return;
    }
    let cancelled = false;
    setLoaded(false);
    (async () => {
      try {
        const path = await groupsFilePath(profileId);
        if (!(await exists(path))) {
          if (!cancelled) {
            setData(EMPTY);
            setLoaded(true);
          }
          return;
        }
        const parsed = JSON.parse(await readTextFile(path)) as Partial<ModGroupsFile>;
        if (!cancelled) {
          setData({
            version: 1,
            groups: Array.isArray(parsed.groups)
              ? parsed.groups.filter((g) => g && typeof g.id === "string" && typeof g.name === "string")
              : [],
            assignment:
              parsed.assignment && typeof parsed.assignment === "object" ? parsed.assignment : {},
          });
          setLoaded(true);
        }
      } catch (err) {
        console.error("[ModGroups] Failed to load groups:", err);
        if (!cancelled) {
          setData(EMPTY);
          setLoaded(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profileId]);

  const persist = useCallback(
    async (next: ModGroupsFile) => {
      setData(next);
      if (!profileId) return;
      try {
        await writeTextFile(await groupsFilePath(profileId), JSON.stringify(next, null, 2));
      } catch (err) {
        console.error("[ModGroups] Failed to save groups:", err);
      }
    },
    [profileId]
  );

  const createGroup = useCallback(
    (name: string): ModGroup | null => {
      const trimmed = name.trim();
      if (!trimmed) return null;
      const group: ModGroup = {
        id: `g-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        name: trimmed,
      };
      void persist({ ...data, groups: [...data.groups, group] });
      return group;
    },
    [data, persist]
  );

  const renameGroup = useCallback(
    (id: string, name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      void persist({
        ...data,
        groups: data.groups.map((g) => (g.id === id ? { ...g, name: trimmed } : g)),
      });
    },
    [data, persist]
  );

  const deleteGroup = useCallback(
    (id: string) => {
      const assignment = { ...data.assignment };
      for (const key of Object.keys(assignment)) {
        if (assignment[key] === id) delete assignment[key];
      }
      void persist({
        ...data,
        groups: data.groups.filter((g) => g.id !== id),
        assignment,
      });
    },
    [data, persist]
  );

  const assign = useCallback(
    (item: LocalContentItem, groupId: string | null) => {
      const key = modGroupKey(item);
      const assignment = { ...data.assignment };
      if (groupId) {
        assignment[key] = groupId;
      } else {
        delete assignment[key];
      }
      void persist({ ...data, assignment });
    },
    [data, persist]
  );

  const groupOf = useCallback(
    (item: LocalContentItem): ModGroup | null => {
      const id = data.assignment[modGroupKey(item)];
      if (!id) return null;
      return data.groups.find((g) => g.id === id) ?? null;
    },
    [data]
  );

  return {
    groups: data.groups,
    assignment: data.assignment,
    loaded,
    createGroup,
    renameGroup,
    deleteGroup,
    assign,
    groupOf,
  };
}

export type UseModGroups = ReturnType<typeof useModGroups>;
