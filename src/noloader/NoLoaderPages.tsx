import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  Blocks,
  Check,
  CircleDashed,
  CircleX,
  Code2,
  FolderOpen,
  LoaderCircle,
  Power,
  RefreshCw,
  Search,
  ShieldAlert,
} from "lucide-react";
import { ModUiTree } from "./ModUiTree";
import {
  useNoLoader,
  type ModLifecycleState,
  type NoLoaderMod,
} from "./NoLoaderContext";
import type { PermissionId } from "./core/manifest";
import { openExternalUrl } from "../services/tauri-service";
import { getCurrentWindow } from "@tauri-apps/api/window";

const permissionLabels: Record<
  PermissionId,
  { label: string; description: string }
> = {
  "ui.pages": {
    label: "Add launcher pages",
    description: "Show this extension's pages in the launcher.",
  },
  "ui.navigation": {
    label: "Add launcher navigation",
    description: "Add links to pages provided by this extension.",
  },
  "ui.home": {
    label: "Add Play screen widgets",
    description: "Show widgets around the Play controls.",
  },
  "ui.globalStyles": {
    label: "Change launcher appearance",
    description: "Apply styles across launcher screens.",
  },
  "launcher.profiles.read": {
    label: "Read profile details",
    description: "Read profile names, game versions, and loader types.",
  },
  "launcher.lastServer.read": {
    label: "Read the last Quick Play server",
    description: "Read the last server started through NoRisk Quick Play.",
  },
  "launcher.launch": {
    label: "Start a Minecraft profile",
    description:
      "Start a profile, optionally joining a server, from a button action.",
  },
  "launcher.features.manage": {
    label: "Manage optional launcher features",
    description:
      "Control the documented news, effects, ads, and CurseForge options.",
  },
  "launcher.performance.read": {
    label: "Read extension API performance",
    description: "Read extension API request and latency samples.",
  },
  "storage.mod": {
    label: "Save extension settings",
    description: "Store JSON data owned by this extension.",
  },
  "events.publish": {
    label: "Send extension events",
    description: "Publish namespaced events for other extensions.",
  },
  "events.subscribe": {
    label: "Receive extension events",
    description: "Listen for namespaced events from other extensions.",
  },
  "network.http": {
    label: "Connect to web APIs",
    description: "Send HTTPS requests to extension services. Requests and responses are size-limited.",
  },
  "launcher.notifications": { label: "Show launcher notifications", description: "Display notices inside the launcher." },
  "launcher.openExternal": { label: "Open external links", description: "Open web and mail links from a user action." },
  "system.clipboard": { label: "Read and write clipboard", description: "Access clipboard text." },
  "system.dialog": { label: "Show file and confirmation dialogs", description: "Ask the user to pick a file/folder, choose an output path, or confirm an action." },
  "system.files": { label: "Access files on this PC", description: "Read, create, modify, move, copy, and delete files using absolute paths." },
  "system.process": { label: "Open files and applications", description: "Open files or folders with the operating system." },
  "launcher.windows": { label: "Open standalone windows", description: "Show this extension's registered pages in separate windows." },
  "launcher.clientRuntime": { label: "Run code in NoRisk Client", description: "Execute extension ES modules in the full client webview, including direct document and launcher runtime access." },
};

const statePresentation: Record<
  ModLifecycleState,
  { label: string; className: string; icon: typeof Check }
