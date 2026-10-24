import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { LoaderCircle, Server } from "lucide-react";
import { launch } from "../../services/process-service";

interface LastPlayedServer {
  profileId: string;
  address: string;
  playedAt: string;
}

export function LastPlayedServerButton() {
  const [server, setServer] = useState<LastPlayedServer | null>(null);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [message, setMessage] = useState<string>();

  useEffect(() => {
    let active = true;
    void invoke<LastPlayedServer | null>("noloader_get_last_played_server")
      .then((result) => {
        if (active) setServer(result);
      })
      .catch((error: unknown) => {
        if (active)
          setMessage(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  if (loading || (!server && !message)) return null;

  return (
    <section className="w-full max-w-3xl rounded-lg border border-white/15 bg-black/25 px-4 py-3 backdrop-blur-md">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-sky-300/20 bg-sky-300/10 text-sky-100">
            {joining ? (
              <LoaderCircle
                className="h-4 w-4 animate-spin"
                aria-hidden="true"
              />
            ) : (
              <Server className="h-4 w-4" aria-hidden="true" />
            )}
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/45">
              Zuletzt gespielter Server
            </p>
            <p className="truncate text-sm font-medium text-white/90">
              {server?.address ?? message}
            </p>
            {message && server && (
              <p role="alert" className="mt-0.5 text-xs text-red-200/80">
                {message}
              </p>
            )}
          </div>
        </div>
        {server && (
          <button
            type="button"
            disabled={joining}
            onClick={() => {
              setJoining(true);
              setMessage(undefined);
              void launch(server.profileId, undefined, server.address)
                .then(() =>
                  setMessage(
                    "Minecraft startet und verbindet sich mit dem Server …",
                  ),
                )
                .catch((error: unknown) =>
                  setMessage(
                    error instanceof Error ? error.message : String(error),
                  ),
                )
                .finally(() => setJoining(false));
            }}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-sky-300/30 bg-sky-300/15 px-4 text-xs font-semibold text-sky-50 transition hover:bg-sky-300/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-200 disabled:cursor-wait disabled:opacity-60"
          >
            {joining ? (
              <LoaderCircle
                className="h-4 w-4 animate-spin"
                aria-hidden="true"
              />
            ) : null}
            {joining ? "Minecraft startet …" : "Erneut beitreten"}
          </button>
        )}
      </div>
    </section>
  );
}
