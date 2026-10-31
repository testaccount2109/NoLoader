import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { LauncherModId } from "../constants/launcher-mods";

type LauncherModState = {
  enabled: Record<LauncherModId, boolean>;
  setEnabled: (id: LauncherModId, enabled: boolean) => void;
};

export const useLauncherModStore = create<LauncherModState>()(
  persist(
    (set) => ({
      enabled: {
        "quick-server-join": true,
        "skin-api": true,
      },
      setEnabled: (id, enabled) =>
        set((state) => ({
          enabled: { ...state.enabled, [id]: enabled },
        })),
    }),
    {
      name: "norisk-launcher-mods",
      partialize: (state) => ({ enabled: state.enabled }),
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<LauncherModState> | undefined;
        return {
          ...currentState,
          ...persisted,
          enabled: {
            ...currentState.enabled,
            ...persisted?.enabled,
          },
        };
      },
    },
  ),
);