> = {
  discovered: {
    label: "Discovered",
    className: "text-sky-200 border-sky-300/20 bg-sky-300/10",
    icon: CircleDashed,
  },
  invalid: {
    label: "Invalid",
    className: "text-red-200 border-red-300/20 bg-red-300/10",
    icon: CircleX,
  },
  incompatible: {
    label: "Incompatible",
    className: "text-amber-100 border-amber-300/20 bg-amber-300/10",
    icon: AlertTriangle,
  },
  blocked: {
    label: "Blocked",
    className: "text-amber-100 border-amber-300/20 bg-amber-300/10",
    icon: ShieldAlert,
  },
  conflict: {
    label: "Conflict",
    className: "text-red-200 border-red-300/20 bg-red-300/10",
    icon: CircleX,
  },
  "duplicate-id": {
    label: "Duplicate ID",
    className: "text-red-200 border-red-300/20 bg-red-300/10",
    icon: CircleX,
  },
  "dependency-cycle": {
    label: "Dependency cycle",
    className: "text-red-200 border-red-300/20 bg-red-300/10",
    icon: CircleX,
  },
  loading: {
    label: "Starting",
    className: "text-sky-200 border-sky-300/20 bg-sky-300/10",
    icon: LoaderCircle,
  },
  loaded: {
    label: "Running",
    className: "text-emerald-200 border-emerald-300/20 bg-emerald-300/10",
    icon: Check,
  },
  failed: {
    label: "Failed",
    className: "text-red-200 border-red-300/20 bg-red-300/10",
    icon: CircleX,
  },
  disabled: {
    label: "Disabled",
    className: "text-white/50 border-white/10 bg-white/[0.04]",
    icon: Power,
  },
};

