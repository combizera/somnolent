import type { EnvironmentVariable, HttpMethod } from "./types.js";

export const HTTP_METHODS = new Set([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
]);

export function toMethod(raw: string | undefined): HttpMethod {
  const upper = (raw ?? "GET").toUpperCase();
  return (HTTP_METHODS.has(upper) ? upper : "GET") as HttpMethod;
}

/** Converts Insomnia's template syntax ({{ _.var }}) into ours ({{ var }}). */
export function convertTemplates(text: string): string {
  return text.replace(/\{\{\s*_\.([\w.-]+)\s*\}\}/g, "{{ $1 }}");
}

/** Flattens the environment `data` object into key→string (nested becomes "a.b"). */
export function flattenData(
  data: Record<string, unknown>,
  prefix = "",
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    if (!key.trim()) continue; // Insomnia leaves blank rows as "": ""
    const full = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      Object.assign(out, flattenData(value as Record<string, unknown>, full));
    } else {
      out[full] = convertTemplates(
        typeof value === "string" ? value : JSON.stringify(value),
      );
    }
  }
  return out;
}

/**
 * Keys holding credentials become secret variables: the value stays on this
 * machine and never goes up in the sync.
 */
const SECRET_KEY = /(token|secret|password|passwd|pwd|api[_-]?key|authorization)/i;

export function isSecretKey(key: string): boolean {
  return SECRET_KEY.test(key);
}

export function toVariables(
  data: Record<string, unknown> | undefined,
): EnvironmentVariable[] {
  return Object.entries(flattenData(data ?? {})).map(([key, value]) => ({
    key,
    value,
    secret: isSecretKey(key),
    enabled: true,
  }));
}

/** Sorts siblings by Insomnia's sortKey; without one, keeps the file order. */
export function bySortKey<T extends { meta?: { sortKey?: number } }>(
  nodes: T[],
): T[] {
  return [...nodes]
    .map((node, index) => ({ node, index }))
    .sort((a, b) => {
      const ka = a.node.meta?.sortKey;
      const kb = b.node.meta?.sortKey;
      if (ka === undefined || kb === undefined) return a.index - b.index;
      return ka - kb || a.index - b.index;
    })
    .map((entry) => entry.node);
}
