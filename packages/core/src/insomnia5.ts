import {
  bySortKey,
  convertTemplates,
  toMethod,
  toVariables,
} from "./insomniaCommon.js";
import type { ApiRequest, Collection, Environment, KeyValue } from "./types.js";

/** Formato dos nós do export v5 (YAML) que a gente consome. */
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
  /** Presente só em pastas. */
  children?: V5Node[];
  /** Presentes só em requests. */
  url?: string;
  method?: string;
  body?: { mimeType?: string; text?: string };
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
  /** Perdas e conversões que o usuário precisa saber. */
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

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * O Insomnia usa `:id` na URL com o valor guardado à parte. A gente não tem
 * path params, então substitui o valor direto. Sem valor, o `:id` fica visível
 * pra pessoa preencher.
 */
function applyPathParams(
  url: string,
  pathParameters: V5Pair[] | undefined,
  requestName: string,
  warnings: string[],
): string {
  let out = url;
  for (const p of pathParameters ?? []) {
    const name = (p.name ?? "").trim();
    if (!name) continue;
    const value = typeof p.value === "string" ? p.value.trim() : String(p.value ?? "").trim();
    if (!value) {
      warnings.push(`"${requestName}": o path param :${name} estava vazio e ficou na URL.`);
      continue;
    }
    out = out.replace(new RegExp(`:${escapeRegex(name)}(?![\\w-])`, "g"), value);
  }
  return out;
}

/**
 * Importa um export v5 do Insomnia (arquivo YAML, `type: collection.insomnia.rest/5.0`).
 * Todo o export entra dentro de UMA collection nomeada pelo documento, e as
 * pastas aninhadas viram subpastas de verdade (`parentId`) — assim dois imports
 * não se misturam no mesmo nível da sidebar.
 */
export function importInsomniaV5(doc: unknown, opts: ImportOptions): ImportPayload {
  if (!isInsomniaV5(doc)) {
    throw new Error(
      "Não parece um export v5 do Insomnia (esperava 'type: collection.insomnia.rest/5.0').",
    );
  }

  const { projectId, makeId, now } = opts;
  const warnings: string[] = [];
  const collections: Collection[] = [];
  const requests: ApiRequest[] = [];
  let literalTokens = 0;

  // sortOrder é por pai, não global: cada nível tem a sua ordem.
  const nextSort = new Map<string, number>();
  const takeSort = (parentId: string | null) => {
    const key = parentId ?? "root";
    const at = nextSort.get(key) ?? 0;
    nextSort.set(key, at + 1);
    return at;
  };

  // Uma collection raiz por import: é ela que aparece na lista da sidebar.
  const rootId = makeId();
  collections.push({
    id: rootId,
    projectId,
    parentId: null,
    name: doc.name?.trim() || "Collection importada",
    sortOrder: takeSort(null),
    version: 1,
    updatedAt: now(),
  });

  const walk = (nodes: V5Node[], collectionId: string) => {
    for (const node of bySortKey(nodes)) {
      if (isFolder(node)) {
        const name = node.name?.trim() || "Pasta importada";
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

      const name = node.name?.trim() || "Request importada";
      const url = applyPathParams(
        convertTemplates(node.url ?? ""),
        node.pathParameters,
        name,
        warnings,
      );

      const request: ApiRequest = {
        id: makeId(),
        projectId,
        collectionId,
        name,
        method: toMethod(node.method),
        url,
        headers: toKeyValues(node.headers, makeId),
        queryParams: toKeyValues(node.parameters, makeId),
        body: node.body?.text ? convertTemplates(node.body.text) : null,
        bodyType: node.body?.text
          ? node.body.mimeType?.includes("json")
            ? "json"
            : "text"
          : "none",
        sortOrder: takeSort(collectionId),
        version: 1,
        updatedAt: now(),
      };

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
          warnings.push(`"${name}": auth do tipo "${auth.type}" não é suportada e foi ignorada.`);
        }
      }

      requests.push(request);
    }
  };

  walk(doc.collection ?? [], rootId);

  // Environments: o v5 traz um objeto base com subEnvironments dentro.
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
        name: sub.name?.trim() || "env importado",
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
      `${secretCount} variável(is) de credencial foram marcadas como secretas — o valor fica só nesta máquina e não sobe no sync.`,
    );
  }
  if (literalTokens > 0) {
    warnings.push(
      `${literalTokens} request(s) tinham token escrito direto no auth, sem variável. Considere movê-los para o environment.`,
    );
  }

  return { collections, requests, environments, warnings };
}