export function NoLoaderManagerPage() {
  const {
    mods,
    pages,
    navigation,
    modsDirectory,
    launcherVersion,
    loading,
    error,
    settingsError,
    safeMode,
    refresh,
    setEnabled,
    setSafeMode,
    openModsDirectory,
  } = useNoLoader();
  const [selectedDirectory, setSelectedDirectory] = useState<string>();
  const [pendingDirectory, setPendingDirectory] = useState<string>();
  const [safeModePending, setSafeModePending] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "running" | "attention" | "disabled"
  >("all");
  const navigate = useNavigate();
  const matchingMods = mods.filter((mod) => {
    const query = search.trim().toLocaleLowerCase();
    const matchesQuery =
      !query ||
      [
        mod.manifest?.name,
        mod.manifest?.id,
        mod.manifest?.description,
        mod.directory,
      ].some((value) => value?.toLocaleLowerCase().includes(query));
    const matchesStatus =
      statusFilter === "all" ||
      (statusFilter === "running" && mod.state === "loaded") ||
      (statusFilter === "disabled" && mod.state === "disabled") ||
      (statusFilter === "attention" &&
        [
          "invalid",
          "incompatible",
          "blocked",
          "conflict",
          "duplicate-id",
          "dependency-cycle",
          "failed",
        ].includes(mod.state));
    return matchesQuery && matchesStatus;
  });
  const selected =
    matchingMods.find((mod) => mod.directory === selectedDirectory) ??
    matchingMods[0];
  const loadedCount = mods.filter((mod) => mod.state === "loaded").length;
  const canToggle = Boolean(selected?.manifest) && !settingsError && !loading;

  const handleEnable = async (mod: NoLoaderMod) => {
    setPendingDirectory(mod.directory);
    setActionError(undefined);
    try {
      await setEnabled(mod.directory, !mod.enabled);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setPendingDirectory(undefined);
    }
  };

  const handleOpenDirectory = async () => {
    setActionError(undefined);
    try {
      await openModsDirectory();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  const handleSafeMode = async () => {
    setSafeModePending(true);
    setActionError(undefined);
    try {
      await setSafeMode(!safeMode);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSafeModePending(false);
    }
  };

  return (
    <div className="h-full min-h-0 overflow-y-auto custom-scrollbar px-7 py-6 font-sans text-white md:px-9">
      <div className="mx-auto max-w-[1480px] pb-8">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-sky-200/70">
              <Code2 className="h-4 w-4" aria-hidden="true" /> Client extensions
            </div>
            <h1 className="font-smallcaps text-3xl tracking-wide text-white">
              NoLoader
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-white/55">
              Add launcher pages, widgets, quick actions, themes, and profile
              tools with extensions.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleOpenDirectory()}
              disabled={!modsDirectory}
              className="inline-flex h-10 items-center gap-2 rounded-md border border-white/10 bg-black/20 px-3 text-sm text-white/75 transition hover:border-white/20 hover:bg-white/[0.06] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-300 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <FolderOpen className="h-4 w-4" aria-hidden="true" /> Open extensions
              folder
            </button>
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={loading}
              className="inline-flex h-10 items-center gap-2 rounded-md border border-sky-300/30 bg-sky-400/10 px-3 text-sm font-medium text-sky-100 transition hover:bg-sky-400/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-300 disabled:cursor-wait disabled:opacity-50"
            >
              <RefreshCw
                className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
                aria-hidden="true"
              />{" "}
              Refresh
            </button>
          </div>
        </header>

        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <MetricCard
            label="Detected"
            value={loading ? "—" : String(mods.length)}
            icon={<Blocks className="h-4 w-4" />}
          />
          <MetricCard
            label="Running"
            value={loading ? "—" : String(loadedCount)}
            icon={<Check className="h-4 w-4" />}
          />
          <MetricCard
            label="Launcher"
            value={launcherVersion || "—"}
            icon={<Code2 className="h-4 w-4" />}
            className="col-span-2 sm:col-span-1"
          />
        </div>


        {(error || settingsError || actionError) && (
          <div
            role="alert"
            className="mb-4 flex items-start gap-3 rounded-md border border-red-300/20 bg-red-950/30 px-4 py-3 text-sm text-red-100"
          >
            <AlertTriangle
              className="mt-0.5 h-4 w-4 shrink-0"
              aria-hidden="true"
            />
            <div>
              <p className="font-medium">
                {error
                  ? "NoLoader could not scan installed extensions"
                  : settingsError
                    ? "Settings could not be saved safely"
                    : "Action failed"}
              </p>
              <p className="mt-1 text-red-100/70">
                {error ?? settingsError ?? actionError}
              </p>
            </div>
          </div>
        )}

        <div
          className={`mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3 ${safeMode ? "border-amber-200/20 bg-amber-300/[0.06]" : "border-white/10 bg-[#0d121a]/70"}`}
        >
          <div className="flex items-start gap-3">
            <ShieldAlert
              className={`mt-0.5 h-4 w-4 shrink-0 ${safeMode ? "text-amber-100" : "text-white/45"}`}
              aria-hidden="true"
            />
            <div>
              <p className="text-sm font-medium text-white/85">
                Safe mode{" "}
                <span
                  className={`ml-2 text-xs font-normal ${safeMode ? "text-amber-100/80" : "text-white/40"}`}
                >
                  {error ? "Unavailable" : safeMode ? "Active" : "Off"}
                </span>
              </p>
              <p className="mt-0.5 text-xs text-white/45">
                {error
                  ? "Open NoLoader in the desktop launcher to read or change this setting."
                  : safeMode
                    ? "No extensions are started. Their individual enabled settings are preserved."
                    : "Pause extension startup if an extension is preventing the launcher from working."}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void handleSafeMode()}
            disabled={
              loading ||
              safeModePending ||
              Boolean(settingsError) ||
              Boolean(error)
            }
            className="inline-flex min-h-9 items-center gap-2 rounded-md border border-white/10 bg-white/[0.035] px-3 text-xs font-medium text-white/70 transition hover:bg-white/[0.08] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-300 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {safeModePending ? (
              <LoaderCircle
                className="h-4 w-4 animate-spin"
                aria-hidden="true"
              />
            ) : (
              <Power className="h-4 w-4" aria-hidden="true" />
            )}
            {safeMode ? "Resume extensions" : "Pause extensions"}
          </button>
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.8fr)]">
          <section className="min-w-0 overflow-hidden rounded-lg border border-white/10 bg-[#0d121a]/80">
            <div className="flex items-center justify-between border-b border-white/[0.08] px-5 py-4">
              <div>
                <h2 className="text-sm font-semibold text-white">
                  Installed extensions
                </h2>
                <p className="mt-1 text-xs text-white/45">
                  {matchingMods.length} shown · dependency order
                </p>
              </div>
              <span className="rounded-full border border-white/10 px-2.5 py-1 text-xs text-white/55">
                {mods.length}
              </span>
            </div>
            <div className="flex flex-wrap gap-2 border-b border-white/[0.08] p-3">
              <label className="relative min-w-[180px] flex-1">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35"
                  aria-hidden="true"
                />
                <span className="sr-only">Search extensions</span>
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search name, ID, or description"
                  className="h-9 w-full rounded-md border border-white/10 bg-black/20 pl-9 pr-3 text-xs text-white placeholder:text-white/30 focus:border-sky-300/40 focus:outline-none focus:ring-1 focus:ring-sky-300/30"
                />
              </label>
              <label>
                <span className="sr-only">Filter extensions by status</span>
                <select
                  value={statusFilter}
                  onChange={(event) =>
                    setStatusFilter(event.target.value as typeof statusFilter)
                  }
                  className="h-9 rounded-md border border-white/10 bg-[#111820] px-3 text-xs text-white/75 focus:border-sky-300/40 focus:outline-none focus:ring-1 focus:ring-sky-300/30"
                >
                  <option value="all">All statuses</option>
                  <option value="running">Running</option>
                  <option value="disabled">Disabled</option>
                  <option value="attention">Needs attention</option>
                </select>
              </label>
            </div>
            <div className="max-h-[min(58vh,620px)] min-h-[260px] overflow-y-auto custom-scrollbar p-2">
              {loading && mods.length === 0 ? (
                <LoadingState />
              ) : mods.length === 0 ? (
                <EmptyState
                  onOpen={handleOpenDirectory}
                  directory={modsDirectory}
                />
              ) : (
                <ul className="space-y-1" aria-label="Installed extensions">
                  {matchingMods.length === 0 ? (
                    <li className="flex min-h-48 flex-col items-center justify-center px-6 text-center">
                      <Search
                        className="mb-3 h-6 w-6 text-white/30"
                        aria-hidden="true"
                      />
                      <p className="text-sm font-medium text-white/70">
                        No matching extensions
                      </p>
                      <p className="mt-1 text-xs text-white/40">
                        Try a different search or status filter.
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          setSearch("");
                          setStatusFilter("all");
                        }}
                        className="mt-3 text-xs text-sky-200 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-300"
                      >
                        Clear filters
                      </button>
                    </li>
                  ) : (
                    matchingMods.map((mod) => (
                      <ModListItem
                        key={mod.directory}
                        mod={mod}
                        selected={selected?.directory === mod.directory}
                        onSelect={() => setSelectedDirectory(mod.directory)}
                      />
                    ))
                  )}
                </ul>
              )}
            </div>
            {navigation.some((entry) =>
              mods.some(
                (mod) =>
                  mod.manifest?.id === entry.modId && mod.state === "loaded",
              ),
            ) && (
              <div className="border-t border-white/[0.08] p-4">
                <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/40">
                  Mod pages
                </h3>
                <div className="flex flex-wrap gap-2">
                  {navigation
                    .filter(({ modId }) =>
                      mods.some(
                        (mod) =>
                          mod.manifest?.id === modId && mod.state === "loaded",
                      ),
                    )
                    .map(({ modId, item }) => (
                      <button
                        key={`${modId}:${item.id}`}
                        onClick={() =>
                          navigate(
                            `/noloader/${encodeURIComponent(modId)}/${encodeURIComponent(item.pageId)}`,
                          )
                        }
                        className="inline-flex min-h-9 items-center gap-2 rounded-md border border-white/10 bg-white/[0.03] px-3 text-xs text-white/70 transition hover:border-sky-300/30 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-300"
                      >
                        <span
                          className="h-1.5 w-1.5 rounded-full bg-sky-300"
                          aria-hidden="true"
                        />
                        {item.label}
                        <span className="text-white/30">· {modId}</span>
                      </button>
                    ))}
                </div>
              </div>
            )}
          </section>

          <section className="min-w-0 rounded-lg border border-white/10 bg-[#0d121a]/80">
            {selected ? (
              <ModDetails
                mod={selected}
                runningPageCount={
                  pages.filter((page) => page.modId === selected.manifest?.id)
                    .length
                }
                loadOrder={
                  selected.state === "loaded"
                    ? mods
                        .filter((mod) => mod.state === "loaded")
                        .findIndex(
                          (mod) => mod.directory === selected.directory,
                        ) + 1
                    : undefined
                }
                pending={pendingDirectory === selected.directory}
                canToggle={canToggle}
                onToggle={() => void handleEnable(selected)}
              />
            ) : (
              <div className="flex min-h-[300px] flex-col items-center justify-center p-8 text-center text-white/50">
                <Blocks className="mb-3 h-8 w-8" aria-hidden="true" />
                <p className="text-sm">
                  Select an extension to inspect its manifest and status.
                </p>
              </div>
            )}
          </section>
        </div>

        <footer className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-white/35">
          <span className="inline-flex items-center gap-2">
            <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
            Extensions run in isolated workers with permission-based API
            access.
          </span>
          {modsDirectory && (
            <span className="max-w-full truncate" title={modsDirectory}>
              {modsDirectory}
            </span>
          )}
        </footer>
      </div>
    </div>
  );
}

