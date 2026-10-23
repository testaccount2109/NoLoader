import type {
  LauncherPerformanceSnapshot,
  ModFeatureId,
  ModPage,
  NoLoaderActivation,
  NoLoaderApi,
} from "../../types/no-loader";

const PAGE_ID = "performance-controls";
const FEATURES: Array<{ id: ModFeatureId; label: string }> = [
  { id: "curseforge.integration", label: "CurseForge-Integration" },
  { id: "launcher.news", label: "News-Seitenleiste" },
  { id: "launcher.effects", label: "Hintergrund- und Skin-Effekte" },
  { id: "launcher.ads", label: "Werbeelemente" },
];

export function activate(api: NoLoaderApi): NoLoaderActivation {
  let enabled: Record<ModFeatureId, boolean> = {
    "curseforge.integration": true,
    "launcher.news": true,
    "launcher.effects": true,
    "launcher.ads": true,
  };
  let metrics: LauncherPerformanceSnapshot | undefined;
  let status = "Lade Feature-Status …";
  let active = true;

  const page = (): ModPage => ({
    id: PAGE_ID,
    title: "Launcher-Performance",
    content: [
      { type: "text", text: "Schalte optionale Launcher-Funktionen ab. Deine Auswahl gilt, solange diese Mod aktiv ist." },
      ...FEATURES.map(({ id, label }) => ({
        type: "toggle" as const,
        id: id.replaceAll(".", "-"),
        label,
        checked: enabled[id],
        action: `feature-${id.replaceAll(".", "-")}`,
      })),
      {
        type: "button",
        id: "refresh-metrics",
        label: "Leistungsdaten aktualisieren",
        action: "refresh-metrics",
      },
      ...(metrics
        ? [
            {
              type: "card" as const,
              title: "NoLoader-Erweiterungen",
              children: [
                { type: "text" as const, text: `Aktive Mods: ${metrics.activeMods}` },
                { type: "text" as const, text: `API-Aufrufe letzte Minute: ${metrics.apiCallsLastMinute}` },
                { type: "text" as const, text: `Mittlere API-Latenz: ${metrics.averageApiLatencyMs} ms` },
                { type: "text" as const, text: `Maximale API-Latenz: ${metrics.maxApiLatencyMs} ms` },
              ],
            },
          ]
        : []),
      ...(status ? [{ type: "text" as const, text: status }] : []),
    ],
  });

  const update = () => api.updatePage(PAGE_ID, page());
  const removePage = api.registerPage(page());
  const removeNavigation = api.registerNavigationItem({
    id: "performance-controls",
    label: "Performance",
    pageId: PAGE_ID,
    icon: "sparkles",
  });

  const refreshMetrics = async () => {
    try {
      metrics = await api.performance.getSnapshot();
      status = "";
    } catch (error) {
      status = error instanceof Error ? error.message : String(error);
    }
  };

  const removeAction = api.onAction(async (action, value) => {
    const feature = FEATURES.find(({ id }) => `feature-${id.replaceAll(".", "-")}` === action);
    if (feature && typeof value === "boolean") {
      api.features.setEnabled(feature.id, value);
      enabled = await api.features.getSnapshot();
      status = "Feature-Einstellung angewendet.";
      update();
      return;
    }
    if (action === "refresh-metrics") {
      status = "Leistungsdaten werden geladen …";
      update();
      await refreshMetrics();
      if (active) update();
    }
  });

  void Promise.all([api.features.getSnapshot(), refreshMetrics()]).then(([snapshot]) => {
    if (!active) return;
    enabled = snapshot;
    update();
  }).catch((error: unknown) => {
    if (!active) return;
    status = error instanceof Error ? error.message : String(error);
    update();
  });

  return () => {
    active = false;
    removeAction();
    removeNavigation();
    removePage();
  };
}
