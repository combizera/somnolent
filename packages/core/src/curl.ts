import type { HttpMethod, KeyValue } from "./types.js";
import { splitQueryParams } from "./template.js";
import type { ResolvedRequest } from "./template.js";

export interface ParsedCurl {
  method: HttpMethod;
  /** Without the query string — it comes apart in `queryParams`. */
  url: string;
  queryParams: { key: string; value: string }[];
  headers: { key: string; value: string }[];
  body: string | null;
  bodyType: "none" | "json" | "text";
}

const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

/** Tokenizes a command line, honoring single/double quotes and \ line breaks. */
function tokenize(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let has = false;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!;
    if (quote) {
      if (ch === quote) quote = null;
      else if (ch === "\\" && quote === '"' && command[i + 1] === '"') {
        current += '"';
        i++;
      } else current += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      has = true;
      continue;
    }
    if (ch === "\\" && (command[i + 1] === "\n" || command[i + 1] === "\r")) {
      i += command[i + 1] === "\r" && command[i + 2] === "\n" ? 2 : 1;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current || has) tokens.push(current);
      current = "";
      has = false;
      continue;
    }
    current += ch;
  }
  if (current || has) tokens.push(current);
  return tokens;
}

/** Imports a `curl ...` command into a request. Supports -X, -H, -d/--data*, -u, --url.
 *  The URL query string becomes query param rows — that is where it can be edited. */
export function parseCurl(command: string): ParsedCurl {
  const tokens = tokenize(command.trim());
  if (tokens[0] !== "curl") throw new Error("The command must start with 'curl'.");

  let method: string | null = null;
  let url = "";
  const headers: { key: string; value: string }[] = [];
  let body: string | null = null;
  let basicUser: string | null = null;

  const next = (i: number): string => tokens[i + 1] ?? "";

  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i]!;
    switch (t) {
      case "-X":
      case "--request":
        method = next(i).toUpperCase();
        i++;
        break;
      case "-H":
      case "--header": {
        const raw = next(i);
        const sep = raw.indexOf(":");
        if (sep > 0) {
          headers.push({ key: raw.slice(0, sep).trim(), value: raw.slice(sep + 1).trim() });
        }
        i++;
        break;
      }
      case "-d":
      case "--data":
      case "--data-raw":
      case "--data-binary":
      case "--data-ascii":
        body = body === null ? next(i) : `${body}&${next(i)}`;
        i++;
        break;
      case "-u":
      case "--user":
        basicUser = next(i);
        i++;
        break;
      case "--url":
        url = next(i);
        i++;
        break;
      case "-F":
      case "--form":
      case "-o":
      case "--output":
      case "-A":
      case "--user-agent":
      case "-e":
      case "--referer":
      case "-b":
      case "--cookie":
      case "--connect-timeout":
      case "--max-time":
        i++; // flags with an argument we ignore
        break;
      default:
        if (!t.startsWith("-") && !url) url = t;
    }
  }

  if (!url) throw new Error("No URL found in the curl command.");
  if (basicUser !== null) {
    const b64 =
      typeof btoa === "function"
        ? btoa(basicUser.includes(":") ? basicUser : `${basicUser}:`)
        : (globalThis as Record<string, any>)["Buffer"]
            .from(basicUser.includes(":") ? basicUser : `${basicUser}:`, "utf-8")
            .toString("base64");
    headers.push({ key: "Authorization", value: `Basic ${b64}` });
  }

  const finalMethod = method ?? (body !== null ? "POST" : "GET");
  const contentType = headers.find((h) => h.key.toLowerCase() === "content-type")?.value ?? "";
  const looksJson =
    contentType.includes("json") || (body !== null && /^\s*[[{]/.test(body));

  const split = splitQueryParams(url);

  return {
    method: (METHODS.has(finalMethod) ? finalMethod : "GET") as HttpMethod,
    url: split.url,
    queryParams: split.params,
    headers,
    body,
    bodyType: body === null ? "none" : looksJson ? "json" : "text",
  };
}

function shellQuote(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

/** Builds a curl command from an already resolved request (vars substituted). */
export function toCurl(resolved: ResolvedRequest): string {
  const parts = [`curl -X ${resolved.method} ${shellQuote(resolved.url)}`];
  for (const h of resolved.headers) {
    if (h.key.trim()) parts.push(`-H ${shellQuote(`${h.key}: ${h.value}`)}`);
  }
  if (resolved.body !== null && !["GET", "HEAD"].includes(resolved.method)) {
    parts.push(`-d ${shellQuote(resolved.body)}`);
  }
  return parts.join(" \\\n  ");
}

/** Converts the parseCurl headers into the app's KeyValue shape. */
export function curlHeadersToKeyValues(
  parsed: ParsedCurl,
  makeId: () => string,
): KeyValue[] {
  return parsed.headers.map((h) => ({ id: makeId(), key: h.key, value: h.value, enabled: true }));
}

/** Same for the query params that came from the URL. */
export function curlQueryToKeyValues(
  parsed: ParsedCurl,
  makeId: () => string,
): KeyValue[] {
  return parsed.queryParams.map((p) => ({
    id: makeId(),
    key: p.key,
    value: p.value,
    enabled: true,
  }));
}
