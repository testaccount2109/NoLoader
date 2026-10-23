import type {
  LauncherProfile,
  ModNavigationItem,
  ModPage,
  NoLoaderActivation,
  NoLoaderApi,
} from "../../types/no-loader";

const PAGE_ID = "import-game-mods";

export function activate(api: NoLoaderApi): NoLoaderActivation {
  let profiles: LauncherProfile[] = [];
  let status = "Profile werden geladen …";
  let active = true;

  const renderPage = (): ModPage => {
    const eligible = profiles.filter((profile) =>
      ["fabric", "forge", "quilt", "neoforge"].includes(profile.loader.toLowerCase()),
    );
    return {
      id: PAGE_ID,
      title: "Game-Mods importieren",
      content: [
        { type: "text", text: "Wähle ein Loader-Profil. Der native Dateidialog importiert ausgewählte JAR-Dateien in dessen Mods-Ordner." },
        ...(eligible.length === 0
          ? [{ type: "text" as const, text: status || "Kein kompatibles Loader-Profil gefunden." }]
          : eligible.map((profile) => ({
              type: "card" as const,
              title: `${profile.name} · ${profile.gameVersion} · ${profile.loader}`,
              children: [{
                type: "button" as const,
                id: `choose-${profile.id.replaceAll("-", "")}`,
                label: `JAR-Dateien für ${profile.name} auswählen`,
                action: `choose-${profile.id.replaceAll("-", "")}`,
              }],
            }))),
        ...(status && eligible.length > 0 ? [{ type: "text" as const, text: status }] : []),
      ],
    };
  };

  const removePage = api.registerPage(renderPage());
  const navigation: ModNavigationItem = {
    id: "game-mod-import",
    label: "Game-Mods importieren",
    pageId: PAGE_ID,
    icon: "puzzle",
  };
  const removeNavigation = api.registerNavigationItem(navigation);
  const removeAction = api.onAction(async (action) => {
    const profile = profiles.find((entry) => `choose-${entry.id.replaceAll("-", "")}` === action);
    if (!profile) return;
    status = `Dateiauswahl für ${profile.name} geöffnet.`;
    api.updatePage(PAGE_ID, renderPage());
    try {
      await api.gameMods.importFromPicker(profile.id);
      status = `Import abgeschlossen. Starte ${profile.name} neu, damit der Loader die JAR-Mods lädt.`;
    } catch (error) {
      status = error instanceof Error ? error.message : String(error);
    }
    if (active) api.updatePage(PAGE_ID, renderPage());
  });

  void api.profiles.list().then((result) => {
    if (!active) return;
    profiles = result;
    status = "";
    api.updatePage(PAGE_ID, renderPage());
  }).catch((error: unknown) => {
    if (!active) return;
    status = error instanceof Error ? error.message : String(error);
    api.updatePage(PAGE_ID, renderPage());
  });

  return () => {
    active = false;
    removeAction();
    removeNavigation();
    removePage();
  };
}
