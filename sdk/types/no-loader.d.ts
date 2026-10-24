export type ModId = string;

export type ModFeatureId =
  | "curseforge.integration"
  | "launcher.news"
  | "launcher.effects"
  | "launcher.ads";

export interface LauncherPerformanceSnapshot {
  activeMods: number;
  apiCallsLastMinute: number;
  averageApiLatencyMs: number;
  maxApiLatencyMs: number;
}

export type ModActionValue = string | number | boolean;

export type ModUiNode =
  | { type: "text"; text: string }
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "button"; id: string; label: string; action: string }
  | { type: "toggle"; id: string; label: string; checked: boolean; action: string; disabled?: boolean }
  | { type: "input"; id: string; label: string; value: string; action: string; placeholder?: string; maxLength?: number; disabled?: boolean }
  | { type: "select"; id: string; label: string; value: string; options: Array<{ label: string; value: string }>; action: string; disabled?: boolean }
  | { type: "progress"; value: number; label?: string }
  | { type: "stack"; direction: "row" | "column"; children: ModUiNode[] }
  | { type: "card"; title?: string; children: ModUiNode[] };

export interface ModPage {
  id: string;
  title: string;
  content: ModUiNode[];
}

export interface ModHomeWidget {
  id: string;
  title: string;
  content: ModUiNode[];
  position?: "before-play" | "after-play";
}

export interface ModNavigationItem {
  id: string;
  label: string;
  pageId: string;
  icon?: "puzzle" | "sparkles" | "info";
}

export interface LauncherProfile {
  id: string;
  name: string;
  gameVersion: string;
  loader: string;
  lastPlayed: string | null;
  isLastPlayed: boolean;
}

export interface LastPlayedServer {
  profileId: string;
  address: string;
  playedAt: string;
}

export interface ModUpdateCheck {
  id: string;
  version: string;
  available: boolean;
  downloadUrl?: string;
  changelogUrl?: string;
}

export interface ModHttpRequest {
  url: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: Record<string, string>;
  body?: string;
}

export interface ModHttpResponse {
  status: number;
  ok: boolean;
  contentType: string | null;
  body: string;
}

export interface ModNotification {
  title: string;
  body?: string;
  kind?: "info" | "success" | "error";
}

export interface ModFileEntry {
  name: string;
  path: string;
  kind: "file" | "directory" | "other";
  size: number;
}

export interface ModWindowOptions {
  id: string;
  title: string;
  pageId: string;
  width?: number;
  height?: number;
}

export interface ModProcessRequest {
  program: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
}

export interface ModProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface LaunchProfileRequest {
  profileId: string;
  serverAddress?: string;
}

export type ModJsonValue =
  | null
  | boolean
  | number
  | string
  | ModJsonValue[]
  | { [key: string]: ModJsonValue };

export interface ModEventMetadata {
  name: string;
  source: string;
}

export interface NoLoaderApi {
  registerPage(page: ModPage): () => void;
  updatePage(pageId: string, page: ModPage): void;
  registerHomeWidget(widget: ModHomeWidget): () => void;
  updateHomeWidget(widgetId: string, widget: ModHomeWidget): void;
  registerNavigationItem(item: ModNavigationItem): () => void;
  registerGlobalStyles(styles: string): () => void;
  updateGlobalStyles(styles: string): void;
  onAction(callback: (action: string, value?: ModActionValue) => void | Promise<void>): () => void;
  profiles: {
    list(): Promise<LauncherProfile[]>;
  };
  servers: {
    getLastPlayed(): Promise<LastPlayedServer | null>;
  };
  launcher: {
    launchProfile(request: LaunchProfileRequest): Promise<void>;
    openExternal(url: string): Promise<void>;
  };
  notifications: {
    show(notification: ModNotification): Promise<void>;
  };
  clipboard: {
    readText(): Promise<string>;
    writeText(text: string): Promise<void>;
  };
  dialogs: {
    openFile(options?: { multiple?: boolean; filters?: Array<{ name: string; extensions: string[] }> }): Promise<string | string[] | null>;
    openDirectory(): Promise<string | null>;
    saveFile(options?: { defaultPath?: string; filters?: Array<{ name: string; extensions: string[] }> }): Promise<string | null>;
    confirm(title: string, message: string): Promise<boolean>;
  };
  windows: {
    openPage(options: ModWindowOptions): Promise<string>;
    close(id: string): Promise<void>;
  };
  system: {
    files: {
      readText(path: string): Promise<string>;
      writeText(path: string, content: string): Promise<void>;
      readBinary(path: string): Promise<string>;
      writeBinary(path: string, base64: string): Promise<void>;
      listDirectory(path: string): Promise<ModFileEntry[]>;
      createDirectory(path: string, recursive?: boolean): Promise<void>;
      remove(path: string, recursive?: boolean): Promise<void>;
      copy(source: string, destination: string): Promise<void>;
      move(source: string, destination: string): Promise<void>;
      exists(path: string): Promise<boolean>;
    };
    process: {
      run(request: ModProcessRequest): Promise<ModProcessResult>;
      open(path: string): Promise<void>;
    };
  };
  updates: {
    check(): Promise<ModUpdateCheck | null>;
  };
  network: {
    request(request: ModHttpRequest): Promise<ModHttpResponse>;
  };
  features: {
    setEnabled(featureId: ModFeatureId, enabled: boolean): void;
    getSnapshot(): Promise<Record<ModFeatureId, boolean>>;
  };
  performance: {
    getSnapshot(): Promise<LauncherPerformanceSnapshot>;
  };
  storage: {
    get<T extends ModJsonValue>(key: string): Promise<T | undefined>;
    set<T extends ModJsonValue>(key: string, value: T): Promise<void>;
    delete(key: string): Promise<boolean>;
  };
  events: {
    on<T extends ModJsonValue>(
      eventName: string,
      callback: (value: T, metadata: ModEventMetadata) => void | Promise<void>,
    ): () => void;
    emit<T extends ModJsonValue>(eventName: string, value: T): Promise<number>;
  };
  theme: {
    registerGlobalStyles(styles: string): () => void;
    updateGlobalStyles(styles: string): void;
  };
}

export type NoLoaderActivation =
  | void
  | (() => void | Promise<void>)
  | Promise<void | (() => void | Promise<void>)>;

export declare function activate(api: NoLoaderApi): NoLoaderActivation;
