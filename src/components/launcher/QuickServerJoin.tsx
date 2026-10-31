"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { toast } from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { useProfileLaunch } from "../../hooks/useProfileLaunch";
import { getLogFileContent, getProfileLogFiles } from "../../services/log-service";
import * as WorldService from "../../services/world-service";
import type { ServerInfo, ServerPingInfo } from "../../types/minecraft";

const LOG_REFRESH_MS = 15_000;
const PING_REFRESH_MS = 60_000;

function basename(path: string): string {
  return path.replace(/\\/g, "/").split("/").pop() ?? path;
}

/** Extract the most recent Minecraft multiplayer connection from a game log. */
export function getLastServerFromLog(log: string): string | null {
  const lines = log.split(/\r?\n/);
  const connectionPatterns = [
    /\bConnecting to (?:the )?(?:server\s+)?(\[[^\]]+\]|[^\s,:]+)\s*,\s*(\d{1,5})\b/i,
    /\bConnecting to (?:the )?(?:server\s+)?(\[[^\]]+\]|[^\s,]+):(\d{1,5})\b/i,
  ];

  for (let lineIndex = lines.length - 1; lineIndex >= 0; lineIndex -= 1) {
    for (const pattern of connectionPatterns) {
      const match = lines[lineIndex].match(pattern);
      if (!match) continue;

      const host = match[1].replace(/^\[|\]$/g, "").replace(/\.$/, "");
      const port = Number(match[2]);
      if (!host || !Number.isInteger(port) || port < 1 || port > 65535) continue;

      const normalizedHost = host.includes(":") ? `[${host}]` : host;
      return `${normalizedHost}:${port}`;
    }
  }

  return null;
}

function findLatestGameLog(paths: string[]): string | null {
  const latest = paths.find((path) => basename(path).toLowerCase() === "latest.log");
  if (latest) return latest;

  return paths
    .filter((path) => /\.log(?:\.gz)?$/i.test(path))
    .sort((left, right) => basename(right).localeCompare(basename(left)))[0] ?? null;
}

