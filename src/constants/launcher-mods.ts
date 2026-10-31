export const LAUNCHER_MODS = [
  {
    id: "quick-server-join",
    nameKey: "launcher_mods.quick_server_join.name",
    descriptionKey: "launcher_mods.quick_server_join.description",
    icon: "solar:server-square-bold",
  },
  {
    id: "skin-api",
    nameKey: "launcher_mods.skin_api.name",
    descriptionKey: "launcher_mods.skin_api.description",
    icon: "solar:emoji-funny-circle-bold",
  },
] as const;

export type LauncherModId = (typeof LAUNCHER_MODS)[number]["id"];
