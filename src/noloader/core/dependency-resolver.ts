import { compareSemVer, type ModManifest } from "./manifest.ts";

export type ModResolutionState =
  | "ready"
  | "incompatible"
  | "blocked"
  | "conflict"
  | "duplicate-id"
  | "dependency-cycle";

export interface ResolutionIssue {
  modId: string;
  code: Exclude<ModResolutionState, "ready">;
  message: string;
}

export interface ResolvedMod {
  manifest: ModManifest;
  availableOptionalDependencies: string[];
}

export interface DependencyResolution {
  order: ResolvedMod[];
  statusById: ReadonlyMap<string, ModResolutionState>;
  issues: ResolutionIssue[];
}

export interface RuntimeCompatibility {
  apiVersion: number;
  apiVersions?: readonly number[];
  launcherVersion: string;
}

export function resolveDependencies(
  manifests: readonly ModManifest[],
  runtime: RuntimeCompatibility,
): DependencyResolution {
  const statusById = new Map<string, ModResolutionState>();
  const issueById = new Map<string, ResolutionIssue>();
  const manifestsById = new Map<string, ModManifest>();
  const duplicateIds = new Set<string>();

  for (const manifest of manifests) {
    if (manifestsById.has(manifest.id)) duplicateIds.add(manifest.id);
    else manifestsById.set(manifest.id, manifest);
  }

  const setIssue = (
    modId: string,
    code: Exclude<ModResolutionState, "ready">,
    message: string,
  ) => {
    if (statusById.has(modId)) return;
    statusById.set(modId, code);
    issueById.set(modId, { modId, code, message });
  };

  for (const id of [...duplicateIds].sort()) {
    setIssue(
      id,
      "duplicate-id",
      `More than one installed mod uses ID "${id}".`,
    );
  }

  for (const manifest of [...manifestsById.values()].sort(byId)) {
    if (statusById.has(manifest.id)) continue;
    if (!(runtime.apiVersions ?? [runtime.apiVersion]).includes(manifest.apiVersion)) {
      setIssue(
        manifest.id,
        "incompatible",
        `Requires NoLoader API ${manifest.apiVersion}; this launcher supports ${(runtime.apiVersions ?? [runtime.apiVersion]).join(", ")}.`,
      );
      continue;
    }
    if (
      !manifest.launcherVersions.some(
        (version) => compareSemVer(version, runtime.launcherVersion) === 0,
      )
    ) {
      setIssue(
        manifest.id,
        "incompatible",
        `Does not support launcher version ${runtime.launcherVersion}.`,
      );
    }
  }

  const conflicts = new Set<string>();
  for (const manifest of [...manifestsById.values()].sort(byId)) {
    for (const conflictId of [...manifest.conflicts].sort()) {
      if (!manifestsById.has(conflictId)) continue;
      const pair = [manifest.id, conflictId].sort().join("\u0000");
      conflicts.add(pair);
    }
  }
  for (const pair of [...conflicts].sort()) {
    const [leftId, rightId] = pair.split("\u0000");
    setIssue(leftId, "conflict", `Conflicts with installed mod "${rightId}".`);
    setIssue(rightId, "conflict", `Conflicts with installed mod "${leftId}".`);
  }

  for (const manifest of [...manifestsById.values()].sort(byId)) {
    if (statusById.has(manifest.id)) continue;
    for (const dependency of [...manifest.dependencies].sort(byDependencyId)) {
      const candidate = manifestsById.get(dependency.id);
      if (!candidate) {
        setIssue(
          manifest.id,
          "blocked",
          `Required mod "${dependency.id}" is not installed.`,
        );
        break;
      }
      if (compareSemVer(candidate.version, dependency.version) !== 0) {
        setIssue(
          manifest.id,
          "blocked",
          `Requires "${dependency.id}" version ${dependency.version}; found ${candidate.version}.`,
        );
        break;
      }
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const manifest of [...manifestsById.values()].sort(byId)) {
      if (statusById.has(manifest.id)) continue;
      const unavailable = [...manifest.dependencies]
        .sort(byDependencyId)
        .find((dependency) => statusById.has(dependency.id));
      if (unavailable) {
        setIssue(
          manifest.id,
          "blocked",
          `Required mod "${unavailable.id}" cannot be loaded (${statusById.get(unavailable.id)}).`,
        );
        changed = true;
      }
    }
  }

  const candidates = [...manifestsById.keys()]
    .filter((id) => !statusById.has(id))
    .sort();
  const candidateIds = new Set(candidates);
  const dependents = new Map(candidates.map((id) => [id, [] as string[]]));
  const inDegree = new Map(candidates.map((id) => [id, 0]));

  for (const id of candidates) {
    const manifest = manifestsById.get(id)!;
    for (const dependency of manifest.dependencies) {
      if (!candidateIds.has(dependency.id)) continue;
      inDegree.set(id, inDegree.get(id)! + 1);
      dependents.get(dependency.id)!.push(id);
    }
  }

  const ready = candidates.filter((id) => inDegree.get(id) === 0).sort();
  const orderedIds: string[] = [];
  while (ready.length > 0) {
    const id = ready.shift()!;
    orderedIds.push(id);
    for (const dependent of dependents.get(id)!.sort()) {
      const remaining = inDegree.get(dependent)! - 1;
      inDegree.set(dependent, remaining);
      if (remaining === 0) {
        ready.push(dependent);
        ready.sort();
      }
    }
  }

  const unresolved = candidates.filter((id) => !orderedIds.includes(id));
  if (unresolved.length > 0) {
    const cycleIds = findCycleMembers(unresolved, manifestsById);
    for (const id of [...cycleIds].sort()) {
      setIssue(
        id,
        "dependency-cycle",
        "This mod is part of a required dependency cycle.",
      );
    }
    for (const id of unresolved.sort()) {
      if (cycleIds.has(id)) continue;
      const manifest = manifestsById.get(id)!;
      const dependency = manifest.dependencies.find((item) =>
        cycleIds.has(item.id),
      );
      setIssue(
        id,
        "blocked",
        `Required mod "${dependency?.id ?? "an unresolved dependency"}" is part of a dependency cycle.`,
      );
    }
  }

  for (const id of manifestsById.keys()) {
    if (!statusById.has(id)) statusById.set(id, "ready");
  }

  const order: ResolvedMod[] = orderedIds
    .filter((id) => statusById.get(id) === "ready")
    .map((id) => {
      const manifest = manifestsById.get(id)!;
      const availableOptionalDependencies = manifest.optionalDependencies
        .filter((dependency) => {
          const optional = manifestsById.get(dependency.id);
          return (
            optional !== undefined &&
            statusById.get(dependency.id) === "ready" &&
            compareSemVer(optional.version, dependency.version) === 0
          );
        })
        .map(({ id: dependencyId }) => dependencyId)
        .sort();
      return { manifest, availableOptionalDependencies };
    });

  return {
    order,
    statusById,
    issues: [...issueById.values()].sort((left, right) =>
      left.modId === right.modId
        ? left.code.localeCompare(right.code)
        : left.modId.localeCompare(right.modId),
    ),
  };
}

