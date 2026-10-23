export type ModId = string;

export type ModUiNode =
  | { type: "text"; text: string }
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "button"; id: string; label: string; action: string }
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
  onAction(callback: (action: string) => void | Promise<void>): () => void;
  profiles: {
    list(): Promise<LauncherProfile[]>;
  };
  servers: {
    getLastPlayed(): Promise<LastPlayedServer | null>;
  };
  launcher: {
    launchProfile(request: LaunchProfileRequest): Promise<void>;
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
