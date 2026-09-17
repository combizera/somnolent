import type { ApiRequest, Environment, KeyValue } from "./types.js";

const VAR_PATTERN = /\{\{\s*([\w.-]+)\s*\}\}/g;

/** Base64 that works in the browser and in Node. */
function toBase64(text: string): string {
  if (typeof btoa === "function") return btoa(text);
  const BufferCtor = (globalThis as Record<string, any>)["Buffer"];
  return BufferCtor.from(text, "utf-8").toString("base64");
}

export interface ResolveResult {
  output: string;
  /** Variables referenced by the template that do not exist in the context. */
  missing: string[];
}

/**
 * Builds the value map: base environment first, active one on top (it wins on
 * repeated keys). Disabled variables are ignored.
 */
export function buildContext(
  base: Environment | null,
  active: Environment | null,
): Record<string, string> {
  const ctx: Record<string, string> = {};
  for (const env of [base, active]) {
    if (!env) continue;
    for (const v of env.variables) {
      if (v.enabled) ctx[v.key] = v.value;
    }
  }
  return ctx;
}

/** Replaces {{ var }} with the context values. No logic, just substitution. */
export function resolveTemplate(
  template: string,
  ctx: Record<string, string>,
): ResolveResult {
  const missing: string[] = [];
  const output = template.replace(VAR_PATTERN, (match, name: string) => {
    const value = ctx[name];
    if (value === undefined) {
      if (!missing.includes(name)) missing.push(name);
      return match;
    }
    return value;
  });
  return { output, missing };
}

/** Lists the variable names referenced in a template. */
export function extractVariables(template: string): string[] {
  const names: string[] = [];
  for (const match of template.matchAll(VAR_PATTERN)) {
    const name = match[1];
    if (name !== undefined && !names.includes(name)) names.push(name);
  }
  return names;
}

/**
 * `:param` in the URL, Insomnia style. Requires a letter or `_` up front so it
 * is not confused with `https://` or with a port (`:8080`).
 */
const PATH_PARAM = /:([A-Za-z_][\w-]*)/g;

/** The part before `?` and the query. After the `?`, `:` is an ordinary
 *  character — `?:status=all` means a query param, not a path param. */
function splitAtQuery(url: string): [string, string] {
  const at = url.indexOf("?");
  return at === -1 ? [url, ""] : [url.slice(0, at), url.slice(at)];
}

/** Path param names cited in the URL, in order, without repeats. */
export function extractPathParams(url: string): string[] {
  const names: string[] = [];
  for (const match of splitAtQuery(url)[0].matchAll(PATH_PARAM)) {
    const name = match[1];
    if (name !== undefined && !names.includes(name)) names.push(name);
  }
  return names;
}

/** Splits the URL query string into editable pairs. Values come out decoded,
 *  since storing `a%20b` raw would turn into `a%2520b` on the next pass. */
export function splitQueryParams(url: string): {
  url: string;
  params: { key: string; value: string }[];
} {
  const [base, query] = splitAtQuery(url);
  if (!query) return { url, params: [] };
  const params: { key: string; value: string }[] = [];
  for (const [key, value] of new URLSearchParams(query.slice(1))) {
    params.push({ key, value });
  }
  // With no pair at all (`?` alone, or `?#frag`), the query stays in the URL.
  return params.length > 0 ? { url: base, params } : { url, params: [] };
}

/**
 * Replaces each `:param` with its filled value. An empty one stays visible in
 * the URL and is reported as missing, like an undefined `{{var}}`.
 */
export function applyPathParams(
  url: string,
  values: Record<string, string>,
): ResolveResult {
  const missing: string[] = [];
  const [base, query] = splitAtQuery(url);
  const output = base.replace(PATH_PARAM, (match, name: string) => {
    const value = values[name];
    if (value === undefined || value === "") {
      if (!missing.includes(`:${name}`)) missing.push(`:${name}`);
      return match;
    }
    return encodeURIComponent(value);
  });
  return { output: output + query, missing };
}

export interface ResolvedRequest {
  method: ApiRequest["method"];
  url: string;
  headers: { key: string; value: string }[];
  body: string | null;
  missing: string[];
}

function resolvePairs(
  pairs: KeyValue[],
  ctx: Record<string, string>,
  missing: Set<string>,
): { key: string; value: string }[] {
  return pairs
    .filter((p) => p.enabled)
    .map((p) => {
      const key = resolveTemplate(p.key, ctx);
      const value = resolveTemplate(p.value, ctx);
      for (const m of [...key.missing, ...value.missing]) missing.add(m);
      return { key: key.output, value: value.output };
    });
}