export function NoLoaderExtensionPage() {
  const { modId = "", pageId = "" } = useParams();
  const navigate = useNavigate();
  const { mods, pages, navigation, sendAction } = useNoLoader();
  const mod = mods.find(
    (entry) => entry.manifest?.id === modId && entry.state === "loaded",
  );
  const registered = pages.find(
    (entry) => entry.modId === modId && entry.page.id === pageId,
  );
  const navLabel = navigation.find(
    (entry) => entry.modId === modId && entry.item.pageId === pageId,
  )?.item.label;
  const handleAction = useMemo(
    () => (action: string, value?: string | number | boolean) =>
      sendAction(modId, action, value),
    [modId, sendAction],
  );

  if (!registered || !mod?.manifest) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-white">
        <div className="max-w-md rounded-lg border border-white/10 bg-[#0d121a]/90 p-6">
          <CircleX className="mb-3 h-6 w-6 text-amber-200" aria-hidden="true" />
          <h1 className="text-lg font-semibold">Extension page unavailable</h1>
          <p className="mt-2 text-sm text-white/55">
            This page is not registered by a running extension. It may have been
            disabled or failed to load.
          </p>
          <button
            type="button"
            onClick={() => navigate("/noloader")}
            className="mt-5 inline-flex min-h-10 items-center gap-2 rounded-md border border-white/15 px-3 text-sm text-white/75 hover:bg-white/[0.06] focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-300"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to NoLoader
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto custom-scrollbar p-7 font-sans text-white md:p-9">
      <div className="mx-auto max-w-[1200px]">
        <button
          type="button"
          onClick={() => navigate("/noloader")}
          className="mb-5 inline-flex items-center gap-2 text-xs text-white/45 transition hover:text-white/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-300"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          NoLoader
        </button>
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3 border-b border-white/10 pb-5">
          <div>
            <p className="mb-1 text-xs text-white/40">
              {mod.manifest.name} <span aria-hidden="true">/</span>{" "}
              {navLabel ?? "Extension page"}
            </p>
            <h1 className="font-smallcaps text-3xl tracking-wide">
              {registered.page.title}
            </h1>
          </div>
          <span className="rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1 text-xs text-emerald-100">
            Running · {mod.manifest.version}
          </span>
        </div>
        <ModUiTree
          page={registered.page}
          styles={registered.styles}
          onAction={handleAction}
        />
      </div>
    </div>
  );
}