function findCycleMembers(
  unresolved: readonly string[],
  manifestsById: ReadonlyMap<string, ModManifest>,
): Set<string> {
  const unresolvedSet = new Set(unresolved);
  const indexes = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const cycleMembers = new Set<string>();
  let nextIndex = 0;

  const visit = (id: string) => {
    indexes.set(id, nextIndex);
    lowLinks.set(id, nextIndex);
    nextIndex += 1;
    stack.push(id);
    onStack.add(id);

    const dependencies = [...manifestsById.get(id)!.dependencies]
      .map(({ id: dependencyId }) => dependencyId)
      .filter((dependencyId) => unresolvedSet.has(dependencyId))
      .sort();
    for (const dependencyId of dependencies) {
      if (!indexes.has(dependencyId)) {
        visit(dependencyId);
        lowLinks.set(
          id,
          Math.min(lowLinks.get(id)!, lowLinks.get(dependencyId)!),
        );
      } else if (onStack.has(dependencyId)) {
        lowLinks.set(
          id,
          Math.min(lowLinks.get(id)!, indexes.get(dependencyId)!),
        );
      }
    }

    if (lowLinks.get(id) !== indexes.get(id)) return;
    const component: string[] = [];
    let member: string;
    do {
      member = stack.pop()!;
      onStack.delete(member);
      component.push(member);
    } while (member !== id);
    if (
      component.length > 1 ||
      manifestsById
        .get(component[0])!
        .dependencies.some(
          ({ id: dependencyId }) => dependencyId === component[0],
        )
    )
      component.forEach((item) => cycleMembers.add(item));
  };

  for (const id of [...unresolved].sort()) {
    if (!indexes.has(id)) visit(id);
  }
  return cycleMembers;
}

function byId(left: ModManifest, right: ModManifest): number {
  return left.id.localeCompare(right.id);
}

function byDependencyId(left: { id: string }, right: { id: string }): number {
  return left.id.localeCompare(right.id);
}
