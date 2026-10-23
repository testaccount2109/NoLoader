import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import * as ProfileService from "../services/profile-service";
import { launch as launchProfile } from "../services/process-service";
import {
  parseManifestJson,
  type ModManifest,
  NOLOADER_API_VERSION,
} from "./core/manifest";
import {
  resolveDependencies,
  type ModResolutionState,
} from "./core/dependency-resolver";
import {
  validateModNavigation,
  validateModPage,
  type ModNavigationDescriptor,
  type ModPageDescriptor,
  type ModUiNode,
} from "./core/ui-extension";
import { validateModStyles } from "./core/style-extension";
import {
  isValidModEventName,
  MAX_MOD_EVENT_PUBLISHES_PER_SECOND,
  MAX_MOD_EVENT_SUBSCRIPTIONS,
  serializeModEventPayload,
} from "./core/events";
import {
  startModWorker,
  type ModWorkerHandle,
  type ModWorkerMessage,
} from "./runtime/mod-worker";

const MAX_ACTIVE_MODS = 32;
const MAX_PAGES_PER_MOD = 32;
const MAX_HOME_WIDGETS_PER_MOD = 8;
const MAX_NAVIGATION_ITEMS_PER_MOD = 32;
const MAX_GLOBAL_STYLESHEET_BYTES = 96 * 1024;

export type ModLifecycleState =
  | "discovered"
  | "invalid"
  | "incompatible"
  | "blocked"
  | "conflict"
  | "duplicate-id"
  | "dependency-cycle"
  | "loading"
  | "loaded"
  | "failed"
  | "disabled";

export interface NoLoaderMod {
  directory: string;
  manifest?: ModManifest;
  manifestJson?: string;
  enabled: boolean;
  state: ModLifecycleState;
  detail?: string;
}

export interface RegisteredModPage {
  modId: string;
  page: ModPageDescriptor;
  styles?: string;
}

export interface RegisteredModNavigation {
  modId: string;
  item: ModNavigationDescriptor;
}

export interface RegisteredModHomeWidget {
  modId: string;
  widget: ModPageDescriptor;
  styles?: string;
}

interface NativeModDirectoryEntry {
  directory: string;
  manifestJson: string | null;
  error: string | null;
  enabled: boolean;
}

interface NativeModSnapshot {
  modsDirectory: string;
  entries: NativeModDirectoryEntry[];
  settingsError: string | null;
  safeMode: boolean;
}

interface NativeModAssets {
  manifestJson: string;
  frontendSource: string;
  styles: string | null;
}

interface LastPlayedServer {
  profileId: string;
  address: string;
  playedAt: string;
}

interface NoLoaderContextValue {
  mods: NoLoaderMod[];
  pages: RegisteredModPage[];
  navigation: RegisteredModNavigation[];
  homeWidgets: RegisteredModHomeWidget[];
  modsDirectory: string;
  launcherVersion: string;
  loading: boolean;
  error?: string;
  settingsError?: string;
  safeMode: boolean;
  refresh(): Promise<void>;
  setEnabled(directory: string, enabled: boolean): Promise<void>;
  setSafeMode(enabled: boolean): Promise<void>;
  openModsDirectory(): Promise<void>;
  sendAction(modId: string, action: string): void;
}

interface WorkerRuntime {
  handle: ModWorkerHandle;
  directory: string;
  manifest: ModManifest;
  styles?: string;
  messageTimes: number[];
  hasActionHandler: boolean;
  activated: boolean;
  lastPongAt: number;
  heartbeatNonce?: string;
  heartbeat?: ReturnType<typeof setInterval>;
  allowedLaunchTokens: Map<string, number>;
  subscribedEvents: Set<string>;
  eventPublishTimes: number[];
}

const NoLoaderContext = createContext<NoLoaderContextValue | undefined>(
  undefined,
);