export function NoLoaderDetachedWindowPage() {
  const { modId = "", pageId = "" } = useParams();
  const { mods, pages, sendAction } = useNoLoader();
  const mod = mods.find((entry) => entry.manifest?.id === modId && entry.state === "loaded");
  const registered = pages.find((entry) => entry.modId === modId && entry.page.id === pageId);
  if (!registered || !mod?.manifest) return <div className="flex h-screen items-center justify-center bg-[#090d13] p-8 text-white/70">This extension page is unavailable.</div>;
  return <div className="h-screen overflow-auto bg-[#090d13] p-6 text-white"><header className="mb-5 flex items-center justify-between border-b border-white/10 pb-3"><div><div className="text-xs text-white/40">{mod.manifest.name}</div><h1 className="text-lg font-semibold">{registered.page.title}</h1></div><button className="rounded border border-white/15 px-3 py-1 text-sm" onClick={() => void getCurrentWindow().close()}>Close</button></header><ModUiTree page={registered.page} styles={registered.styles} onAction={(action, value) => sendAction(modId, action, value)} /></div>;
}

export function NoLoaderBlankWindowPage() {
  const { modId = "", windowId = "" } = useParams();
  useEffect(() => {
    const key = `noloader:runtime:${modId}:${windowId}`;
    const execute = () => {
      const source = localStorage.getItem(key);
      if (!source) return;
      localStorage.removeItem(key);
      const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
      void import(/* @vite-ignore */ url).catch((error) => console.error("[NoLoader extension module]", error)).finally(() => URL.revokeObjectURL(url));
    };
    const onStorage = (event: StorageEvent) => { if (event.key === key) execute(); };
    window.addEventListener("storage", onStorage);
    execute();
    return () => window.removeEventListener("storage", onStorage);
  }, [modId, windowId]);
  return <main id="noloader-extension-root" data-extension={modId} data-window={windowId} className="h-screen overflow-auto bg-[#090d13] text-white" />;
}

