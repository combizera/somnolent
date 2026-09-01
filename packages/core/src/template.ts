import type { ApiRequest, Environment, KeyValue } from "./types.js";

const VAR_PATTERN = /\{\{\s*([\w.-]+)\s*\}\}/g;

/** Base64 que funciona no navegador e no Node. */
function toBase64(text: string): string {
  if (typeof btoa === "function") return btoa(text);
  const BufferCtor = (globalThis as Record<string, any>)["Buffer"];
  return BufferCtor.from(text, "utf-8").toString("base64");
}

export interface ResolveResult {
  output: string;
  /** Variáveis referenciadas no template que não existem no contexto. */
  missing: string[];
}

/**
 * Monta o dicionário de valores: base environment primeiro,
 * ambiente ativo por cima (sobrescreve chaves repetidas).
 * Variáveis desabilitadas são ignoradas.
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

/** Substitui {{ var }} pelos valores do contexto. Sem lógica, só substituição. */
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

/** Lista os nomes de variáveis referenciados num template. */
export function extractVariables(template: string): string[] {
  const names: string[] = [];
  for (const match of template.matchAll(VAR_PATTERN)) {
    const name = match[1];
    if (name !== undefined && !names.includes(name)) names.push(name);
  }
  return names;
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
 * Resolve a request inteira contra o environment ativo:
 * URL, query params, headers e body, tudo com {{vars}} substituídas.
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

  const query = resolvePairs(request.queryParams, ctx, missing);
  let finalUrl = url.output;
  if (query.length > 0) {
    const qs = new URLSearchParams(
      query.map(({ key, value }) => [key, value]),
    ).toString();
    finalUrl += (finalUrl.includes("?") ? "&" : "?") + qs;
  }

  const headers = resolvePairs(request.headers, ctx, missing);

  // Auth helper: gera Authorization, a não ser que exista um header manual.
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
  if (request.bodyType !== "none" && request.body !== null) {
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

/** Um `{{` aberto e ainda não fechado à esquerda do caret. */
export interface OpenToken {
  /** Posição do `{{`. */
  start: number;
  /** Nome parcial já digitado depois dele, sem espaços nas pontas. */
  query: string;
}

const OPEN_TOKEN = /\{\{([\w.\- ]*)$/;

/**
 * Detecta se o caret está dentro de um `{{ ... }}` em aberto — é o que
 * dispara o autocomplete de variáveis. Devolve null quando não está.
 */
export function findOpenToken(text: string, caret: number): OpenToken | null {
  const before = text.slice(0, Math.max(0, Math.min(caret, text.length)));
  const match = before.match(OPEN_TOKEN);
  if (!match || match.index === undefined) return null;
  return { start: match.index, query: (match[1] ?? "").trim() };
}

/**
 * Troca o token em aberto pela variável escolhida, devolvendo o texto novo e
 * onde o caret deve ficar. Come um `}}` que já esteja à frente do caret, pra
 * não duplicar as chaves.
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