export function QuickServerJoin({
  profileId,
  className = "",
}: {
  profileId: string | null;
  className?: string;
}) {
  const { t } = useTranslation();
  const [serverAddress, setServerAddress] = useState<string | null>(null);
  const [serverInfo, setServerInfo] = useState<ServerInfo | null>(null);
  const [pingInfo, setPingInfo] = useState<ServerPingInfo | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const pollingRef = useRef(false);
  const activeProfileRef = useRef(profileId);

  const refreshFromLogs = useCallback(async () => {
    if (!profileId || pollingRef.current) return;
    const requestedProfileId = profileId;
    pollingRef.current = true;
    setIsRefreshing(true);

    try {
      const paths = await getProfileLogFiles(requestedProfileId);
      if (activeProfileRef.current !== requestedProfileId) return;
      const logPath = findLatestGameLog(paths);
      if (!logPath) {
        setServerAddress(null);
        return;
      }

      const log = await getLogFileContent(logPath);
      if (activeProfileRef.current !== requestedProfileId) return;
      setServerAddress(getLastServerFromLog(log));
    } catch (error) {
      // Profiles without a game log simply have no Quick Join target yet.
      console.debug("[QuickServerJoin] Could not read the selected profile's game log:", error);
      if (activeProfileRef.current === requestedProfileId) setServerAddress(null);
    } finally {
      pollingRef.current = false;
      if (activeProfileRef.current === requestedProfileId) setIsRefreshing(false);
    }
  }, [profileId]);

  useEffect(() => {
    activeProfileRef.current = profileId;
    setServerAddress(null);
    setServerInfo(null);
    setPingInfo(null);
    void refreshFromLogs();

    const interval = window.setInterval(() => {
      void refreshFromLogs();
    }, LOG_REFRESH_MS);

    return () => window.clearInterval(interval);
  }, [refreshFromLogs]);

  useEffect(() => {
    if (!profileId || !serverAddress) {
      setServerInfo(null);
      setPingInfo(null);
      return;
    }

    let cancelled = false;
    const normalizedAddress = serverAddress.trim().toLowerCase();

    void WorldService.getServersForProfile(profileId)
      .then((servers) => {
        if (cancelled) return;
        setServerInfo(
          servers.find((server) => server.address?.trim().toLowerCase() === normalizedAddress) ?? null,
        );
      })
      .catch(() => {
        if (!cancelled) setServerInfo(null);
      });

    const refreshPing = async () => {
      try {
        const ping = await WorldService.pingMinecraftServer(serverAddress);
        if (!cancelled) setPingInfo(ping);
      } catch {
        if (!cancelled) setPingInfo(null);
      }
    };

    void refreshPing();
    const pingInterval = window.setInterval(() => void refreshPing(), PING_REFRESH_MS);

    return () => {
      cancelled = true;
      window.clearInterval(pingInterval);
    };
  }, [profileId, serverAddress]);

  const { isLaunching, handleQuickPlayLaunch } = useProfileLaunch({
    profileId: profileId ?? "",
    quickPlayMultiplayer: serverAddress ?? undefined,
    onLaunchError: (error) => console.error("[QuickServerJoin] Launch failed:", error),
  });

  if (!profileId || !serverAddress) return null;

  const displayName = serverInfo?.name?.trim() || serverAddress;
  const playerCount =
    pingInfo?.players_online != null && pingInfo.players_max != null
      ? `${pingInfo.players_online}/${pingInfo.players_max}`
      : null;

  const handleJoin = () => {
    if (isLaunching) return;
    toast.success(t("launcher_mods.quick_server_join.joining", { name: displayName }));
    void handleQuickPlayLaunch(undefined, serverAddress);
  };

  return (
    <div className={`flex w-full items-center gap-3 rounded-xl border border-white/10 bg-black/45 px-3 py-2.5 backdrop-blur-md ${className}`}>
      <div className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white/10 ring-1 ring-white/10">
        {serverInfo?.icon_base64 ? (
          <img
            src={`data:image/png;base64,${serverInfo.icon_base64}`}
            alt=""
            className="h-full w-full object-cover"
            style={{ imageRendering: "pixelated" }}
          />
        ) : (
          <Icon icon="solar:server-square-bold" className="h-5 w-5 text-white/55" />
        )}
        {isRefreshing && (
          <span className="absolute bottom-0.5 right-0.5 h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-300" />
        )}
      </div>

      <div className="min-w-0 flex-1 text-left">
        <div className="font-minecraft text-[9px] uppercase tracking-[0.16em] text-white/45">
          {t("launcher_mods.quick_server_join.last_server")}
        </div>
        <div className="truncate font-minecraft text-sm font-semibold text-white" title={displayName}>
          {displayName}
        </div>
        <div className="flex min-w-0 items-center gap-2 font-minecraft text-[10px] text-white/45">
          <span className="truncate" title={serverAddress}>{serverAddress}</span>
          {playerCount && <span className="shrink-0 tabular-nums">{playerCount}</span>}
        </div>
      </div>

      <button
        type="button"
        onClick={handleJoin}
        disabled={isLaunching}
        title={t("launcher_mods.quick_server_join.join", { name: displayName })}
        aria-label={t("launcher_mods.quick_server_join.join", { name: displayName })}
        className="flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.06] px-3 font-minecraft text-xs font-bold text-white transition hover:border-white/20 hover:bg-white/15 disabled:cursor-wait disabled:opacity-50"
      >
        <Icon
          icon={isLaunching ? "svg-spinners:ring-resize" : "solar:login-2-bold"}
          className="h-4 w-4"
        />
        {t("launcher_mods.quick_server_join.join_button")}
      </button>
    </div>
  );
}