function MetricCard({
  label,
  value,
  icon,
  className = "",
}: {
  label: string;
  value: string;
  icon: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex min-h-[70px] items-center gap-3 rounded-lg border border-white/10 bg-[#0d121a]/75 px-4 py-3 ${className}`}
    >
      <span className="flex h-8 w-8 items-center justify-center rounded-md border border-sky-300/20 bg-sky-300/[0.08] text-sky-100">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-white/40">
          {label}
        </p>
        <p className="mt-0.5 truncate text-sm font-semibold text-white/85">
          {value}
        </p>
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex h-52 flex-col items-center justify-center text-center text-white/45">
      <LoaderCircle
        className="mb-3 h-6 w-6 animate-spin text-sky-200"
        aria-hidden="true"
      />
      <p className="text-sm">Scanning the NoLoader extensions folder</p>
      <p className="mt-1 text-xs text-white/30">
        Checking manifests and starting enabled extensions
      </p>
    </div>
  );
}

function EmptyState({
  onOpen,
  directory,
}: {
  onOpen(): void;
  directory: string;
}) {
  return (
    <div className="flex min-h-[250px] flex-col items-center justify-center px-6 py-8 text-center">
      <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] text-white/40">
        <Blocks className="h-6 w-6" aria-hidden="true" />
      </span>
      <h3 className="text-sm font-semibold text-white/85">
        No extensions installed
      </h3>
      <p className="mt-2 max-w-sm text-xs leading-5 text-white/45">
        Place an unpacked extension folder containing{" "}
        <code className="rounded bg-white/[0.06] px-1 py-0.5 text-white/65">
          noloader.mod.json
        </code>{" "}
        in the NoLoader folder, then refresh.
      </p>
      <button
        type="button"
        onClick={() => void onOpen()}
        disabled={!directory}
        className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-md border border-sky-300/25 bg-sky-300/[0.07] px-3 text-xs font-medium text-sky-100 hover:bg-sky-300/[0.12] focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-300 disabled:opacity-40"
      >
        <FolderOpen className="h-4 w-4" aria-hidden="true" />
        Open extensions folder
      </button>
    </div>
  );
}

