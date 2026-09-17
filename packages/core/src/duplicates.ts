import type { Environment, EnvironmentVariable } from "./types.js";

/**
 * An environment name is a human label: "staging" and " Staging " read as the
 * same one, so the comparison ignores case and surrounding spaces.
 */
export function normalizeEnvName(name: string): string {
  return name.trim().toLocaleLowerCase();
}

/**
 * Ids of environments whose name collides with another's.
 * Unnamed ones do not count — the user is still typing.
 */
export function duplicateEnvIds(environments: Environment[]): Set<string> {
  const byName = new Map<string, string[]>();
  for (const env of environments) {
    const key = normalizeEnvName(env.name);
    if (!key) continue;
    const ids = byName.get(key);
    if (ids) ids.push(env.id);
    else byName.set(key, [env.id]);
  }
  const dupes = new Set<string>();
  for (const ids of byName.values()) {
    if (ids.length > 1) for (const id of ids) dupes.add(id);
  }
  return dupes;
}

/**
 * Indexes of variables whose key collides inside the same environment.
 * Case-sensitive because {{var}} resolution is too; blank keys are ignored.
 */
export function duplicateVarIndexes(variables: EnvironmentVariable[]): Set<number> {
  const byKey = new Map<string, number[]>();
  variables.forEach((v, i) => {
    if (!v.key.trim()) return;
    const at = byKey.get(v.key);
    if (at) at.push(i);
    else byKey.set(v.key, [i]);
  });
  const dupes = new Set<number>();
  for (const indexes of byKey.values()) {
    if (indexes.length > 1) for (const i of indexes) dupes.add(i);
  }
  return dupes;
}

/**
 * Free name from `desired`, suffixing " 2", " 3"... while it collides.
 * Used where the name is born without typing ("+ environment" button, import).
 */
export function uniqueEnvName(desired: string, taken: string[]): string {
  const used = new Set(taken.map(normalizeEnvName));
  if (!used.has(normalizeEnvName(desired))) return desired;
  for (let n = 2; ; n++) {
    const candidate = `${desired} ${n}`;
    if (!used.has(normalizeEnvName(candidate))) return candidate;
  }
}
