export const MANIFEST_SCHEMA_VERSION = 1;
export const NOLOADER_API_VERSION = 6;
export const SUPPORTED_NOLOADER_API_VERSIONS = [1, 2, 3, 4, 5, 6] as const;
export const MOD_MANIFEST_FILE = "noloader.mod.json";
export const MAX_MANIFEST_BYTES = 256 * 1024;

export const PERMISSION_IDS = [
  "ui.navigation",
  "ui.pages",
  "ui.home",
  "ui.globalStyles",
  "launcher.profiles.read",
  "launcher.lastServer.read",
  "launcher.launch",
  "launcher.features.manage",
  "launcher.performance.read",
  "storage.mod",
  "events.publish",
  "events.subscribe",
  "network.http",
  "launcher.notifications",
  "launcher.openExternal",
  "system.clipboard",
  "system.dialog",
  "system.files",
  "system.process",
  "launcher.windows",
  "launcher.clientRuntime",
] as const;

export type PermissionId = (typeof PERMISSION_IDS)[number];

export interface ModDependency {
  id: string;
  version: string;
}

export interface ModManifest {
  schemaVersion: typeof MANIFEST_SCHEMA_VERSION;
  id: string;
  name: string;
  version: string;
  description?: string;
  authors: string[];
  license?: string;
  repository?: string;
  updates?: { manifestUrl: string };
  apiVersion: number;
  launcherVersions: string[];
  entrypoints: {
    frontend: string;
    styles?: string;
  };
  dependencies: ModDependency[];
  optionalDependencies: ModDependency[];
  conflicts: string[];
  permissions: PermissionId[];
}

export interface ManifestIssue {
  path: string;
  message: string;
}

export type ManifestResult =
  | { ok: true; manifest: ModManifest }
  | { ok: false; issues: ManifestIssue[] };

interface ParsedSemVer {
  major: bigint;
  minor: bigint;
  patch: bigint;
  prerelease: Array<bigint | string>;
}

const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const MOD_ID_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const ENTRY_POINT_PATTERN = /^[A-Za-z0-9._/-]+$/;
const ALLOWED_FIELDS = new Set([
  "schemaVersion",
  "id",
  "name",
  "version",
  "description",
  "authors",
  "license",
  "repository",
  "updates",
  "apiVersion",
  "launcherVersions",
  "entrypoints",
  "dependencies",
  "optionalDependencies",
  "conflicts",
  "permissions",
]);
const PERMISSION_SET = new Set<string>(PERMISSION_IDS);

export function parseManifestJson(source: string): ManifestResult {
  if (new TextEncoder().encode(source).byteLength > MAX_MANIFEST_BYTES) {
    return failure(
      "$",
      `Manifest exceeds the ${MAX_MANIFEST_BYTES}-byte limit.`,
    );
  }

  let value: unknown;
  try {
    value = JSON.parse(source) as unknown;
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Invalid JSON.";
    return failure("$", `Could not parse manifest JSON: ${detail}`);
  }

  return validateManifest(value);
}

