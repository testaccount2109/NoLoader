import type {
  LastPlayedServer,
  LauncherProfile,
  ModHomeWidget,
  NoLoaderActivation,
  NoLoaderApi,
  ModPage,
} from "../../types/no-loader";

export function activate(api: NoLoaderApi): NoLoaderActivation {
  let clicks = 0;
  let profiles: LauncherProfile[] = [];
  let lastPlayedServer: LastPlayedServer | null = null;
  let serverError: string | undefined;
  let launcherDataLoaded = false;
  let active = true;

  void api.storage
    .get<number>("clicks")
    .then((savedClicks) => {
      if (!active || typeof savedClicks !== "number" || !Number.isSafeInteger(savedClicks) || savedClicks < 0) return;
      clicks = savedClicks;
      api.updatePage("welcome", pageContent());
    })
    .catch(() => undefined);

  function pageContent(): ModPage {
    const serverProfile = lastPlayedServer
      ? profiles.find((profile) => profile.id === lastPlayedServer?.profileId)
      : undefined;
    return {
      id: "welcome",
      title: "Hello NoLoader",
      content: [
        {
          type: "text",
          text: "This page is rendered by the launcher from a validated component tree.",
        },
        {
          type: "card",
          title: "A live extension action",
          children: [
            {
              type: "text",
              text:
                clicks === 0
                  ? "The action has not run yet."
                  : `Action activated ${clicks} time${clicks === 1 ? "" : "s"}.`,
            },
            {
              type: "button",
              id: "increment",
              label: "Run example action",
              action: "increment",
            },
          ],
        },
        {
          type: "card",
          title: "Quick Join",
          children: !launcherDataLoaded
            ? [
                {
                  type: "text",
                  text: "Load launcher profile and recent server information when you choose to.",
                },
                {
                  type: "button",
                  id: "load-launcher-data",
                  label: "Load recent server",
                  action: "load-launcher-data",
                },
              ]
            : lastPlayedServer
            ? [
                {
                  type: "text",
                  text: `${lastPlayedServer.address} · ${serverProfile?.name ?? "last played profile"}`,
                },
                {
                  type: "button",
                  id: "join-last-server",
                  label: "Join last server",
                  action: "join-last-server",
                },
                ...(serverError ? [{ type: "text" as const, text: serverError }] : []),
              ]
            : [
                {
                  type: "text",
                  text: "No multiplayer Quick Play server has been recorded yet.",
                },
              ],
        },
        {
          type: "text",
          text: `Launcher profiles available: ${profiles.length}`,
        },
        {
          type: "text",
          text: "The extension JavaScript runs in a Web Worker. This is not an operating-system sandbox.",
        },
      ],
    };
  }

  function homeWidgetContent(): ModHomeWidget {
    const serverProfile = lastPlayedServer
      ? profiles.find((profile) => profile.id === lastPlayedServer?.profileId)
      : undefined;
    return {
      id: "quick-join",
      title: "NoLoader Quick Join",
      content: !launcherDataLoaded
        ? [
            {
              type: "text",
              text: "Load your recent server only when you choose to.",
            },
            {
              type: "button",
              id: "load-launcher-data",
              label: "Load recent server",
              action: "load-launcher-data",
            },
          ]
        : lastPlayedServer
          ? [
              {
                type: "text",
                text: `${lastPlayedServer.address} · ${serverProfile?.name ?? "last played profile"}`,
              },
              {
                type: "button",
                id: "join-last-server",
                label: "Join last server",
                action: "join-last-server",
              },
              ...(serverError ? [{ type: "text" as const, text: serverError }] : []),
            ]
          : [
              {
                type: "text",
                text: serverError ?? "No multiplayer Quick Play server has been recorded yet.",
              },
            ],
    };
  }

  const removePage = api.registerPage(pageContent());
  const removeHomeWidget = api.registerHomeWidget(homeWidgetContent());
  const removeNavigation = api.registerNavigationItem({
    id: "welcome",
    label: "Hello",
    pageId: "welcome",
    icon: "sparkles",
  });
  const removeAction = api.onAction((action) => {
    if (action === "increment") {
      clicks += 1;
      api.updatePage("welcome", pageContent());
      return api.storage.set("clicks", clicks);
    }
    if (action === "load-launcher-data") {
      return Promise.all([api.profiles.list(), api.servers.getLastPlayed()])
        .then(([loadedProfiles, server]) => {
          if (!active) return;
          profiles = loadedProfiles;
          lastPlayedServer = server;
          launcherDataLoaded = true;
          serverError = undefined;
          api.updatePage("welcome", pageContent());
          api.updateHomeWidget("quick-join", homeWidgetContent());
        })
        .catch((error: unknown) => {
          if (!active) return;
          launcherDataLoaded = true;
          serverError = error instanceof Error ? error.message : String(error);
          api.updatePage("welcome", pageContent());
          api.updateHomeWidget("quick-join", homeWidgetContent());
        });
    }
    if (action === "join-last-server" && lastPlayedServer) {
      return api.launcher
        .launchProfile({
          profileId: lastPlayedServer.profileId,
          serverAddress: lastPlayedServer.address,
        })
        .catch((error: unknown) => {
          serverError = error instanceof Error ? error.message : String(error);
          api.updatePage("welcome", pageContent());
          api.updateHomeWidget("quick-join", homeWidgetContent());
        });
    }
  });

  return () => {
    active = false;
    removeAction();
    removeNavigation();
    removeHomeWidget();
    removePage();
  };
}
