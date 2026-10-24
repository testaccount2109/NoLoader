export interface ModWorkerMessage {
  type: string;
  [key: string]: unknown;
}

export interface ModWorkerHandle {
  postMessage(message: ModWorkerMessage): void;
  dispose(): void;
  terminate(): void;
}

export function createModWorkerBootstrap(modId: string, source: string): string {
  return `
const modId = ${JSON.stringify(modId)};
const extensionSource = ${JSON.stringify(source)};
let controlPort;
let sendToHost;
let closeControlPort;
let actionHandler;
let removeActionHandler;
let activationCleanup;
let disposed = false;
let connected = false;
let nextApiRequestId = 0;
let activeUserActionToken;
const pendingApiRequests = new Map();
const registrations = new Set();
const eventHandlers = new Map();
const addRegistration = registrations.add.bind(registrations);
const deleteRegistration = registrations.delete.bind(registrations);
const registeredRemovals = registrations.values.bind(registrations);
const createObjectUrl = URL.createObjectURL.bind(URL);
const revokeObjectUrl = URL.revokeObjectURL.bind(URL);
const closeWorker = self.close.bind(self);

function send(message) {
  if (sendToHost) sendToHost({ ...message, modId });
}

function trackRegistration(remove) {
  let active = true;
  const unregister = () => {
    if (!active) return;
    active = false;
    deleteRegistration(unregister);
    remove();
  };
  addRegistration(unregister);
  return unregister;
}

function requestApi(operation, payload) {
  if (disposed) return Promise.reject(new Error("The extension worker is shutting down."));
  if (pendingApiRequests.size >= 32) return Promise.reject(new Error("The extension has too many pending API requests."));
  const requestId = String(++nextApiRequestId);
  return new Promise((resolve, reject) => {
    pendingApiRequests.set(requestId, { resolve, reject });
    send({ type: "api-request", requestId, operation, payload, gestureToken: activeUserActionToken });
  });
}

const api = Object.freeze({
  registerPage(page) {
    send({ type: "register-page", page });
    return trackRegistration(() => send({ type: "unregister-page", pageId: page?.id }));
  },
  updatePage(pageId, content) {
    send({ type: "update-page", pageId, content });
  },
  registerNavigationItem(item) {
    send({ type: "register-navigation", item });
    return trackRegistration(() => send({ type: "unregister-navigation", itemId: item?.id }));
  },
  registerHomeWidget(widget) {
    send({ type: "register-home-widget", widget });
    return trackRegistration(() => send({ type: "unregister-home-widget", widgetId: widget?.id }));
  },
  updateHomeWidget(widgetId, widget) {
    send({ type: "update-home-widget", widgetId, widget });
  },
  registerGlobalStyles(styles) {
    send({ type: "register-global-styles", styles });
    return trackRegistration(() => send({ type: "unregister-global-styles" }));
  },
  updateGlobalStyles(styles) {
    send({ type: "update-global-styles", styles });
  },
  theme: Object.freeze({
    registerGlobalStyles(styles) {
      send({ type: "register-global-styles", styles });
      return trackRegistration(() => send({ type: "unregister-global-styles" }));
    },
    updateGlobalStyles(styles) {
      send({ type: "update-global-styles", styles });
    },
  }),
  onAction(callback) {
    if (typeof callback !== "function") throw new TypeError("onAction expects a function.");
    if (removeActionHandler) removeActionHandler();
    actionHandler = callback;
    send({ type: "action-handler", enabled: true });
    const unregister = trackRegistration(() => {
      if (actionHandler !== callback) return;
      actionHandler = undefined;
      removeActionHandler = undefined;
      send({ type: "action-handler", enabled: false });
    });
    removeActionHandler = unregister;
    return unregister;
  },
  profiles: Object.freeze({
    list() { return requestApi("profiles.list"); },
  }),
  servers: Object.freeze({
    getLastPlayed() { return requestApi("servers.getLastPlayed"); },
  }),
  launcher: Object.freeze({
    launchProfile(request) { return requestApi("launcher.launchProfile", request); },
  }),
  gameMods: Object.freeze({
    importFromPicker(profileId) { return requestApi("gameMods.importFromPicker", { profileId }); },
    installBundled(profileId, jarPath) { return requestApi("gameMods.installBundled", { profileId, jarPath }); },
  }),
  updates: Object.freeze({
    check() { return requestApi("updates.check"); },
  }),
  network: Object.freeze({
    request(request) { return requestApi("network.request", request); },
  }),
  features: Object.freeze({
    setEnabled(featureId, enabled) {
      send({ type: "feature-override", featureId, enabled });
    },
    getSnapshot() { return requestApi("features.getSnapshot"); },
  }),
  performance: Object.freeze({
    getSnapshot() { return requestApi("performance.getSnapshot"); },
  }),
  storage: Object.freeze({
    get(key) { return requestApi("storage.get", { key }); },
    set(key, value) { return requestApi("storage.set", { key, value }); },
    delete(key) { return requestApi("storage.delete", { key }); },
  }),
  events: Object.freeze({
    on(eventName, callback) {
      if (typeof callback !== "function") throw new TypeError("events.on expects a function.");
      let handlers = eventHandlers.get(eventName);
      if (!handlers) {
        handlers = new Set();
        eventHandlers.set(eventName, handlers);
        send({ type: "subscribe-event", eventName });
      }
      if (handlers.has(callback)) throw new Error("This event handler is already registered.");
      handlers.add(callback);
      return trackRegistration(() => {
        handlers.delete(callback);
        if (handlers.size === 0) {
          eventHandlers.delete(eventName);
          send({ type: "unsubscribe-event", eventName });
        }
      });
    },
    emit(eventName, value) { return requestApi("events.publish", { eventName, value }); },
  }),
});

async function activateExtension() {
  let moduleUrl;
  try {
    moduleUrl = createObjectUrl(new Blob([extensionSource], { type: "text/javascript" }));
    const extension = await import(moduleUrl);
    if (typeof extension.activate !== "function") {
      throw new Error("Entry point must export function activate(api).");
    }
    const cleanup = await extension.activate(api);
    if (typeof cleanup === "function") activationCleanup = cleanup;
    send({ type: "ready" });
  } catch (error) {
    send({ type: "error", message: String(error?.message ?? error) });
  } finally {
    if (moduleUrl) revokeObjectUrl(moduleUrl);
  }
}

async function handleControlMessage(event) {
  const message = event.data;
  if (message?.type === "api-response" && typeof message.requestId === "string") {
    const pending = pendingApiRequests.get(message.requestId);
    if (!pending) return;
    pendingApiRequests.delete(message.requestId);
    if (message.success === true) pending.resolve(message.value);
    else pending.reject(new Error(String(message.error ?? "NoLoader API request failed.")));
    return;
  }
  if (message?.type === "ping" && typeof message.nonce === "string") {
    send({ type: "pong", nonce: message.nonce });
    return;
  }
  if (message?.type === "action" && typeof actionHandler === "function") {
    const previousActionToken = activeUserActionToken;
    activeUserActionToken = typeof message.gestureToken === "string" ? message.gestureToken : undefined;
    try {
      await actionHandler(message.action, message.value);
    } catch (error) {
      send({ type: "error", message: String(error?.message ?? error) });
    } finally {
      activeUserActionToken = previousActionToken;
    }
    return;
  }
  if (message?.type === "extension-event" && typeof message.eventName === "string") {
    const handlers = eventHandlers.get(message.eventName);
    if (!handlers) return;
    for (const handler of Array.from(handlers)) {
      try {
        await handler(message.value, { name: message.eventName, source: message.source });
      } catch (error) {
        send({ type: "error", message: String(error?.message ?? error) });
        return;
      }
    }
    return;
  }
  if (message?.type !== "shutdown" || disposed) return;

  disposed = true;
  for (const pending of pendingApiRequests.values()) {
    pending.reject(new Error("The extension worker was stopped."));
  }
  pendingApiRequests.clear();
  try {
    if (typeof activationCleanup === "function") await activationCleanup();
  } catch (error) {
    send({ type: "error", message: String(error?.message ?? error) });
  } finally {
    for (const remove of Array.from(registeredRemovals()).reverse()) {
      try {
        remove();
      } catch (error) {
        send({ type: "error", message: String(error?.message ?? error) });
      }
    }
    closeControlPort?.();
    closeWorker();
  }
}

function connect(event) {
  if (connected || event.data?.type !== "noloader-connect" || event.ports.length !== 1) return;
  connected = true;
  self.removeEventListener("message", connect);
  controlPort = event.ports[0];
  sendToHost = controlPort.postMessage.bind(controlPort);
  closeControlPort = controlPort.close.bind(controlPort);
  controlPort.addEventListener("message", handleControlMessage);
  controlPort.start();
  void activateExtension();
}

self.addEventListener("message", connect);
`;
}