export function validateManifest(value: unknown): ManifestResult {
  if (!isRecord(value)) {
    return failure("$", "Manifest must be a JSON object.");
  }

  const issues: ManifestIssue[] = [];
  for (const field of Object.keys(value)) {
    if (!ALLOWED_FIELDS.has(field)) {
      issues.push({ path: field, message: "Unknown manifest field." });
    }
  }

  const schemaVersion = readPositiveInteger(value, "schemaVersion", issues);
  if (
    schemaVersion !== undefined &&
    schemaVersion !== MANIFEST_SCHEMA_VERSION
  ) {
    issues.push({
      path: "schemaVersion",
      message: `Unsupported schema version ${schemaVersion}; supported version is ${MANIFEST_SCHEMA_VERSION}.`,
    });
  }

  const id = readString(value, "id", issues);
  if (
    id !== undefined &&
    (id.length > 128 || !id.includes(".") || !MOD_ID_PATTERN.test(id))
  ) {
    issues.push({
      path: "id",
      message: "Use a lowercase, namespaced ID such as `org.example.mod`.",
    });
  }

  const name = readString(value, "name", issues);
  if (name !== undefined && name.length > 80) {
    issues.push({
      path: "name",
      message: "Name must be 80 characters or fewer.",
    });
  }

  const version = readSemVer(value, "version", issues);
  const description = readOptionalString(value, "description", issues, 2048);
  const authors = readStringArray(value, "authors", issues, 32, false);
  const license = readOptionalString(value, "license", issues, 128);
  const repository = readOptionalString(value, "repository", issues, 2048);
  if (repository !== undefined && !isHttpsUrl(repository)) {
    issues.push({
      path: "repository",
      message: "Repository must be an HTTPS URL.",
    });
  }
  const updates = readUpdateConfiguration(value, issues);

  const apiVersion = readPositiveInteger(value, "apiVersion", issues);
  const launcherVersions = readSemVerArray(
    value,
    "launcherVersions",
    issues,
    32,
    true,
  );
  const entrypoints = readEntrypoints(value, issues);
  const dependencies = readDependencyArray(value, "dependencies", issues);
  const optionalDependencies = readDependencyArray(
    value,
    "optionalDependencies",
    issues,
  );
  const conflicts = readIdArray(value, "conflicts", issues, 64);
  const permissions = readPermissions(value, issues);

  if (id !== undefined) {
    for (const [listName, list] of [
      ["dependencies", dependencies],
      ["optionalDependencies", optionalDependencies],
    ] as const) {
      if (list?.some((dependency) => dependency.id === id)) {
        issues.push({
          path: listName,
          message: "A mod cannot depend on itself.",
        });
      }
    }
    if (conflicts?.includes(id)) {
      issues.push({
        path: "conflicts",
        message: "A mod cannot conflict with itself.",
      });
    }
  }

  const requiredIds = new Set(
    dependencies?.map(({ id: dependencyId }) => dependencyId),
  );
  if (
    optionalDependencies?.some(({ id: dependencyId }) =>
      requiredIds.has(dependencyId),
    )
  ) {
    issues.push({
      path: "optionalDependencies",
      message: "A dependency cannot be both required and optional.",
    });
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  return {
    ok: true,
    manifest: {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      id: id!,
      name: name!,
      version: version!,
      ...(description === undefined ? {} : { description }),
      authors: authors ?? [],
      ...(license === undefined ? {} : { license }),
      ...(repository === undefined ? {} : { repository }),
      ...(updates === undefined ? {} : { updates }),
      apiVersion: apiVersion!,
      launcherVersions: launcherVersions!,
      entrypoints: entrypoints!,
      dependencies: dependencies ?? [],
      optionalDependencies: optionalDependencies ?? [],
      conflicts: conflicts ?? [],
      permissions: permissions ?? [],
    },
  };
}

function readUpdateConfiguration(
  value: Record<string, unknown>,
  issues: ManifestIssue[],
): ModManifest["updates"] {
  if (value.updates === undefined) return undefined;
  if (!isRecord(value.updates)) {
    issues.push({ path: "updates", message: "Expected an update configuration object." });
    return undefined;
  }
  for (const field of Object.keys(value.updates)) {
    if (field !== "manifestUrl") {
      issues.push({ path: `updates.${field}`, message: "Unknown update configuration field." });
    }
  }
  const manifestUrl = readString(value.updates, "manifestUrl", issues, "updates.manifestUrl");
  if (manifestUrl !== undefined && !isHttpsUrl(manifestUrl)) {
    issues.push({ path: "updates.manifestUrl", message: "Update manifest URL must use HTTPS." });
    return undefined;
  }
  return manifestUrl === undefined ? undefined : { manifestUrl };
}

export function compareSemVer(left: string, right: string): number {
  const leftVersion = parseSemVer(left);
  const rightVersion = parseSemVer(right);
  if (!leftVersion || !rightVersion) {
    throw new TypeError("compareSemVer requires valid semantic versions.");
  }

  for (const [leftPart, rightPart] of [
    [leftVersion.major, rightVersion.major],
    [leftVersion.minor, rightVersion.minor],
    [leftVersion.patch, rightVersion.patch],
  ] as const) {
    if (leftPart !== rightPart) return leftPart < rightPart ? -1 : 1;
  }

  if (
    leftVersion.prerelease.length === 0 ||
    rightVersion.prerelease.length === 0
  ) {
    if (leftVersion.prerelease.length === rightVersion.prerelease.length)
      return 0;
    return leftVersion.prerelease.length === 0 ? 1 : -1;
  }

  const sharedLength = Math.min(
    leftVersion.prerelease.length,
    rightVersion.prerelease.length,
  );
  for (let index = 0; index < sharedLength; index += 1) {
    const leftPart = leftVersion.prerelease[index];
    const rightPart = rightVersion.prerelease[index];
    if (leftPart === rightPart) continue;

    if (typeof leftPart === "bigint" && typeof rightPart === "bigint") {
      return leftPart < rightPart ? -1 : 1;
    }
    if (typeof leftPart === "bigint") return -1;
    if (typeof rightPart === "bigint") return 1;
    return leftPart < rightPart ? -1 : 1;
  }

  if (leftVersion.prerelease.length === rightVersion.prerelease.length)
    return 0;
  return leftVersion.prerelease.length < rightVersion.prerelease.length
    ? -1
    : 1;
}

function parseSemVer(value: string): ParsedSemVer | undefined {
  if (value.length > 128) return undefined;
  const match = SEMVER_PATTERN.exec(value);
  if (!match) return undefined;

  return {
    major: BigInt(match[1]),
    minor: BigInt(match[2]),
    patch: BigInt(match[3]),
    prerelease: match[4]
      ? match[4]
          .split(".")
          .map((identifier) =>
            /^\d+$/.test(identifier) ? BigInt(identifier) : identifier,
          )
      : [],
  };
}

function readSemVer(
  value: Record<string, unknown>,
  key: string,
  issues: ManifestIssue[],
  issuePath = key,
): string | undefined {
  const version = readString(value, key, issues, issuePath);
  if (version !== undefined && !parseSemVer(version)) {
    issues.push({
      path: issuePath,
      message: "Expected a valid SemVer version.",
    });
    return undefined;
  }
  return version;
}

function readSemVerArray(
  value: Record<string, unknown>,
  key: string,
  issues: ManifestIssue[],
  maxItems: number,
  requireNonEmpty: boolean,
): string[] | undefined {
  const list = value[key];
  if (list === undefined) {
    if (requireNonEmpty)
      issues.push({ path: key, message: "This field is required." });
    return requireNonEmpty ? undefined : [];
  }
  if (!Array.isArray(list)) {
    issues.push({
      path: key,
      message: "Expected an array of SemVer versions.",
    });
    return undefined;
  }
  if (list.length > maxItems || (requireNonEmpty && list.length === 0)) {
    issues.push({
      path: key,
      message: requireNonEmpty
        ? `Provide between 1 and ${maxItems} versions.`
        : `Provide at most ${maxItems} versions.`,
    });
  }

  const result: string[] = [];
  for (const [index, item] of list.entries()) {
    if (typeof item !== "string" || !parseSemVer(item)) {
      issues.push({
        path: `${key}[${index}]`,
        message: "Expected a valid SemVer version.",
      });
      continue;
    }
    if (result.some((existing) => compareSemVer(existing, item) === 0)) {
      issues.push({ path: `${key}[${index}]`, message: "Duplicate version." });
      continue;
    }
    result.push(item);
  }
  return result;
}

function readPositiveInteger(
  value: Record<string, unknown>,
  key: string,
  issues: ManifestIssue[],
): number | undefined {
  const field = value[key];
  if (!Number.isSafeInteger(field) || (field as number) < 1) {
    issues.push({ path: key, message: "Expected a positive integer." });
    return undefined;
  }
  return field as number;
}

function readString(
  value: Record<string, unknown>,
  key: string,
  issues: ManifestIssue[],
  issuePath = key,
): string | undefined {
  const field = value[key];
  if (typeof field !== "string" || field.trim().length === 0) {
    issues.push({ path: issuePath, message: "Expected a non-empty string." });
    return undefined;
  }
  if (field !== field.trim()) {
    issues.push({
      path: issuePath,
      message: "Leading or trailing whitespace is not allowed.",
    });
    return undefined;
  }
  return field;
}

function readOptionalString(
  value: Record<string, unknown>,
  key: string,
  issues: ManifestIssue[],
  maxLength: number,
  issuePath = key,
): string | undefined {
  if (value[key] === undefined) return undefined;
  const field = readString(value, key, issues, issuePath);
  if (field !== undefined && field.length > maxLength) {
    issues.push({
      path: issuePath,
      message: `Value must be ${maxLength} characters or fewer.`,
    });
    return undefined;
  }
  return field;
}

function readStringArray(
  value: Record<string, unknown>,
  key: string,
  issues: ManifestIssue[],
  maxItems: number,
  requireNonEmpty: boolean,
): string[] | undefined {
  const list = value[key];
  if (list === undefined) {
    if (requireNonEmpty)
      issues.push({ path: key, message: "This field is required." });
    return requireNonEmpty ? undefined : [];
  }
  if (!Array.isArray(list)) {
    issues.push({ path: key, message: "Expected an array of strings." });
    return undefined;
  }
  if (list.length > maxItems || (requireNonEmpty && list.length === 0)) {
    issues.push({
      path: key,
      message: requireNonEmpty
        ? `Provide between 1 and ${maxItems} values.`
        : `Provide at most ${maxItems} values.`,
    });
  }

  const result: string[] = [];
  for (const [index, item] of list.entries()) {
    if (
      typeof item !== "string" ||
      item.trim().length === 0 ||
      item !== item.trim()
    ) {
      issues.push({
        path: `${key}[${index}]`,
        message: "Expected a non-empty trimmed string.",
      });
      continue;
    }
    if (result.includes(item)) {
      issues.push({ path: `${key}[${index}]`, message: "Duplicate value." });
      continue;
    }
    result.push(item);
  }
  return result;
}

function readIdArray(
  value: Record<string, unknown>,
  key: string,
  issues: ManifestIssue[],
  maxItems: number,
): string[] | undefined {
  const ids = readStringArray(value, key, issues, maxItems, false);
  ids?.forEach((id, index) => {
    if (id.length > 128 || !id.includes(".") || !MOD_ID_PATTERN.test(id)) {
      issues.push({
        path: `${key}[${index}]`,
        message: "Expected a lowercase namespaced mod ID.",
      });
    }
  });
  return ids;
}

function readDependencyArray(
  value: Record<string, unknown>,
  key: string,
  issues: ManifestIssue[],
): ModDependency[] | undefined {
  const list = value[key];
  if (list === undefined) return [];
  if (!Array.isArray(list)) {
    issues.push({
      path: key,
      message: "Expected an array of dependency objects.",
    });
    return undefined;
  }
  if (list.length > 64) {
    issues.push({ path: key, message: "Provide at most 64 dependencies." });
  }

  const dependencies: ModDependency[] = [];
  const seenIds = new Set<string>();
  for (const [index, item] of list.entries()) {
    const path = `${key}[${index}]`;
    if (!isRecord(item)) {
      issues.push({ path, message: "Expected a dependency object." });
      continue;
    }
    for (const field of Object.keys(item)) {
      if (field !== "id" && field !== "version") {
        issues.push({
          path: `${path}.${field}`,
          message: "Unknown dependency field.",
        });
      }
    }
    const id = readString(item, "id", issues, `${path}.id`);
    const version = readSemVer(item, "version", issues, `${path}.version`);
    if (
      id !== undefined &&
      (id.length > 128 || !id.includes(".") || !MOD_ID_PATTERN.test(id))
    ) {
      issues.push({
        path: `${path}.id`,
        message: "Expected a lowercase namespaced mod ID.",
      });
    }
    if (id !== undefined && seenIds.has(id)) {
      issues.push({ path: `${path}.id`, message: "Duplicate dependency ID." });
    }
    if (id !== undefined) seenIds.add(id);
    if (id !== undefined && version !== undefined)
      dependencies.push({ id, version });
  }
  return dependencies;
}

function readEntrypoints(
  value: Record<string, unknown>,
  issues: ManifestIssue[],
): ModManifest["entrypoints"] | undefined {
  const entrypoints = value.entrypoints;
  if (!isRecord(entrypoints)) {
    issues.push({
      path: "entrypoints",
      message: "Expected an entrypoints object.",
    });
    return undefined;
  }
  for (const field of Object.keys(entrypoints)) {
    if (field !== "frontend" && field !== "styles") {
      issues.push({
        path: `entrypoints.${field}`,
        message: "Unknown entry point.",
      });
    }
  }

  const frontend = readString(
    entrypoints,
    "frontend",
    issues,
    "entrypoints.frontend",
  );
  const styles = readOptionalString(
    entrypoints,
    "styles",
    issues,
    240,
    "entrypoints.styles",
  );
  if (
    frontend !== undefined &&
    !isSafeRelativeEntryPoint(frontend, [".js", ".mjs"])
  ) {
    issues.push({
      path: "entrypoints.frontend",
      message: "Expected a safe relative .js or .mjs path.",
    });
  }
  if (styles !== undefined && !isSafeRelativeEntryPoint(styles, [".css"])) {
    issues.push({
      path: "entrypoints.styles",
      message: "Expected a safe relative .css path.",
    });
  }
  if (frontend === undefined) return undefined;
  return { frontend, ...(styles === undefined ? {} : { styles }) };
}

function readPermissions(
  value: Record<string, unknown>,
  issues: ManifestIssue[],
): PermissionId[] | undefined {
  const permissions = readStringArray(value, "permissions", issues, 32, false);
  permissions?.forEach((permission, index) => {
    if (!PERMISSION_SET.has(permission)) {
      issues.push({
        path: `permissions[${index}]`,
        message: `Unknown permission. Supported values: ${PERMISSION_IDS.join(", ")}.`,
      });
    }
  });
  return permissions as PermissionId[] | undefined;
}

function isSafeRelativeEntryPoint(path: string, extensions: string[]): boolean {
  if (
    path.length > 240 ||
    !ENTRY_POINT_PATTERN.test(path) ||
    path.startsWith("/") ||
    path.endsWith("/") ||
    path
      .split("/")
      .some(
        (segment) =>
          segment.length === 0 || segment === "." || segment === "..",
      )
  ) {
    return false;
  }
  return extensions.some((extension) => path.endsWith(extension));
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function failure(path: string, message: string): ManifestResult {
  return { ok: false, issues: [{ path, message }] };
}