/**
 * Resolves the whole request against the active environment: URL, query params,
 * headers and body, all with {{vars}} substituted.
 */
export function resolveRequest(
  request: ApiRequest,
  base: Environment | null,
  active: Environment | null,
): ResolvedRequest {
  const ctx = buildContext(base, active);
  const missing = new Set<string>();

  const url = resolveTemplate(request.url, ctx);
  for (const m of url.missing) missing.add(m);

  // `:param` resolves after the template: a {{var}} value may contain a
  // `:param`, but never the other way around.
  const pathValues = Object.fromEntries(
    resolvePairs(request.pathParams ?? [], ctx, missing).map(({ key, value }) => [key, value]),
  );
  // An empty path param stays out of `missing`: its row already turns red in
  // the Params tab, and the request is still sendable — the API answers.
  const withPath = applyPathParams(url.output, pathValues);

  const query = resolvePairs(request.queryParams, ctx, missing);
  let finalUrl = withPath.output;
  if (query.length > 0) {
    const qs = new URLSearchParams(
      query.map(({ key, value }) => [key, value]),
    ).toString();
    finalUrl += (finalUrl.includes("?") ? "&" : "?") + qs;
  }

  const headers = resolvePairs(request.headers, ctx, missing);

  // Auth helper: builds Authorization unless a manual header is already there.
  const hasAuthHeader = headers.some((h) => h.key.toLowerCase() === "authorization");
  const auth = request.auth;
  if (auth && auth.type !== "none" && !hasAuthHeader) {
    if (auth.type === "bearer" && auth.token) {
      const token = resolveTemplate(auth.token, ctx);
      for (const m of token.missing) missing.add(m);
      headers.push({ key: "Authorization", value: `Bearer ${token.output}` });
    } else if (auth.type === "basic") {
      const user = resolveTemplate(auth.username ?? "", ctx);
      const pass = resolveTemplate(auth.password ?? "", ctx);
      for (const m of [...user.missing, ...pass.missing]) missing.add(m);
      headers.push({
        key: "Authorization",
        value: `Basic ${toBase64(`${user.output}:${pass.output}`)}`,
      });
    }
  }

  let body: string | null = null;
  if (request.bodyType === "form") {
    // Enabled rows only, like query params and headers.
    const pairs = resolvePairs(request.formBody ?? [], ctx, missing);
    body = new URLSearchParams(
      pairs.map(({ key, value }) => [key, value]),
    ).toString();
  } else if (request.bodyType !== "none" && request.body !== null) {
    const resolved = resolveTemplate(request.body, ctx);
    for (const m of resolved.missing) missing.add(m);
    body = resolved.output;
  }

  return {
    method: request.method,
    url: finalUrl,
    headers,
    body,
    missing: [...missing],
  };
}

/** A `{{` opened and not yet closed to the left of the caret. */
export interface OpenToken {
  /** Position of the `{{`. */
  start: number;
  /** Partial name already typed after it, trimmed. */
  query: string;
}

const OPEN_TOKEN = /\{\{([\w.\- ]*)$/;

/**
 * Detects whether the caret sits inside an open `{{ ... }}` — that is what
 * triggers variable autocomplete. Null when it does not.
 */
export function findOpenToken(text: string, caret: number): OpenToken | null {
  const before = text.slice(0, Math.max(0, Math.min(caret, text.length)));
  const match = before.match(OPEN_TOKEN);
  if (!match || match.index === undefined) return null;
  return { start: match.index, query: (match[1] ?? "").trim() };
}

/**
 * Swaps the open token for the chosen variable, returning the new text and the
 * caret. Eats a `}}` already ahead of the caret so braces are not doubled.
 */
export function completeToken(
  text: string,
  caret: number,
  token: OpenToken,
  name: string,
): { text: string; caret: number } {
  const closing = text.slice(caret).match(/^\s*\}\}/);
  const end = caret + (closing?.[0].length ?? 0);
  const insertion = `{{ ${name} }}`;
  return {
    text: text.slice(0, token.start) + insertion + text.slice(end),
    caret: token.start + insertion.length,
  };
}

/**
 * Ranks variables for autocomplete: prefix matches first, then substring ones,
 * alphabetical within each group. The whole list comes back on purpose —
 * cutting at N hides variables silently.
 */
export function rankVariables(names: string[], query: string): string[] {
  const q = query.toLowerCase();
  const starts: string[] = [];
  const contains: string[] = [];
  for (const name of names) {
    const lower = name.toLowerCase();
    if (!lower.includes(q)) continue;
    (lower.startsWith(q) ? starts : contains).push(name);
  }
  return [...starts.sort(), ...contains.sort()];
}