function ModListItem({
  mod,
  selected,
  onSelect,
}: {
  mod: NoLoaderMod;
  selected: boolean;
  onSelect(): void;
}) {
  const presentation = statePresentation[mod.state];
  const StatusIcon = presentation.icon;
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className={`w-full rounded-md border px-3.5 py-3 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-300 ${selected ? "border-sky-300/30 bg-sky-300/[0.08]" : "border-transparent hover:border-white/10 hover:bg-white/[0.035]"}`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white/90">
              {mod.manifest?.name ?? mod.directory}
            </p>
            <p className="mt-0.5 truncate text-xs text-white/40">
              {mod.manifest
                ? `${mod.manifest.id} · ${mod.manifest.version}`
                : "Manifest could not be read"}
            </p>
          </div>
          <span
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-medium ${presentation.className}`}
          >
            <StatusIcon
              className={`h-3 w-3 ${mod.state === "loading" ? "animate-spin" : ""}`}
              aria-hidden="true"
            />
            {presentation.label}
          </span>
        </div>
        {mod.detail && mod.state !== "disabled" && (
          <p className="mt-2 line-clamp-2 text-xs leading-4 text-white/45">
            {mod.detail}
          </p>
        )}
      </button>
    </li>
  );
}

function ModDetails({
  mod,
  runningPageCount,
  loadOrder,
  pending,
  canToggle,
  onToggle,
}: {
  mod: NoLoaderMod;
  runningPageCount: number;
  loadOrder?: number;
  pending: boolean;
  canToggle: boolean;
  onToggle(): void;
}) {
  const manifest = mod.manifest;
  const presentation = statePresentation[mod.state];
  const StatusIcon = presentation.icon;
  return (
    <>
      <div className="border-b border-white/[0.08] p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/40">
            Extension details
            </p>
            <h2 className="mt-2 break-words text-xl font-semibold text-white">
              {manifest?.name ?? mod.directory}
            </h2>
            <p className="mt-1 break-all text-xs text-white/45">
              {manifest?.id ?? "Invalid manifest"}
            </p>
          </div>
          <span
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] ${presentation.className}`}
          >
            <StatusIcon className="h-3 w-3" aria-hidden="true" />
            {presentation.label}
          </span>
        </div>
        {manifest?.description && (
          <p className="mt-4 text-sm leading-5 text-white/65">
            {manifest.description}
          </p>
        )}
        {mod.detail && (
          <p
            className={`mt-3 rounded-md border px-3 py-2 text-xs leading-5 ${mod.state === "failed" || mod.state === "invalid" ? "border-red-200/10 bg-red-950/20 text-red-100/75" : "border-white/[0.07] bg-black/15 text-white/50"}`}
          >
            {mod.detail}
          </p>
        )}
        {mod.update && (
          <div className={`mt-3 rounded-md border px-3 py-2 text-xs ${mod.update.state === "available" ? "border-sky-200/20 bg-sky-300/[0.07] text-sky-100" : "border-white/[0.07] bg-black/15 text-white/50"}`}>
            {mod.update.state === "checking" && "Checking for updates…"}
            {mod.update.state === "current" && "Extension is up to date."}
            {mod.update.state === "error" && `Update check failed: ${mod.update.detail}`}
            {mod.update.state === "available" && (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>Update available: {mod.update.version}</span>
                <div className="flex gap-3">
                  {mod.update.changelogUrl && <button type="button" className="underline" onClick={() => void openExternalUrl(mod.update!.changelogUrl!)}>Changelog</button>}
                  {mod.update.downloadUrl && <button type="button" className="font-semibold underline" onClick={() => void openExternalUrl(mod.update!.downloadUrl!)}>Download</button>}
                </div>
              </div>
            )}
          </div>
        )}
        <button
          type="button"
          onClick={onToggle}
          disabled={!canToggle || pending}
          className={`mt-4 inline-flex min-h-10 items-center justify-center gap-2 rounded-md border px-3 text-xs font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-300 disabled:cursor-not-allowed disabled:opacity-40 ${mod.enabled ? "border-white/10 bg-white/[0.035] text-white/70 hover:bg-white/[0.07]" : "border-emerald-300/25 bg-emerald-300/[0.08] text-emerald-100 hover:bg-emerald-300/[0.14]"}`}
        >
          {pending ? (
            <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Power className="h-4 w-4" aria-hidden="true" />
          )}
          {mod.enabled
            ? "Disable extension and restart"
            : "Enable extension and restart"}
        </button>
        {!manifest && (
          <p className="mt-2 text-[11px] text-white/35">
            Invalid extensions cannot be enabled until their manifest is corrected.
          </p>
        )}
      </div>
      {manifest && (
        <div className="space-y-5 p-5">
          <section>
            <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/40">
              Runtime
            </h3>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
              <Detail label="API version" value={String(manifest.apiVersion)} />
              <Detail
                label="Launcher support"
                value={manifest.launcherVersions.join(", ")}
              />
              <Detail
                label="Registered pages"
                value={String(runningPageCount)}
              />
              <Detail
                label="Load order"
                value={
                  loadOrder === undefined ? "Not running" : `#${loadOrder}`
                }
              />
            </dl>
          </section>
          <section>
            <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/40">
              Requested capabilities
            </h3>
            {manifest.permissions.length ? (
              <ul className="mt-2 space-y-2">
                {manifest.permissions.map((permission) => (
                  <li
                    key={permission}
                    className="rounded-md border border-white/[0.07] bg-black/15 px-3 py-2"
                  >
                    <p className="text-xs font-medium text-white/75">
                      {permissionLabels[permission]?.label ?? permission}
                    </p>
                    <p className="mt-0.5 text-[11px] leading-4 text-white/40">
                      {permissionLabels[permission]?.description ?? permission}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-xs text-white/40">
                This mod requests no additional capabilities.
              </p>
            )}
          </section>
          <section>
            <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/40">
              Dependencies
            </h3>
            <div className="mt-2 space-y-2">
              {manifest.dependencies.length === 0 &&
              manifest.optionalDependencies.length === 0 ? (
                <p className="text-xs text-white/40">
                  No dependencies declared.
                </p>
              ) : (
                <>
                  {manifest.dependencies.map((dependency) => (
                    <Dependency
                      key={`required:${dependency.id}`}
                      dependency={dependency}
                      required
                    />
                  ))}
                  {manifest.optionalDependencies.map((dependency) => (
                    <Dependency
                      key={`optional:${dependency.id}`}
                      dependency={dependency}
                      required={false}
                    />
                  ))}
                </>
              )}
            </div>
          </section>
          {manifest.conflicts.length > 0 && (
            <section>
              <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/40">
                Conflicts
              </h3>
              <p className="mt-2 text-xs text-white/55">
                {manifest.conflicts.join(", ")}
              </p>
            </section>
          )}
          <section>
            <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/40">
              Package
            </h3>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
              <Detail label="Folder" value={mod.directory} />
              <Detail
                label="Author"
                value={manifest.authors.join(", ") || "Not provided"}
              />
              <Detail
                label="License"
                value={manifest.license ?? "Not provided"}
              />
            </dl>
          </section>
          <p className="flex items-start gap-2 border-t border-white/[0.07] pt-4 text-[11px] leading-4 text-white/35">
            <ShieldAlert
              className="mt-0.5 h-3.5 w-3.5 shrink-0"
              aria-hidden="true"
            />
            Extensions are third-party code. A worker protects the launcher
            UI boundary, but is not an operating-system sandbox.
          </p>
        </div>
      )}
    </>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] text-white/35">{label}</dt>
      <dd className="mt-1 break-words text-white/65">{value}</dd>
    </div>
  );
}

function Dependency({
  dependency,
  required,
}: {
  dependency: { id: string; version: string };
  required: boolean;
}) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 rounded-md border border-white/[0.07] bg-black/10 px-3 py-2">
      <span className="min-w-0 truncate text-xs text-white/65">
        {dependency.id}
      </span>
      <span
        className={`shrink-0 text-[10px] ${required ? "text-white/40" : "text-white/30"}`}
      >
        {required ? "required" : "optional"} · {dependency.version}
      </span>
    </div>
  );
}
