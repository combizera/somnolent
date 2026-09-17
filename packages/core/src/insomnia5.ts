import {
  bySortKey,
  convertTemplates,
  toMethod,
  toVariables,
} from "./insomniaCommon.js";
import type { ApiRequest, Collection, Environment, KeyValue } from "./types.js";

/** Shape of the v5 export (YAML) nodes we consume. */
interface V5Meta {
  id?: string;
  sortKey?: number;
  description?: string;
}

interface V5Pair {
  name?: string;
  value?: unknown;
  disabled?: boolean;
}

interface V5Node {
  name?: string;
  meta?: V5Meta;
  /** Folders only. */
  children?: V5Node[];
  /** Requests only. */
  url?: string;
  method?: string;
  body?: { mimeType?: string; text?: string; params?: V5Pair[] };
  headers?: V5Pair[];
  parameters?: V5Pair[];
  pathParameters?: V5Pair[];
  authentication?: {
    type?: string;
    token?: string;
    username?: string;
    password?: string;
    disabled?: boolean;
  };
}

interface V5Environment {
  name?: string;
  data?: Record<string, unknown>;
  color?: string;
  subEnvironments?: V5Environment[];
}

interface V5Document {
  type?: string;
  schema_version?: string | number;
  name?: string;
  collection?: V5Node[];
  environments?: V5Environment;
}

export interface ImportPayload {
  collections: Collection[];
  requests: ApiRequest[];
  environments: Environment[];
  /** Losses and conversions the user needs to know about. */
  warnings: string[];
}

export interface ImportOptions {
  projectId: string;
  makeId: () => string;
  now: () => string;
}

export function isInsomniaV5(doc: unknown): doc is V5Document {
  const type = (doc as V5Document | null)?.type;
  return typeof type === "string" && type.startsWith("collection.insomnia.rest");
}

function isFolder(node: V5Node): boolean {
  return Array.isArray(node.children) || (node.url === undefined && node.method === undefined);
}

function toKeyValues(pairs: V5Pair[] | undefined, makeId: () => string): KeyValue[] {
  return (pairs ?? [])
    .filter((p) => (p.name ?? "").trim())
    .map((p) => ({
      id: makeId(),
      key: convertTemplates(p.name!),
      value: convertTemplates(
        typeof p.value === "string" ? p.value : String(p.value ?? ""),
      ),
      enabled: !p.disabled,
    }));
}

/** Insomnia form bodies carry their rows in `params`, not `text`. */
function isForm(body: { mimeType?: string } | undefined): boolean {
  return body?.mimeType?.includes("form-urlencoded") ?? false;
}

function bodyTypeOf(
  body: { mimeType?: string; text?: string } | undefined,
): ApiRequest["bodyType"] {
  if (isForm(body)) return "form";
  if (!body?.text) return "none";
  return body.mimeType?.includes("json") ? "json" : "text";
}

/**
 * Imports an Insomnia v5 export (YAML, `type: collection.insomnia.rest/5.0`):
 * the whole file lands in ONE collection named after the document, nested
 * folders becoming real subfolders so two imports never mix in the sidebar.
 */
export function importInsomniaV5(doc: unknown, opts: ImportOptions): ImportPayload {
  if (!isInsomniaV5(doc)) {
    throw new Error(
      "This does not look like an Insomnia v5 export (expected 'type: collection.insomnia.rest/5.0').",
    );
  }

  const { projectId, makeId, now } = opts;
  const warnings: string[] = [];
  const collections: Collection[] = [];
  const requests: ApiRequest[] = [];
  let literalTokens = 0;

  // sortOrder is per parent, not global: each level has its own order.
  const nextSort = new Map<string, number>();
  const takeSort = (parentId: string | null) => {
    const key = parentId ?? "root";
    const at = nextSort.get(key) ?? 0;
    nextSort.set(key, at + 1);
    return at;
  };

  // One root collection per import: it is what shows up in the sidebar list.
  const rootId = makeId();
  collections.push({
    id: rootId,
    projectId,
    parentId: null,
    name: doc.name?.trim() || "Imported collection",
    sortOrder: takeSort(null),
    version: 1,
    updatedAt: now(),
  });

  const walk = (nodes: V5Node[], collectionId: string) => {
    for (const node of bySortKey(nodes)) {
      if (isFolder(node)) {
        const name = node.name?.trim() || "Imported folder";
        const id = makeId();
        collections.push({
          id,
          projectId,
          parentId: collectionId,
          name,
          sortOrder: takeSort(collectionId),
          version: 1,
          updatedAt: now(),
        });
        walk(node.children ?? [], id);
        continue;
      }

      const name = node.name?.trim() || "Imported request";
      // `:id` stays in the URL: `pathParams` is what holds the value.
      const url = convertTemplates(node.url ?? "");

      const request: ApiRequest = {
        id: makeId(),
        projectId,
        collectionId,
        name,
        method: toMethod(node.method),
        url,
        headers: toKeyValues(node.headers, makeId),
        queryParams: toKeyValues(node.parameters, makeId),
        pathParams: toKeyValues(node.pathParameters, makeId),
        body: isForm(node.body) || !node.body?.text ? null : convertTemplates(node.body.text),
        bodyType: bodyTypeOf(node.body),
        sortOrder: takeSort(collectionId),
        version: 1,
        updatedAt: now(),
      };

      if (isForm(node.body)) request.formBody = toKeyValues(node.body?.params, makeId);

      const description = node.meta?.description?.trim();
      if (description) request.description = description;

      const auth = node.authentication;
      if (auth && !auth.disabled) {
        if (auth.type === "bearer" && auth.token) {
          const token = convertTemplates(auth.token);
          request.auth = { type: "bearer", token };
          if (!token.includes("{{")) literalTokens++;
        } else if (auth.type === "basic" && (auth.username || auth.password)) {
          request.auth = {
            type: "basic",
            username: convertTemplates(auth.username ?? ""),
            password: convertTemplates(auth.password ?? ""),
          };
        } else if (auth.type && auth.type !== "none") {
          warnings.push(`"${name}": "${auth.type}" auth is not supported and was ignored.`);
        }
      }

      requests.push(request);
    }
  };

  walk(doc.collection ?? [], rootId);

  // Environments: v5 ships a base object with subEnvironments inside.
  const environments: Environment[] = [];
  const root = doc.environments;
  if (root) {
    environments.push({
      id: makeId(),
      collectionId: rootId,
      name: "Base",
      isBase: true,
      variables: toVariables(root.data),
      sortOrder: 0,
      version: 1,
      updatedAt: now(),
    });
    for (const sub of bySortKey((root.subEnvironments ?? []) as (V5Environment & { meta?: V5Meta })[])) {
      environments.push({
        id: makeId(),
        collectionId: rootId,
        name: sub.name?.trim() || "imported env",
        isBase: false,
        color: sub.color ?? undefined,
        variables: toVariables(sub.data),
        sortOrder: environments.length,
        version: 1,
        updatedAt: now(),
      });
    }
  }

  const secretCount = environments
    .flatMap((e) => e.variables)
    .filter((v) => v.secret).length;
  if (secretCount > 0) {
    warnings.push(
      `${secretCount} credential variable(s) were marked as secret — the value stays on this machine and does not go up in the sync.`,
    );
  }
  if (literalTokens > 0) {
    warnings.push(
      `${literalTokens} request(s) had a token written straight into auth, with no variable. Consider moving them to the environment.`,
    );
  }

  return { collections, requests, environments, warnings };
}