export function NoLoaderProvider({ children }: { children: ReactNode }) {
  const [mods, setMods] = useState<NoLoaderMod[]>([]);
  const [pages, setPages] = useState<RegisteredModPage[]>([]);
  const [navigation, setNavigation] = useState<RegisteredModNavigation[]>([]);
  const [homeWidgets, setHomeWidgets] = useState<RegisteredModHomeWidget[]>([]);
  const [modsDirectory, setModsDirectory] = useState("");
  const [launcherVersion, setLauncherVersion] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [settingsError, setSettingsError] = useState<string>();
  const [safeMode, setSafeModeState] = useState(false);
  const generation = useRef(0);
  const workers = useRef(new Map<string, WorkerRuntime>());
  const runtimeFailures = useRef(new Set<string>());
  const pageRegistry = useRef(new Map<string, RegisteredModPage>());
  const navigationRegistry = useRef(new Map<string, RegisteredModNavigation>());
  const homeWidgetRegistry = useRef(new Map<string, RegisteredModHomeWidget>());
  const globalStyleRegistry = useRef(new Map<string, HTMLStyleElement>());
  const failWorkerRef = useRef<(modId: string, message: string) => void>(
    () => undefined,
  );
  const processWorkerMessageRef = useRef<
    (
      message: ModWorkerMessage,
      runtime: WorkerRuntime,
      currentGeneration: number,
    ) => void
  >(() => undefined);
  const startModRef = useRef<
    (
      record: NoLoaderMod,
      assets: NativeModAssets,
      currentGeneration: number,
    ) => Promise<void>
  >(async () => undefined);

  const registrationKey = (modId: string, id: string) => `${modId}\u0000${id}`;

  const updateMod = useCallback(
    (directory: string, patch: Partial<NoLoaderMod>) => {
      setMods((current) =>
        current.map((mod) =>
          mod.directory === directory ? { ...mod, ...patch } : mod,
        ),
      );
    },
    [],
  );

  const clearRegistrations = useCallback((modId: string) => {
    for (const [key, entry] of pageRegistry.current) {
      if (entry.modId === modId) pageRegistry.current.delete(key);
    }
    for (const [key, entry] of navigationRegistry.current) {
      if (entry.modId === modId) navigationRegistry.current.delete(key);
    }
    for (const [key, entry] of homeWidgetRegistry.current) {
      if (entry.modId === modId) homeWidgetRegistry.current.delete(key);
    }
    globalStyleRegistry.current.get(modId)?.remove();
    globalStyleRegistry.current.delete(modId);
    setPages([...pageRegistry.current.values()]);
    setNavigation([...navigationRegistry.current.values()]);
    setHomeWidgets([...homeWidgetRegistry.current.values()]);
  }, []);

  const stopAllWorkers = useCallback(() => {
    for (const [modId, runtime] of workers.current) {
      if (runtime.heartbeat) clearInterval(runtime.heartbeat);
      runtime.handle.dispose();
      clearRegistrations(modId);
    }
    workers.current.clear();
    runtimeFailures.current.clear();
  }, [clearRegistrations]);

  const stopMod = useCallback(
    (modId: string) => {
      const runtime = workers.current.get(modId);
      if (runtime) {
        if (runtime.heartbeat) clearInterval(runtime.heartbeat);
        runtime.handle.dispose();
        workers.current.delete(modId);
      }
      clearRegistrations(modId);
    },
    [clearRegistrations],
  );

  const refresh = useCallback(async () => {
    const currentGeneration = ++generation.current;
    stopAllWorkers();
    setLoading(true);
    setError(undefined);
    setSettingsError(undefined);
    setPages([]);
    setNavigation([]);
    setHomeWidgets([]);
    pageRegistry.current.clear();
    navigationRegistry.current.clear();
    homeWidgetRegistry.current.clear();
    setMods([]);

    try {
      const [snapshot, runningVersion] = await Promise.all([
        invoke<NativeModSnapshot>("noloader_list_mods"),
        getVersion(),
      ]);
      if (currentGeneration !== generation.current) return;
      setModsDirectory(snapshot.modsDirectory);
      setLauncherVersion(runningVersion);
      setSettingsError(snapshot.settingsError ?? undefined);
      const safeModeActive =
        snapshot.safeMode || Boolean(snapshot.settingsError);
      setSafeModeState(safeModeActive);

      const discovered: NoLoaderMod[] = snapshot.entries.map((entry) => {
        if (entry.error || !entry.manifestJson) {
          return {
            directory: entry.directory,
            enabled: false,
            state: "invalid",
            detail: entry.error ?? "Manifest is missing.",
          };
        }
        const parsed = parseManifestJson(entry.manifestJson);
        if (parsed.ok === false) {
          return {
            directory: entry.directory,
            manifestJson: entry.manifestJson,
            enabled: entry.enabled,
            state: "invalid",
            detail: parsed.issues
              .map(({ path, message }) => `${path}: ${message}`)
              .join("; "),
          };
        }
        return {
          directory: entry.directory,
          manifestJson: entry.manifestJson,
          manifest: parsed.manifest,
          enabled: entry.enabled,
          state: !entry.enabled || safeModeActive ? "disabled" : "discovered",
          ...(!entry.enabled
            ? { detail: "Disabled in NoLoader settings." }
            : safeModeActive
              ? {
                  detail: snapshot.settingsError
                    ? "Settings could not be read safely; NoLoader is not starting extensions."
                    : "Safe mode is active; extensions are not started.",
                }
              : {}),
        };
      });
      setMods(discovered);

      const enabledMods = discovered.filter(
        (mod) => mod.enabled && mod.manifest && !safeModeActive,
      );
      const resolution = resolveDependencies(
        enabledMods.map((mod) => mod.manifest!),
        { apiVersion: NOLOADER_API_VERSION, launcherVersion: runningVersion },
      );
      const resolutionIssues = new Map(
        resolution.issues.map((issue) => [issue.modId, issue]),
      );
      const initialStates = discovered.map((mod) => {
        if (!mod.enabled || !mod.manifest) return mod;
        const status = resolution.statusById.get(mod.manifest.id);
        if (status && status !== "ready") {
          const issue = resolutionIssues.get(mod.manifest.id);
          return {
            ...mod,
            state: status as Exclude<ModResolutionState, "ready">,
            detail: issue?.message ?? "This mod cannot be loaded.",
          };
        }
        return mod;
      });
      const loadOrder = new Map(
        resolution.order.map(({ manifest }, index) => [manifest.id, index]),
      );
      initialStates.sort((left, right) => {
        const leftOrder = left.manifest
          ? (loadOrder.get(left.manifest.id) ?? Number.MAX_SAFE_INTEGER)
          : Number.MAX_SAFE_INTEGER;
        const rightOrder = right.manifest
          ? (loadOrder.get(right.manifest.id) ?? Number.MAX_SAFE_INTEGER)
          : Number.MAX_SAFE_INTEGER;
        if (leftOrder !== rightOrder) return leftOrder - rightOrder;
        return (left.manifest?.name ?? left.directory).localeCompare(
          right.manifest?.name ?? right.directory,
        );
      });
      setMods(initialStates);

      const loadedIds = new Set<string>();
      for (const resolved of resolution.order) {
        if (currentGeneration !== generation.current) return;
        const record = discovered.find(
          (mod) => mod.manifest?.id === resolved.manifest.id && mod.enabled,
        );
        if (!record?.manifest || !record.manifestJson) continue;
        const missingRuntimeDependency = record.manifest.dependencies.find(
          (dependency) => !loadedIds.has(dependency.id),
        );
        if (missingRuntimeDependency) {
          updateMod(record.directory, {
            state: "blocked",
            detail: `Required mod "${missingRuntimeDependency.id}" did not finish loading.`,
          });
          continue;
        }
        if (loadedIds.size >= MAX_ACTIVE_MODS) {
          updateMod(record.directory, {
            state: "blocked",
            detail: `NoLoader starts at most ${MAX_ACTIVE_MODS} extensions at a time.`,
          });
          continue;
        }

        updateMod(record.directory, {
          state: "loading",
          detail: "Starting extension worker…",
        });
        try {
          const assets = await invoke<NativeModAssets>(
            "noloader_read_mod_assets",
            {
              directoryName: record.directory,
            },
          );
          if (currentGeneration !== generation.current) return;
          if (assets.manifestJson !== record.manifestJson) {
            throw new Error(
              "The manifest changed after discovery. Refresh NoLoader before loading this mod.",
            );
          }
          if (assets.frontendSource.length > 2 * 1024 * 1024) {
            throw new Error(
              "The JavaScript entry point exceeds the 2 MiB limit.",
            );
          }
          if (assets.styles) {
            const stylesheet = validateModStyles(assets.styles);
            if (stylesheet.ok === false) throw new Error(stylesheet.message);
          }

          await startModRef.current(record, assets, currentGeneration);
          if (currentGeneration !== generation.current) return;
          if (runtimeFailures.current.has(record.manifest.id)) {
            throw new Error("The extension worker stopped during activation.");
          }
          loadedIds.add(record.manifest.id);
          updateMod(record.directory, { state: "loaded", detail: undefined });
          console.info(
            `[NoLoader] Loaded ${record.manifest.id} ${record.manifest.version}`,
          );
        } catch (loadError) {
          if (currentGeneration !== generation.current) return;
          const message = errorMessage(loadError);
          runtimeFailures.current.add(record.manifest.id);
          stopMod(record.manifest.id);
          updateMod(record.directory, { state: "failed", detail: message });
          console.error(
            `[NoLoader] Could not load ${record.manifest.id}: ${message}`,
          );
        }
      }
    } catch (loadError) {
      if (currentGeneration !== generation.current) return;
      setError(errorMessage(loadError));
      console.error(`[NoLoader] Discovery failed: ${errorMessage(loadError)}`);
    } finally {
      if (currentGeneration === generation.current) setLoading(false);
    }
  }, [stopAllWorkers, stopMod, updateMod]);

  const handleExtensionApiRequest = useCallback(
    async (
      message: ModWorkerMessage,
      runtime: WorkerRuntime,
      currentGeneration: number,
    ) => {
      const modId = runtime.manifest.id;
      const requestId = message.requestId;
      const respond = (success: boolean, value?: unknown, error?: string) => {
        if (
          currentGeneration !== generation.current ||
          workers.current.get(modId) !== runtime
        ) {
          return;
        }
        runtime.handle.postMessage({
          type: "api-response",
          requestId,
          success,
          value,
          error,
        });
      };

      if (
        typeof requestId !== "string" ||
        !/^\d{1,12}$/.test(requestId) ||
        typeof message.operation !== "string"
      ) {
        respond(false, undefined, "Malformed NoLoader API request.");
        return;
      }

      try {
        const requirePermission = (permission: ModManifest["permissions"][number]) => {
          if (!runtime.manifest.permissions.includes(permission)) {
            throw new Error(`This extension must request the \`${permission}\` permission.`);
          }
        };
        const requireUserAction = (consume: boolean) => {
          const gestureToken = message.gestureToken;
          const issuedAt =
            typeof gestureToken === "string"
              ? runtime.allowedLaunchTokens.get(gestureToken)
              : undefined;
          if (issuedAt === undefined || Date.now() - issuedAt > 30_000) {
            throw new Error("This launcher API must be called directly from a NoLoader button action.");
          }
          if (consume) runtime.allowedLaunchTokens.delete(gestureToken as string);
        };

        switch (message.operation) {
          case "profiles.list": {
            requirePermission("launcher.profiles.read");
            requireUserAction(false);
            const [response, standard] = await Promise.all([
              ProfileService.getAllProfilesAndLastPlayed(),
              ProfileService.getStandardProfiles(),
            ]);
            const profiles = new Map(
              [...standard.profiles, ...response.all_profiles].map((profile) => [
                profile.id,
                profile,
              ]),
            );
            respond(
              true,
              [...profiles.values()].map((profile) => ({
                id: profile.id,
                name: profile.name,
                gameVersion: profile.game_version,
                loader: profile.loader,
                lastPlayed: profile.last_played,
                isLastPlayed: profile.id === response.last_played_profile_id,
              })),
            );
            return;
          }
          case "servers.getLastPlayed": {
            requirePermission("launcher.lastServer.read");
            requireUserAction(false);
            const server = await invoke<LastPlayedServer | null>(
              "noloader_get_last_played_server",
            );
            respond(true, server);
            return;
          }
          case "launcher.launchProfile": {
            requirePermission("launcher.launch");
            requireUserAction(true);
            if (!message.payload || typeof message.payload !== "object") {
              throw new Error("Profile launch request must be an object.");
            }
            const payload = message.payload as Record<string, unknown>;
            const profileId = payload.profileId;
            if (typeof profileId !== "string" || profileId.length > 64) {
              throw new Error("Profile launch request has an invalid profile ID.");
            }
            const [response, standard] = await Promise.all([
              ProfileService.getAllProfilesAndLastPlayed(),
              ProfileService.getStandardProfiles(),
            ]);
            const profileExists = [...standard.profiles, ...response.all_profiles].some(
              (profile) => profile.id === profileId,
            );
            if (!profileExists) {
              throw new Error("The requested launcher profile does not exist.");
            }
            let serverAddress: string | undefined;
            if (payload.serverAddress !== undefined) {
              if (
                typeof payload.serverAddress !== "string" ||
                !isValidQuickPlayAddress(payload.serverAddress)
              ) {
                throw new Error("Profile launch request has an invalid server address.");
              }
              serverAddress = payload.serverAddress.trim();
            }
            await launchProfile(profileId, undefined, serverAddress);
            respond(true);
            return;
          }
          case "storage.get": {
            requirePermission("storage.mod");
            const payload = message.payload as Record<string, unknown> | undefined;
            if (typeof payload?.key !== "string") {
              throw new Error("Mod storage read request has an invalid key.");
            }
            const stored = await invoke<{ found: boolean; value: unknown }>(
              "noloader_get_mod_storage",
              { modId, key: payload.key },
            );
            respond(true, stored.found ? stored.value : undefined);
            return;
          }
          case "storage.set": {
            requirePermission("storage.mod");
            const payload = message.payload as Record<string, unknown> | undefined;
            if (!payload || typeof payload.key !== "string" || !("value" in payload)) {
              throw new Error("Mod storage write request is malformed.");
            }
            await invoke("noloader_set_mod_storage", {
              modId,
              key: payload.key,
              value: payload.value,
            });
            respond(true);
            return;
          }
          case "storage.delete": {
            requirePermission("storage.mod");
            const payload = message.payload as Record<string, unknown> | undefined;
            if (typeof payload?.key !== "string") {
              throw new Error("Mod storage delete request has an invalid key.");
            }
            const removed = await invoke<boolean>("noloader_delete_mod_storage", {
              modId,
              key: payload.key,
            });
            respond(true, removed);
            return;
          }
          case "events.publish": {
            requirePermission("events.publish");
            const payload = message.payload as Record<string, unknown> | undefined;
            if (!payload || !isValidModEventName(payload.eventName, modId)) {
              throw new Error("Published events must use this extension's namespace.");
            }
            if (serializeModEventPayload(payload.value) === undefined) {
              throw new Error("Mod event payloads must be JSON data no larger than 16 KiB.");
            }
            const now = Date.now();
            runtime.eventPublishTimes = runtime.eventPublishTimes.filter(
              (time) => now - time < 1000,
            );
            if (runtime.eventPublishTimes.length >= MAX_MOD_EVENT_PUBLISHES_PER_SECOND) {
              throw new Error("An extension may publish at most 10 events per second.");
            }
            runtime.eventPublishTimes.push(now);
            let deliveries = 0;
            for (const target of workers.current.values()) {
              if (!target.activated || !target.subscribedEvents.has(payload.eventName)) continue;
              target.handle.postMessage({
                type: "extension-event",
                eventName: payload.eventName,
                source: modId,
                value: payload.value,
              });
              deliveries += 1;
            }
            respond(true, deliveries);
            return;
          }
          default:
            throw new Error(`Unsupported NoLoader API operation \"${message.operation}\".`);
        }
      } catch (error) {
        respond(
          false,
          undefined,
          error instanceof Error ? error.message : String(error),
        );
      }
    },
    [],
  );

  const processWorkerMessage = useCallback(
    (
      message: ModWorkerMessage,
      runtime: WorkerRuntime,
      currentGeneration: number,
    ) => {
      if (currentGeneration !== generation.current) return;
      const modId = runtime.manifest.id;
      if (
        !message ||
        message.modId !== modId ||
        typeof message.type !== "string"
      ) {
        failWorkerRef.current(
          modId,
          "Worker sent an invalid message envelope.",
        );
        return;
      }
      const now = Date.now();
      runtime.messageTimes = runtime.messageTimes.filter(
        (time) => now - time < 1000,
      );
      if (runtime.messageTimes.length >= 100) {
        failWorkerRef.current(
          modId,
          "Worker exceeded the limit of 100 API messages per second.",
        );
        return;
      }
      runtime.messageTimes.push(now);
      let serialized: string;
      try {
        serialized = JSON.stringify(message);
      } catch {
        failWorkerRef.current(
          modId,
          "Worker sent a non-serializable API message.",
        );
        return;
      }
      if (serialized.length > 128 * 1024) {
        failWorkerRef.current(
          modId,
          "Worker API messages are limited to 128 KiB.",
        );
        return;
      }

      if (message.type === "error") {
        failWorkerRef.current(
          modId,
          typeof message.message === "string"
            ? message.message.slice(0, 1000)
            : "Extension activation failed.",
        );
        return;
      }
      if (message.type === "action-handler") {
        if (typeof message.enabled !== "boolean") {
          failWorkerRef.current(
            modId,
            "Action handler registration is malformed.",
          );
          return;
        }
        runtime.hasActionHandler = message.enabled;
        const hasButtons = [...pageRegistry.current.values()].some(
          (entry) =>
            entry.modId === modId && pageContainsActionButton(entry.page),
        ) || [...homeWidgetRegistry.current.values()].some(
          (entry) =>
            entry.modId === modId && pageContainsActionButton(entry.widget),
        );
        if (runtime.activated && hasButtons && !runtime.hasActionHandler) {
          failWorkerRef.current(
            modId,
            "A page with buttons must keep an `api.onAction` handler registered.",
          );
        }
        return;
      }
      if (message.type === "ready") {
        const hasButtons = [...pageRegistry.current.values()].some(
          (entry) =>
            entry.modId === modId && pageContainsActionButton(entry.page),
        ) || [...homeWidgetRegistry.current.values()].some(
          (entry) =>
            entry.modId === modId && pageContainsActionButton(entry.widget),
        );
        if (hasButtons && !runtime.hasActionHandler) {
          failWorkerRef.current(
            modId,
            "A page with buttons must register an `api.onAction` handler during activation.",
          );
          return;
        }
        runtime.activated = true;
        return;
      }
      if (message.type === "api-request") {
        void handleExtensionApiRequest(message, runtime, currentGeneration);
        return;
      }
      if (message.type === "subscribe-event" || message.type === "unsubscribe-event") {
        if (!runtime.manifest.permissions.includes("events.subscribe")) {
          failWorkerRef.current(
            modId,
            "The extension called the events API without requesting `events.subscribe`.",
          );
          return;
        }
        if (!isValidModEventName(message.eventName)) {
          failWorkerRef.current(modId, "The extension subscribed to an invalid event name.");
          return;
        }
        if (message.type === "subscribe-event") {
          if (
            !runtime.subscribedEvents.has(message.eventName) &&
            runtime.subscribedEvents.size >= MAX_MOD_EVENT_SUBSCRIPTIONS
          ) {
            failWorkerRef.current(
              modId,
              `An extension may subscribe to at most ${MAX_MOD_EVENT_SUBSCRIPTIONS} events.`,
            );
            return;
          }
          runtime.subscribedEvents.add(message.eventName);
        } else {
          runtime.subscribedEvents.delete(message.eventName);
        }
        return;
      }

      if (message.type === "register-home-widget") {
        if (!runtime.manifest.permissions.includes("ui.home")) {
          failWorkerRef.current(
            modId,
            "The extension called the home-widget API without requesting `ui.home`.",
          );
          return;
        }
        const parsed = validateModPage(message.widget);
        if (parsed.ok === false) {
          failWorkerRef.current(modId, parsed.message);
          return;
        }
        if (
          runtime.activated &&
          pageContainsActionButton(parsed.value) &&
          !runtime.hasActionHandler
        ) {
          failWorkerRef.current(
            modId,
            "A home widget with buttons must keep an `api.onAction` handler registered.",
          );
          return;
        }
        const key = registrationKey(modId, parsed.value.id);
        if (homeWidgetRegistry.current.has(key)) {
          failWorkerRef.current(
            modId,
            `Home widget \"${parsed.value.id}\" is already registered.`,
          );
          return;
        }
        const widgetsForMod = [...homeWidgetRegistry.current.values()].filter(
          (entry) => entry.modId === modId,
        ).length;
        if (widgetsForMod >= MAX_HOME_WIDGETS_PER_MOD) {
          failWorkerRef.current(
            modId,
            `An extension may register at most ${MAX_HOME_WIDGETS_PER_MOD} home widgets.`,
          );
          return;
        }
        homeWidgetRegistry.current.set(key, {
          modId,
          widget: parsed.value,
          styles: runtime.styles,
        });
        setHomeWidgets([...homeWidgetRegistry.current.values()]);
        return;
      }
      if (message.type === "update-home-widget") {
        if (!runtime.manifest.permissions.includes("ui.home")) {
          failWorkerRef.current(
            modId,
            "The extension called the home-widget API without requesting `ui.home`.",
          );
          return;
        }
        if (typeof message.widgetId !== "string") {
          failWorkerRef.current(modId, "Home-widget update is missing its ID.");
          return;
        }
        const parsed = validateModPage(message.widget);
        if (parsed.ok === false) {
          failWorkerRef.current(modId, parsed.message);
          return;
        }
        if (parsed.value.id !== message.widgetId) {
          failWorkerRef.current(
            modId,
            "Updated home-widget ID does not match the target widget.",
          );
          return;
        }
        if (
          runtime.activated &&
          pageContainsActionButton(parsed.value) &&
          !runtime.hasActionHandler
        ) {
          failWorkerRef.current(
            modId,
            "A home widget with buttons must keep an `api.onAction` handler registered.",
          );
          return;
        }
        const key = registrationKey(modId, message.widgetId);
        const existing = homeWidgetRegistry.current.get(key);
        if (!existing) {
          failWorkerRef.current(
            modId,
            `Home widget \"${message.widgetId}\" is not registered.`,
          );
          return;
        }
        homeWidgetRegistry.current.set(key, { ...existing, widget: parsed.value });
        setHomeWidgets([...homeWidgetRegistry.current.values()]);
        return;
      }
      if (message.type === "unregister-home-widget") {
        if (typeof message.widgetId !== "string") return;
        homeWidgetRegistry.current.delete(
          registrationKey(modId, message.widgetId),
        );
        setHomeWidgets([...homeWidgetRegistry.current.values()]);
        return;
      }
      if (message.type === "register-global-styles") {
        if (!runtime.manifest.permissions.includes("ui.globalStyles")) {
          failWorkerRef.current(
            modId,
            "The extension called the global-styles API without requesting `ui.globalStyles`.",
          );
          return;
        }
        if (globalStyleRegistry.current.has(modId)) {
          failWorkerRef.current(modId, "Global styles are already registered.");
          return;
        }
        const parsed = validateGlobalStyles(message.styles);
        if (parsed.ok === false) {
          failWorkerRef.current(modId, parsed.message);
          return;
        }
        const styleElement = document.createElement("style");
        styleElement.dataset.noloaderMod = modId;
        styleElement.textContent = parsed.css;
        document.head.append(styleElement);
        globalStyleRegistry.current.set(modId, styleElement);
        return;
      }
      if (message.type === "update-global-styles") {
        if (!runtime.manifest.permissions.includes("ui.globalStyles")) {
          failWorkerRef.current(
            modId,
            "The extension called the global-styles API without requesting `ui.globalStyles`.",
          );
          return;
        }
        const styleElement = globalStyleRegistry.current.get(modId);
        if (!styleElement) {
          failWorkerRef.current(modId, "Global styles are not registered.");
          return;
        }
        const parsed = validateGlobalStyles(message.styles);
        if (parsed.ok === false) {
          failWorkerRef.current(modId, parsed.message);
          return;
        }
        styleElement.textContent = parsed.css;
        return;
      }
      if (message.type === "unregister-global-styles") {
        globalStyleRegistry.current.get(modId)?.remove();
        globalStyleRegistry.current.delete(modId);
        return;
      }

      if (message.type === "register-page") {
        if (!runtime.manifest.permissions.includes("ui.pages")) {
          failWorkerRef.current(
            modId,
            "The extension called the pages API without requesting `ui.pages`.",
          );
          return;
        }
        const parsed = validateModPage(message.page);
        if (parsed.ok === false) {
          failWorkerRef.current(modId, parsed.message);
          return;
        }
        if (
          runtime.activated &&
          pageContainsActionButton(parsed.value) &&
          !runtime.hasActionHandler
        ) {
          failWorkerRef.current(
            modId,
            "A page with buttons must keep an `api.onAction` handler registered.",
          );
          return;
        }
        const key = registrationKey(modId, parsed.value.id);
        if (pageRegistry.current.has(key)) {
          failWorkerRef.current(
            modId,
            `Page "${parsed.value.id}" is already registered.`,
          );
          return;
        }
        const pagesForMod = [...pageRegistry.current.values()].filter(
          (entry) => entry.modId === modId,
        ).length;
        if (pagesForMod >= MAX_PAGES_PER_MOD) {
          failWorkerRef.current(
            modId,
            `An extension may register at most ${MAX_PAGES_PER_MOD} pages.`,
          );
          return;
        }
        pageRegistry.current.set(key, {
          modId,
          page: parsed.value,
          styles: runtime.styles,
        });
        setPages([...pageRegistry.current.values()]);
        return;
      }
      if (message.type === "update-page") {
        if (!runtime.manifest.permissions.includes("ui.pages")) {
          failWorkerRef.current(
            modId,
            "The extension called the pages API without requesting `ui.pages`.",
          );
          return;
        }
        if (typeof message.pageId !== "string") {
          failWorkerRef.current(modId, "Page update is missing its page ID.");
          return;
        }
        const parsed = validateModPage(message.content);
        if (parsed.ok === false) {
          failWorkerRef.current(modId, parsed.message);
          return;
        }
        if (parsed.value.id !== message.pageId) {
          failWorkerRef.current(
            modId,
            "Updated page ID does not match the target page.",
          );
          return;
        }
        if (
          runtime.activated &&
          pageContainsActionButton(parsed.value) &&
          !runtime.hasActionHandler
        ) {
          failWorkerRef.current(
            modId,
            "A page with buttons must keep an `api.onAction` handler registered.",
          );
          return;
        }
        const key = registrationKey(modId, message.pageId);
        const existing = pageRegistry.current.get(key);
        if (!existing) {
          failWorkerRef.current(
            modId,
            `Page "${message.pageId}" is not registered.`,
          );
          return;
        }
        pageRegistry.current.set(key, { ...existing, page: parsed.value });
        setPages([...pageRegistry.current.values()]);
        return;
      }
      if (message.type === "unregister-page") {
        if (typeof message.pageId !== "string") return;
        pageRegistry.current.delete(registrationKey(modId, message.pageId));
        for (const [key, entry] of navigationRegistry.current) {
          if (entry.modId === modId && entry.item.pageId === message.pageId)
            navigationRegistry.current.delete(key);
        }
        setPages([...pageRegistry.current.values()]);
        setNavigation([...navigationRegistry.current.values()]);
        return;
      }
      if (message.type === "register-navigation") {
        if (!runtime.manifest.permissions.includes("ui.navigation")) {
          failWorkerRef.current(
            modId,
            "The extension called the navigation API without requesting `ui.navigation`.",
          );
          return;
        }
        const parsed = validateModNavigation(message.item);
        if (parsed.ok === false) {
          failWorkerRef.current(modId, parsed.message);
          return;
        }
        if (
          !pageRegistry.current.has(registrationKey(modId, parsed.value.pageId))
        ) {
          failWorkerRef.current(
            modId,
            `Navigation item "${parsed.value.id}" refers to an unregistered page.`,
          );
          return;
        }
        const key = registrationKey(modId, parsed.value.id);
        if (navigationRegistry.current.has(key)) {
          failWorkerRef.current(
            modId,
            `Navigation item "${parsed.value.id}" is already registered.`,
          );
          return;
        }
        const navigationForMod = [
          ...navigationRegistry.current.values(),
        ].filter((entry) => entry.modId === modId).length;
        if (navigationForMod >= MAX_NAVIGATION_ITEMS_PER_MOD) {
          failWorkerRef.current(
            modId,
            `An extension may register at most ${MAX_NAVIGATION_ITEMS_PER_MOD} navigation items.`,
          );
          return;
        }
        navigationRegistry.current.set(key, { modId, item: parsed.value });
        setNavigation([...navigationRegistry.current.values()]);
        return;
      }
      if (message.type === "unregister-navigation") {
        if (typeof message.itemId !== "string") return;
        navigationRegistry.current.delete(
          registrationKey(modId, message.itemId),
        );
        setNavigation([...navigationRegistry.current.values()]);
        return;
      }
      failWorkerRef.current(
        modId,
        `Unsupported worker message "${message.type}".`,
      );
    },
    [handleExtensionApiRequest],
  );

  const failWorker = useCallback(
    (modId: string, message: string) => {
      if (runtimeFailures.current.has(modId)) return;
      runtimeFailures.current.add(modId);
      const runtime = workers.current.get(modId);
      if (runtime) {
        if (runtime.heartbeat) clearInterval(runtime.heartbeat);
        runtime.handle.terminate();
        workers.current.delete(modId);
      }
      clearRegistrations(modId);
      const modDirectory = runtime?.directory;
      if (modDirectory)
        updateMod(modDirectory, { state: "failed", detail: message });
      console.error(`[NoLoader] ${modId} failed: ${message}`);
    },
    [clearRegistrations, updateMod],
  );
  failWorkerRef.current = failWorker;

  const startMod = useCallback(
    async (
      record: NoLoaderMod,
      assets: NativeModAssets,
      currentGeneration: number,
    ) => {
      if (!record.manifest)
        throw new Error("Mod manifest disappeared before activation.");
      const runtime: WorkerRuntime = {
        handle: undefined as unknown as ModWorkerHandle,
        directory: record.directory,
        manifest: record.manifest,
        styles: assets.styles ?? undefined,
        messageTimes: [],
        hasActionHandler: false,
        activated: false,
        lastPongAt: Date.now(),
        allowedLaunchTokens: new Map(),
        subscribedEvents: new Set(),
        eventPublishTimes: [],
      };
      let rejectReady: ((error: Error) => void) | undefined;
      let resolveReady: (() => void) | undefined;
      let settled = false;
      const ready = new Promise<void>((resolve, reject) => {
        resolveReady = resolve;
        rejectReady = reject;
      });
      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          rejectReady?.(
            new Error("Extension did not finish activation within 10 seconds."),
          );
        }
      }, 10_000);

      try {
        const handle = startModWorker(
          record.manifest.id,
          assets.frontendSource,
          (message) => {
            if (
              message.type === "pong" &&
              typeof message.nonce === "string" &&
              message.nonce === runtime.heartbeatNonce
            ) {
              runtime.lastPongAt = Date.now();
              return;
            }
            processWorkerMessageRef.current(
              message,
              runtime,
              currentGeneration,
            );
            if (message.type === "ready" && !settled) {
              settled = true;
              resolveReady?.();
            } else if (message.type === "error" && !settled) {
              settled = true;
              rejectReady?.(
                new Error(
                  typeof message.message === "string"
                    ? message.message
                    : "Extension activation failed.",
                ),
              );
            }
          },
          (message) => {
            failWorkerRef.current(record.manifest!.id, message);
            if (!settled) {
              settled = true;
              rejectReady?.(new Error(message));
            }
          },
        );
        runtime.handle = handle;
        workers.current.set(record.manifest.id, runtime);
        await ready;
        if (currentGeneration !== generation.current) {
          if (runtime.heartbeat) clearInterval(runtime.heartbeat);
          handle.dispose();
          workers.current.delete(record.manifest.id);
          return;
        }
        if (runtimeFailures.current.has(record.manifest.id)) {
          throw new Error("The extension reported an error during activation.");
        }
        runtime.heartbeat = setInterval(() => {
          if (Date.now() - runtime.lastPongAt > 15_000) {
            if (runtime.heartbeat) clearInterval(runtime.heartbeat);
            runtime.heartbeat = undefined;
            failWorkerRef.current(
              record.manifest!.id,
              "Extension worker stopped responding to health checks.",
            );
            return;
          }
          const nonce = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
          runtime.heartbeatNonce = nonce;
          runtime.handle.postMessage({ type: "ping", nonce });
        }, 5_000);
      } finally {
        clearTimeout(timeout);
      }
    },
    [],
  );
  processWorkerMessageRef.current = processWorkerMessage;
  startModRef.current = startMod;

  const setEnabled = useCallback(
    async (directory: string, enabled: boolean) => {
      await invoke("noloader_set_mod_enabled", {
        directoryName: directory,
        enabled,
      });
      await refresh();
    },
    [refresh],
  );

  const setSafeMode = useCallback(
    async (enabled: boolean) => {
      await invoke("noloader_set_safe_mode", { enabled });
      await refresh();
    },
    [refresh],
  );

  const openModsDirectory = useCallback(async () => {
    if (!modsDirectory)
      throw new Error("The NoLoader mods folder is not available yet.");
    const { openPath } = await import("@tauri-apps/plugin-opener");
    await openPath(modsDirectory);
  }, [modsDirectory]);

  const sendAction = useCallback((modId: string, action: string) => {
    const runtime = workers.current.get(modId);
    if (!runtime || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(action)) return;
    const now = Date.now();
    for (const [token, issuedAt] of runtime.allowedLaunchTokens) {
      if (now - issuedAt > 30_000) runtime.allowedLaunchTokens.delete(token);
    }
    while (runtime.allowedLaunchTokens.size >= 128) {
      const oldest = runtime.allowedLaunchTokens.keys().next().value;
      if (oldest === undefined) break;
      runtime.allowedLaunchTokens.delete(oldest);
    }
    const gestureToken = crypto.randomUUID();
    runtime.allowedLaunchTokens.set(gestureToken, now);
    runtime.handle.postMessage({ type: "action", action, gestureToken });
  }, []);

  useEffect(() => {
    void refresh();
    return () => {
      generation.current += 1;
      stopAllWorkers();
    };
  }, [refresh, stopAllWorkers]);

  const value = useMemo<NoLoaderContextValue>(
    () => ({
      mods,
      pages,
      navigation,
      homeWidgets,
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
      sendAction,
    }),
    [
      mods,
      pages,
      navigation,
      homeWidgets,
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
      sendAction,
    ],
  );

  return (
    <NoLoaderContext.Provider value={value}>
      {children}
    </NoLoaderContext.Provider>
  );
}

