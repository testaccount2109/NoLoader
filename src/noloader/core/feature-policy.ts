export const MOD_FEATURE_IDS = [
  "curseforge.integration",
  "launcher.news",
  "launcher.effects",
  "launcher.ads",
] as const;

export type ModFeatureId = (typeof MOD_FEATURE_IDS)[number];
export type FeatureSnapshot = Record<ModFeatureId, boolean>;

const DEFAULT_FEATURES: FeatureSnapshot = {
  "curseforge.integration": true,
  "launcher.news": true,
  "launcher.effects": true,
  "launcher.ads": true,
};

const overrides = new Map<string, Map<ModFeatureId, boolean>>();
const listeners = new Set<() => void>();
let revision = 0;
let cachedSnapshot: FeatureSnapshot = { ...DEFAULT_FEATURES };

export function isModFeatureId(value: unknown): value is ModFeatureId {
  return typeof value === "string" && MOD_FEATURE_IDS.includes(value as ModFeatureId);
}

export function setModFeatureOverride(
  modId: string,
  featureId: ModFeatureId,
  enabled: boolean,
): void {
  let modOverrides = overrides.get(modId);
  if (!modOverrides) {
    modOverrides = new Map();
    overrides.set(modId, modOverrides);
  }
  if (modOverrides.get(featureId) === enabled) return;
  modOverrides.set(featureId, enabled);
  publish();
}

export function clearModFeatureOverrides(modId: string): void {
  if (!overrides.delete(modId)) return;
  publish();
}

export function getModFeatureSnapshot(): FeatureSnapshot {
  return cachedSnapshot;
}

export function getModFeature(featureId: ModFeatureId): boolean {
  return cachedSnapshot[featureId];
}

export function subscribeModFeatures(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getModFeatureRevision(): number {
  return revision;
}

function publish(): void {
  const next = { ...DEFAULT_FEATURES };
  for (const modOverrides of overrides.values()) {
    for (const [featureId, enabled] of modOverrides) {
      // A disable request wins when multiple enabled mods target the same feature.
      next[featureId] = next[featureId] && enabled;
    }
  }
  cachedSnapshot = next;
  revision += 1;
  for (const listener of listeners) listener();
}
