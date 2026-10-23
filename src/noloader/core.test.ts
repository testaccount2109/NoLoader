import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import {
  compareSemVer,
  parseManifestJson,
  type ModManifest,
} from "./core/manifest.ts";
import { resolveDependencies } from "./core/dependency-resolver.ts";
import { validateModNavigation, validateModPage } from "./core/ui-extension.ts";
import { validateModStyles } from "./core/style-extension.ts";
import { isValidModEventName, serializeModEventPayload } from "./core/events.ts";
import { createModWorkerBootstrap } from "./runtime/mod-worker.ts";

const runtime = { apiVersion: 1, launcherVersion: "0.6.29" };

test("manifest parser accepts a complete version 1 manifest", () => {
  const result = parseManifestJson(
    JSON.stringify(manifest("org.example.demo")),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.manifest.id, "org.example.demo");
  assert.deepEqual(result.manifest.dependencies, []);
  assert.deepEqual(result.manifest.permissions, []);
});

test("the SDK example ships a valid NoLoader manifest", () => {
  const source = readFileSync(
    new URL("../../sdk/hello-mod/noloader.mod.json", import.meta.url),
    "utf8",
  );
  const result = parseManifestJson(source);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.manifest.id, "org.noloader.hello");
});

test("the SDK example builds and its activation registers, updates, and cleans up UI", async () => {
  const bundleUrl = pathToFileURL(
    resolve(process.cwd(), "sdk/hello-mod/dist/index.js"),
  ).href;
  const extension = await import(`${bundleUrl}?test=${Date.now()}`);
  assert.equal(typeof extension.activate, "function");

  const calls: string[] = [];
  let actionHandler: ((action: string) => void | Promise<void>) | undefined;
  const cleanup = extension.activate({
    registerPage(page: { id: string }) {
      assert.equal(page.id, "welcome");
      calls.push("register-page");
      return () => calls.push("unregister-page");
    },
    updatePage(pageId: string) {
      assert.equal(pageId, "welcome");
      calls.push("update-page");
    },
    registerHomeWidget(widget: { id: string }) {
      assert.equal(widget.id, "quick-join");
      calls.push("register-home-widget");
      return () => calls.push("unregister-home-widget");
    },
    updateHomeWidget(widgetId: string) {
      assert.equal(widgetId, "quick-join");
      calls.push("update-home-widget");
    },
    registerNavigationItem(item: { pageId: string }) {
      assert.equal(item.pageId, "welcome");
      calls.push("register-navigation");
      return () => calls.push("unregister-navigation");
    },
    onAction(callback: (action: string) => void | Promise<void>) {
      actionHandler = callback;
      calls.push("register-action");
      return () => calls.push("unregister-action");
    },
    profiles: {
      async list() {
        return [];
      },
    },
    servers: {
      async getLastPlayed() {
        return null;
      },
    },
    launcher: {
      async launchProfile() {},
    },
    theme: {
      registerGlobalStyles() {
        return () => undefined;
      },
      updateGlobalStyles() {},
    },
    storage: {
      async get() {
        return undefined;
      },
      async set() {},
      async delete() {
        return false;
      },
    },
    events: {
      on() {
        return () => undefined;
      },
      async emit() {
        return 0;
      },
    },
  });

  assert.deepEqual(calls, [
    "register-page",
    "register-home-widget",
    "register-navigation",
    "register-action",
  ]);
  assert.equal(typeof actionHandler, "function");
  await actionHandler!("increment");
  assert.equal(calls.at(-1), "update-page");
  assert.equal(typeof cleanup, "function");
  cleanup();
  assert.deepEqual(calls.slice(-4), [
    "unregister-action",
    "unregister-navigation",
    "unregister-home-widget",
    "unregister-page",
  ]);
});