export function useNoLoader(): NoLoaderContextValue {
  const context = useContext(NoLoaderContext);
  if (!context)
    throw new Error("useNoLoader must be used inside NoLoaderProvider.");
  return context;
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (
    /cannot read properties of undefined \(reading ['"]invoke['"]\)/i.test(
      message,
    )
  ) {
    return "The NoLoader native bridge is available only inside the NoRisk Launcher desktop app.";
  }
  return message;
}

function pageContainsActionButton(page: ModPageDescriptor): boolean {
  const containsButton = (node: ModUiNode): boolean => {
    if (node.type === "button") return true;
    if (node.type === "stack" || node.type === "card") {
      return node.children.some(containsButton);
    }
    return false;
  };
  return page.content.some(containsButton);
}

function isValidQuickPlayAddress(value: string): boolean {
  const address = value.trim();
  if (
    address.length === 0 ||
    address.length > 255 ||
    /[\s\u0000-\u001f\u007f]/.test(address)
  ) {
    return false;
  }

  let host = address;
  let port: string | undefined;
  if (address.startsWith("[")) {
    const match = /^\[([0-9a-f:.]+)\](?::([0-9]{1,5}))?$/i.exec(address);
    if (!match) return false;
    host = match[1];
    port = match[2];
  } else {
    const firstColon = address.indexOf(":");
    const lastColon = address.lastIndexOf(":");
    if (firstColon !== lastColon) {
      return /^[0-9a-f:.]+$/i.test(address);
    }
    if (lastColon >= 0) {
      host = address.slice(0, lastColon);
      port = address.slice(lastColon + 1);
    }
    if (!/^[a-z0-9._-]+$/i.test(host)) return false;
  }

  if (host.length === 0) return false;
  if (port === undefined) return true;
  const parsedPort = Number(port);
  return /^\d{1,5}$/.test(port) && parsedPort > 0 && parsedPort <= 65535;
}

function validateGlobalStyles(value: unknown):
  | { ok: true; css: string }
  | { ok: false; message: string } {
  if (typeof value !== "string") {
    return { ok: false, message: "Global stylesheet must be text." };
  }
  if (new TextEncoder().encode(value).byteLength > MAX_GLOBAL_STYLESHEET_BYTES) {
    return {
      ok: false,
      message: `Global stylesheet exceeds the ${MAX_GLOBAL_STYLESHEET_BYTES}-byte limit.`,
    };
  }
  return validateModStyles(value);
}
