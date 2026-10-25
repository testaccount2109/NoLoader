import type {
  LastPlayedServer,
  LauncherProfile,
  ModHomeWidget,
  NoLoaderActivation,
  NoLoaderApi,
} from "../../types/no-loader";

const WIDGET_ID = "quick-join";
const REFRESH_ACTION = "refresh-server";
const JOIN_ACTION = "join-last-server";
const PICK_LOG_FOLDER_ACTION = "pick-log-folder";
const LOG_POLL_INTERVAL_MS = 3000;

interface StoredLastPlayedServer extends LastPlayedServer {
  [key: string]: string;
}

export function activate(api: NoLoaderApi): NoLoaderActivation {
  let lastServer: LastPlayedServer | null = null;
  let serverName = "";
  let status: PublicServerStatus | null = null;
  let profiles: LauncherProfile[] = [];
  let logDirectory: string | undefined;
  let lastDetectedAddress: string | undefined;
  let loading = true;
  let refreshing = false;
  let joining = false;
  let message: string | undefined;
  let active = true;
  let logPollTimer: ReturnType<typeof setInterval> | undefined;

  const renderWidget = (): ModHomeWidget => {
    if (loading) {
      return {
        id: WIDGET_ID,
        title: "Zuletzt gespielter Server",
        position: "after-play",
        content: [{ type: "text", text: "Letzten Server wird geladen …" }],
      };
    }

    if (!lastServer) {
      return {
        id: WIDGET_ID,
        title: "Zuletzt gespielter Server",
        position: "after-play",
        content: [
          { type: "text", text: message ?? "Noch kein Server erkannt. Wähle deinen Minecraft-Profilordner, damit NoLoader Verbindungen aus dem Spiel-Log erkennen kann." },
          {
            type: "button",
            id: "pick-log-folder-empty",
            label: logDirectory ? "Erkennung erneut prüfen" : "Minecraft-Profilordner wählen",
            action: PICK_LOG_FOLDER_ACTION,
          },
        ],
      };
    }

    const players = status?.online === true && status.players
      ? `${status.players.online} / ${status.players.max} Spieler online`
      : status?.online === false
        ? "Server ist offline"
        : "Spielerzahl wird geladen …";
    serverName = status?.hostname || serverName || lastServer.address;
    const details = [
      { type: "heading" as const, level: 3 as const, text: (serverName || lastServer.address).slice(0, 1000) },
      { type: "text" as const, text: lastServer.address.slice(0, 1000) },
      ...(status?.motd?.clean?.length ? [{ type: "text" as const, text: status.motd.clean.join(" · ").slice(0, 1000) }] : []),
      { type: "text" as const, text: players },
      { type: "text" as const, text: "Statusabfrage über mcsrvstat.us" },
      { type: "text" as const, text: logDirectory ? "Manuelle Serverbeitritte werden aus latest.log erkannt." : "Für manuelle Serverbeitritte einmal den Profilordner wählen." },
    ];

    return {
      id: WIDGET_ID,
      title: "Zuletzt gespielter Server",
      position: "after-play",
      content: [
        {
          type: "card",
          children: [
            {
              type: "stack",
              direction: "row",
              children: [
                { type: "text", text: "🟩" },
                { type: "stack", direction: "column", children: details },
              ],
            },
            ...(message ? [{ type: "text" as const, text: message }] : []),
            {
              type: "stack",
              direction: "row",
              children: [
                {
                  type: "button",
                  id: "join-last-server",
                  label: joining ? "Minecraft startet …" : "Server beitreten",
                  action: JOIN_ACTION,
                },
                {
                  type: "button",
                  id: "refresh-server",
                  label: refreshing ? "Aktualisiere …" : "Aktualisieren",
                  action: REFRESH_ACTION,
                },
                {
                  type: "button",
                  id: "pick-log-folder",
                  label: "Logordner ändern",
                  action: PICK_LOG_FOLDER_ACTION,
                },
              ],
            },
          ],
        },
      ],
    };
  };

  const update = () => {
    if (active) api.updateHomeWidget(WIDGET_ID, renderWidget());
  };

  const refreshStatus = async () => {
    if (!lastServer || refreshing) return;
    refreshing = true;
    message = undefined;
    update();
    try {
      status = await fetchServerStatus(api, lastServer.address);
      serverName = status.hostname || lastServer.address;
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    } finally {
      refreshing = false;
      update();
    }
  };

  const scanLog = async () => {
    if (!active || !logDirectory) return;
    try {
      const path = latestLogPath(logDirectory);
      const contents = await api.system.files.readText(path);
      const address = findLastConnectedAddress(contents);
      if (!address || address === lastDetectedAddress) return;
      lastDetectedAddress = address;
      const profile = profiles.find((candidate) => candidate.isLastPlayed) ?? profiles[0];
      const profileId = profile?.id ?? lastServer?.profileId;
      if (!profileId) {
        message = "Server erkannt, aber NoRisk hat kein Minecraft-Profil dazu gefunden.";
        update();
        return;
      }

      const detected: StoredLastPlayedServer = {
        profileId,
        address,
        playedAt: new Date().toISOString(),
      };
      lastServer = detected;
      serverName = address;
      status = null;
      message = undefined;
      await api.storage.set("manualLastServer", detected);
      update();
      void refreshStatus();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      message = detail.includes("not found") || detail.includes("No such file")
        ? "Kein logs/latest.log in diesem Ordner gefunden. Wähle den Minecraft-Profilordner."
        : `Log konnte nicht gelesen werden: ${detail}`;
      update();
    }
  };

  const chooseLogFolder = async () => {
    try {
      const selected = await api.dialogs.openDirectory();
      if (!selected) return;
      logDirectory = selected;
      lastDetectedAddress = undefined;
      await api.storage.set("logDirectory", selected);
      if (logPollTimer) clearInterval(logPollTimer);
      await scanLog();
      logPollTimer = setInterval(() => void scanLog(), LOG_POLL_INTERVAL_MS);
      update();
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
      update();
    }
  };

  const removeWidget = api.registerHomeWidget({
    id: WIDGET_ID,
    title: "Zuletzt gespielter Server",
    position: "after-play",
    content: [{ type: "text", text: "Letzten Server wird geladen …" }],
  });
  const removeAction = api.onAction(async (action) => {
    if (action === REFRESH_ACTION) {
      await refreshStatus();
      return;
    }
    if (action === PICK_LOG_FOLDER_ACTION) {
      await chooseLogFolder();
      return;
    }
    if (action !== JOIN_ACTION || !lastServer || joining) return;
    joining = true;
    message = undefined;
    update();
    try {
      await api.launcher.launchProfile({
        profileId: lastServer.profileId,
        serverAddress: lastServer.address,
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    } finally {
      joining = false;
      update();
    }
  });

  void initialize();

  async function initialize() {
    try {
      const [profilesResult, quickPlayServer, savedServer, savedDirectory] = await Promise.all([
        api.profiles.list(),
        api.servers.getLastPlayed(),
        api.storage.get<StoredLastPlayedServer>("manualLastServer"),
        api.storage.get<string>("logDirectory"),
      ]);
      if (!active) return;
      profiles = profilesResult;
      lastServer = savedServer ?? quickPlayServer;
      logDirectory = savedDirectory;
      if (logDirectory) {
        await scanLog();
        if (active) logPollTimer = setInterval(() => void scanLog(), LOG_POLL_INTERVAL_MS);
      }
      loading = false;
      update();
      if (lastServer && !status) void refreshStatus();
    } catch (error) {
      if (!active) return;
      loading = false;
      message = error instanceof Error ? error.message : String(error);
      update();
    }
  }

  return () => {
    active = false;
    if (logPollTimer) clearInterval(logPollTimer);
    removeAction();
    removeWidget();
  };
}

interface PublicServerStatus {
  online?: boolean;
  hostname?: string;
  players?: { online: number; max: number };
  motd?: { clean?: string[] };
}

async function fetchServerStatus(api: NoLoaderApi, address: string): Promise<PublicServerStatus> {
  const response = await api.network.request({
    url: `https://api.mcsrvstat.us/3/${encodeURIComponent(address)}`,
    headers: { "User-Agent": "NoLoader-Last-Server-Quick-Join/1.1.1" },
  });
  if (!response.ok) throw new Error(`Statusdienst antwortet mit HTTP ${response.status}.`);
  const value: unknown = JSON.parse(response.body);
  if (!value || typeof value !== "object") throw new Error("Ungültige Serverstatus-Antwort.");
  return value as PublicServerStatus;
}

function latestLogPath(directory: string): string {
  const normalized = directory.replace(/[\\/]+$/, "");
  return /[\\/]logs$/i.test(normalized)
    ? `${normalized}/latest.log`
    : `${normalized}/logs/latest.log`;
}

function findLastConnectedAddress(log: string): string | undefined {
  const pattern = /Connecting to\s+(\[[^\]]+\]|[^,\s]+)(?:,\s*(\d{1,5}))?/gi;
  let last: string | undefined;
  for (const match of log.matchAll(pattern)) {
    const host = match[1]?.replace(/[),;]+$/, "");
    const port = match[2];
    if (!host) continue;
    const address = port && !host.endsWith(`]:${port}`) ? `${host}:${port}` : host;
    if (address.length <= 255) last = address;
  }
  return last;
}