test("the worker bootstrap parses ES modules and routes control through a private port", () => {
  const bootstrap = createModWorkerBootstrap(
    "org.example.test",
    'export function activate(api) { api.registerPage({ id: "test" }); }',
  );
  assert.doesNotThrow(() => new Function(bootstrap));
  assert.match(bootstrap, /await import\(moduleUrl\)/);
  assert.match(bootstrap, /noloader-connect/);
  assert.doesNotMatch(bootstrap, /self\.postMessage\(\{ \.\.\.message/);
  assert.match(bootstrap, /subscribe-event/);
  assert.match(bootstrap, /storage\.set/);
});

test("extension events use validated namespaces and bounded JSON payloads", () => {
  assert.equal(isValidModEventName("org.example.demo:profile.changed"), true);
  assert.equal(isValidModEventName("org.example.other:profile.changed"), true);
  assert.equal(isValidModEventName("org.example.demo:profile.changed", "org.example.demo"), true);
  assert.equal(isValidModEventName("org.example.other:profile.changed", "org.example.demo"), false);
  assert.equal(isValidModEventName("org.example.demo:../outside"), false);
  assert.equal(serializeModEventPayload({ profileId: "1" }), '{"profileId":"1"}');
  assert.equal(serializeModEventPayload("x".repeat(16 * 1024)), undefined);
});

test("manifest parser reports malformed JSON and oversized input", () => {
  const malformed = parseManifestJson("{");
  assert.equal(malformed.ok, false);
  if (!malformed.ok)
    assert.match(malformed.issues[0].message, /parse manifest/i);
  assert.equal(parseManifestJson(" ".repeat(256 * 1024 + 1)).ok, false);
});

test("manifest parser rejects unknown schema fields and unsupported versions", () => {
  const unknown = parseManifestJson(
    JSON.stringify({ ...manifest("org.example.demo"), entry: "index.js" }),
  );
  assert.equal(unknown.ok, false);
  if (!unknown.ok)
    assert.ok(unknown.issues.some((issue) => issue.path === "entry"));

  const unsupported = parseManifestJson(
    JSON.stringify({ ...manifest("org.example.demo"), schemaVersion: 2 }),
  );
  assert.equal(unsupported.ok, false);
  if (!unsupported.ok)
    assert.ok(
      unsupported.issues.some((issue) => issue.path === "schemaVersion"),
    );
});

test("manifest parser rejects traversal entry points and unknown permissions", () => {
  const traversal = parseManifestJson(
    JSON.stringify({
      ...manifest("org.example.demo"),
      entrypoints: { frontend: "../outside.js" },
    }),
  );
  assert.equal(traversal.ok, false);

  const permission = parseManifestJson(
    JSON.stringify({
      ...manifest("org.example.demo"),
      permissions: ["filesystem.full"],
    }),
  );
  assert.equal(permission.ok, false);
  if (!permission.ok)
    assert.ok(
      permission.issues.some((issue) => issue.path === "permissions[0]"),
    );
});

test("semantic versions compare numeric components and prereleases correctly", () => {
  assert.equal(compareSemVer("1.10.0", "1.9.0"), 1);
  assert.equal(compareSemVer("1.0.0-alpha.2", "1.0.0-alpha.10"), -1);
  assert.equal(compareSemVer("1.0.0-rc.1", "1.0.0"), -1);
  assert.equal(compareSemVer("1.0.0+one", "1.0.0+two"), 0);
});

test("dependency resolution returns a stable topological order", () => {
  const manifests = [
    manifest("org.example.c", "1.0.0", {
      dependencies: [dependency("org.example.a")],
    }),
    manifest("org.example.b"),
    manifest("org.example.a"),
  ];

  const first = resolveDependencies(manifests, runtime);
  const second = resolveDependencies([...manifests].reverse(), runtime);
  assert.deepEqual(
    first.order.map(({ manifest: item }) => item.id),
    ["org.example.a", "org.example.b", "org.example.c"],
  );
  assert.deepEqual(
    first.order.map(({ manifest: item }) => item.id),
    second.order.map(({ manifest: item }) => item.id),
  );
});

test("missing, mismatched, incompatible, and duplicate mods are blocked", () => {
  const missing = manifest("org.example.missing-user", "1.0.0", {
    dependencies: [dependency("org.example.absent")],
  });
  const pinned = manifest("org.example.pinned-user", "1.0.0", {
    dependencies: [dependency("org.example.pinned", "2.0.0")],
  });
  const incompatible = manifest("org.example.incompatible", "1.0.0", {
    launcherVersions: ["0.6.28"],
  });
  const duplicate = manifest("org.example.pinned");
  const result = resolveDependencies(
    [
      missing,
      pinned,
      incompatible,
      duplicate,
      { ...duplicate, name: "Second copy" },
    ],
    runtime,
  );

  assert.equal(result.statusById.get(missing.id), "blocked");
  assert.equal(result.statusById.get(pinned.id), "blocked");
  assert.equal(result.statusById.get(incompatible.id), "incompatible");
  assert.equal(result.statusById.get(duplicate.id), "duplicate-id");
  assert.equal(result.order.length, 0);
});

test("conflicts block both mods even when only one side declares the conflict", () => {
  const left = manifest("org.example.left", "1.0.0", {
    conflicts: ["org.example.right"],
  });
  const right = manifest("org.example.right");
  const result = resolveDependencies([left, right], runtime);

  assert.equal(result.statusById.get(left.id), "conflict");
  assert.equal(result.statusById.get(right.id), "conflict");
});

test("cycles are reported separately from mods blocked by a cycle", () => {
  const a = manifest("org.example.a", "1.0.0", {
    dependencies: [dependency("org.example.b")],
  });
  const b = manifest("org.example.b", "1.0.0", {
    dependencies: [dependency("org.example.a")],
  });
  const c = manifest("org.example.c", "1.0.0", {
    dependencies: [dependency("org.example.a")],
  });
  const result = resolveDependencies([c, b, a], runtime);

  assert.equal(result.statusById.get(a.id), "dependency-cycle");
  assert.equal(result.statusById.get(b.id), "dependency-cycle");
  assert.equal(result.statusById.get(c.id), "blocked");
  assert.deepEqual(result.order, []);
});

test("self-dependencies are reported as dependency cycles", () => {
  const self = manifest("org.example.self", "1.0.0", {
    dependencies: [dependency("org.example.self")],
  });
  const result = resolveDependencies([self], runtime);
  assert.equal(result.statusById.get(self.id), "dependency-cycle");
});

test("UI descriptors accept the documented component catalog", () => {
  const page = validateModPage({
    id: "welcome",
    title: "Welcome",
    content: [
      { type: "heading", level: 1, text: "Hello" },
      {
        type: "card",
        title: "First steps",
        children: [
          {
            type: "button",
            id: "continue",
            label: "Continue",
            action: "continue",
          },
        ],
      },
    ],
  });
  const nav = validateModNavigation({
    id: "home",
    label: "Home",
    pageId: "welcome",
    icon: "puzzle",
  });
  assert.equal(page.ok, true);
  assert.equal(nav.ok, true);
});

test("UI descriptors reject HTML, unknown fields, and oversized component trees", () => {
  assert.equal(
    validateModPage({
      id: "unsafe",
      title: "Unsafe",
      content: [{ type: "html", html: "<script />" }],
    }).ok,
    false,
  );
  assert.equal(
    validateModNavigation({
      id: "home",
      label: "Home",
      pageId: "missing",
      target: "javascript:",
    }).ok,
    false,
  );
  assert.equal(
    validateModPage({
      id: "too-many",
      title: "Too many",
      content: Array.from({ length: 257 }, () => ({
        type: "text",
        text: "node",
      })),
    }).ok,
    false,
  );
});

test("mod styles reject external resource loading and executable CSS", () => {
  assert.equal(validateModStyles(".card { color: white; }").ok, true);
  assert.equal(
    validateModStyles("@import url(https://example.com/a.css);").ok,
    false,
  );
  assert.equal(
    validateModStyles(".card { background: url(https://example.com/a); }").ok,
    false,
  );
});

function dependency(id: string, version = "1.0.0") {
  return { id, version };
}

function manifest(
  id: string,
  version = "1.0.0",
  overrides: Partial<ModManifest> = {},
): ModManifest {
  return {
    schemaVersion: 1,
    id,
    name: id,
    version,
    authors: [],
    apiVersion: 1,
    launcherVersions: ["0.6.29"],
    entrypoints: { frontend: "dist/index.js" },
    dependencies: [],
    optionalDependencies: [],
    conflicts: [],
    permissions: [],
    ...overrides,
  };
}