export function startModWorker(
  modId: string,
  source: string,
  onMessage: (message: ModWorkerMessage) => void,
  onError: (message: string) => void,
): ModWorkerHandle {
  const objectUrl = URL.createObjectURL(
    new Blob([createModWorkerBootstrap(modId, source)], {
      type: "text/javascript",
    }),
  );
  const channel = new MessageChannel();
  const hostPort = channel.port1;
  const extensionPort = channel.port2;
  let worker: Worker | undefined;
  let revoked = false;
  let disposed = false;
  let terminationTimer: ReturnType<typeof setTimeout> | undefined;

  const revoke = () => {
    if (revoked) return;
    revoked = true;
    URL.revokeObjectURL(objectUrl);
  };
  const closePorts = () => {
    hostPort.close();
    extensionPort.close();
  };

  try {
    worker = new Worker(objectUrl, {
      name: `noloader-${modId}`,
      type: "module",
    });
    hostPort.addEventListener(
      "message",
      (event: MessageEvent<ModWorkerMessage>) => {
        revoke();
        onMessage(event.data);
      },
    );
    hostPort.addEventListener("messageerror", () => {
      onError("Mod worker sent a message that could not be read.");
    });
    hostPort.start();
    worker.addEventListener("error", (event) => {
      revoke();
      onError(event.message || "Mod worker failed to start.");
    });
    worker.addEventListener("messageerror", () => {
      onError("Mod worker connection could not be read.");
    });
    worker.postMessage({ type: "noloader-connect" }, [extensionPort]);

    const activeWorker = worker;
    return {
      postMessage(message) {
        if (disposed) return;
        hostPort.postMessage(message);
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        try {
          hostPort.postMessage({ type: "shutdown" });
        } catch {
          activeWorker.terminate();
          closePorts();
          revoke();
          return;
        }
        terminationTimer = setTimeout(() => {
          activeWorker.terminate();
          closePorts();
          revoke();
        }, 250);
      },
      terminate() {
        if (terminationTimer) clearTimeout(terminationTimer);
        disposed = true;
        activeWorker.terminate();
        closePorts();
        revoke();
      },
    };
  } catch (error) {
    worker?.terminate();
    closePorts();
    revoke();
    throw error;
  }
}
