import type {
  LastPlayedServer,
  ModHomeWidget,
  NoLoaderActivation,
  NoLoaderApi,
} from "../../types/no-loader";

const WIDGET_ID = "quick-join";

export function activate(api: NoLoaderApi): NoLoaderActivation {
  let lastServer: LastPlayedServer | null = null;
  let loadingServer = true;
  let joining = false;
  let serverError: string | undefined;
  let joinError: string | undefined;
  let active = true;

  const homeWidget = (): ModHomeWidget => ({
    id: WIDGET_ID,
    title: "Zuletzt mit NoRisk gestarteter Server",
    position: "after-play",
    content: loadingServer
      ? [{ type: "text", text: "Letzten Quick-Play-Server wird geladen …" }]
      : lastServer
        ? [
            { type: "text", text: lastServer.address },
            {
              type: "button",
              id: "join-last-server",
              label: joining ? "Minecraft startet …" : "Server beitreten",
              action: "join-last-server",
            },
            ...(joinError ? [{ type: "text" as const, text: joinError }] : []),
          ]
        : [
            {
              type: "text",
              text: serverError ?? "Noch kein Mehrspieler-Server über NoRisk Quick Play gestartet.",
            },
          ],
  });

  const updateWidget = () => api.updateHomeWidget(WIDGET_ID, homeWidget());
  const removeHomeWidget = api.registerHomeWidget(homeWidget());
  const removeAction = api.onAction(async (action) => {
    if (action !== "join-last-server" || !lastServer || joining) return;
    joining = true;
    joinError = undefined;
    updateWidget();
    try {
      await api.launcher.launchProfile({
        profileId: lastServer.profileId,
        serverAddress: lastServer.address,
      });
    } catch (error) {
      joinError = error instanceof Error ? error.message : String(error);
    } finally {
      joining = false;
      if (active) updateWidget();
    }
  });

  void api.servers
    .getLastPlayed()
    .then((server) => {
      if (active) lastServer = server;
    })
    .catch((error: unknown) => {
      if (active) serverError = error instanceof Error ? error.message : String(error);
    })
    .finally(() => {
      if (!active) return;
      loadingServer = false;
      updateWidget();
    });

  return () => {
    active = false;
    removeAction();
    removeHomeWidget();
  };
}
