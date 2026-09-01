import {
  convertTemplates,
  toMethod,
  toVariables,
} from "./insomniaCommon.js";
import type { ApiRequest, Collection, Environment, KeyValue } from "./types.js";

/** Forma mínima do export v4 do Insomnia que a gente consome. */
interface InsomniaResource {
  _id: string;
  _type: string;
  parentId: string | null;
  name?: string;
  url?: string;
  method?: string;
  headers?: { name: string; value: string; disabled?: boolean }[];
  parameters?: { name: string; value: string; disabled?: boolean }[];
  body?: { mimeType?: string; text?: string };
  data?: Record<string, unknown>;
  color?: string | null;
  authentication?: { type?: string; token?: string; username?: string; password?: string };
}

export interface InsomniaImport {
  collections: Collection[];
  requests: ApiRequest[];
  environments: Environment[];
}

function toKeyValues(
  pairs: { name: string; value: string; disabled?: boolean }[] | undefined,
  makeId: () => string,
): KeyValue[] {
  return (pairs ?? [])
    .filter((p) => p.name)
    .map((p) => ({
      id: makeId(),
      key: convertTemplates(p.name),
      value: convertTemplates(String(p.value ?? "")),
      enabled: !p.disabled,
    }));
}

/**
 * Importa um export v4 do Insomnia ("Export Data" → JSON).
 * Todo o export entra dentro de UMA collection (nomeada pelo workspace do
 * arquivo) e os grupos aninhados viram subpastas de verdade (`parentId`).
 */
export function importInsomnia(
  json: unknown,
  opts: { projectId: string; makeId: () => string; now: () => string },
): InsomniaImport {
  const root = json as { __export_format?: number; resources?: InsomniaResource[] };
  if (!root || !Array.isArray(root.resources)) {
    throw new Error("Não parece um export do Insomnia (esperava o campo 'resources').");
  }

  const { projectId, makeId, now } = opts;
  const resources = root.resources;

  // sortOrder é por pai, não global.
  const nextSort = new Map<string, number>();
  const takeSort = (parentId: string) => {
    const at = nextSort.get(parentId) ?? 0;
    nextSort.set(parentId, at + 1);
    return at;
  };

  const collections: Collection[] = [];

  // Uma collection raiz por import: é ela que aparece na lista da sidebar.
  const workspaceResource = resources.find((r) => r._type === "workspace");
  const rootId = makeId();
  collections.push({
    id: rootId,
    projectId,
    parentId: null,
    name: workspaceResource?.name?.trim() || "Collection importada",
    sortOrder: 0,
    version: 1,
    updatedAt: now(),
  });

  // Um id nosso por grupo do arquivo, antes de resolver os pais: um grupo pode
  // aparecer no JSON antes do seu pai.
  const groupIds = new Map<string, string>();
  const groups = resources.filter((r) => r._type === "request_group");
  for (const r of groups) groupIds.set(r._id, makeId());

  /** Pasta dona de um resource: o grupo pai, ou a collection raiz. */
  const ownerOf = (resource: InsomniaResource): string =>
    groupIds.get(resource.parentId ?? "") ?? rootId;

  for (const r of groups) {
    const parentId = ownerOf(r);
    collections.push({
      id: groupIds.get(r._id)!,
      projectId,
      parentId,
      name: r.name ?? "Pasta importada",
      sortOrder: takeSort(parentId),
      version: 1,
      updatedAt: now(),
    });
  }

  const requests: ApiRequest[] = [];
  for (const r of resources) {
    if (r._type !== "request") continue;
    const owner = ownerOf(r);
    const auth = r.authentication ?? {};
    const request: ApiRequest = {
      id: makeId(),
      projectId,
      collectionId: owner,
      name: r.name ?? "Request importada",
      method: toMethod(r.method),
      url: convertTemplates(r.url ?? ""),
      headers: toKeyValues(r.headers, makeId),
      queryParams: toKeyValues(r.parameters, makeId),
      body: r.body?.text ? convertTemplates(r.body.text) : null,
      bodyType: r.body?.text
        ? r.body.mimeType?.includes("json")
          ? "json"
          : "text"
        : "none",
      sortOrder: takeSort(owner),
      version: 1,
      updatedAt: now(),
    };
    if (auth.type === "bearer" && auth.token) {
      request.auth = { type: "bearer", token: convertTemplates(auth.token) };
    } else if (auth.type === "basic" && (auth.username || auth.password)) {
      request.auth = {
        type: "basic",
        username: convertTemplates(auth.username ?? ""),
        password: convertTemplates(auth.password ?? ""),
      };
    }
    requests.push(request);
  }

  // Environments: o base tem parentId = workspace; os filhos do base viram nossos envs.
  const environments: Environment[] = [];
  const envResources = resources.filter((r) => r._type === "environment");
  const workspaceIds = new Set(resources.filter((r) => r._type === "workspace").map((r) => r._id));
  const baseEnvs = envResources.filter((r) => workspaceIds.has(r.parentId ?? ""));
  const baseIds = new Set(baseEnvs.map((r) => r._id));

  for (const r of baseEnvs) {
    environments.push({
      id: makeId(),
      collectionId: rootId,
      name: "Base",
      isBase: true,
      variables: toVariables(r.data),
      sortOrder: environments.length,
      version: 1,
      updatedAt: now(),
    });
  }
  for (const r of envResources) {
    if (baseIds.has(r._id)) continue;
    environments.push({
      id: makeId(),
      collectionId: rootId,
      name: r.name ?? "env importado",
      isBase: false,
      color: r.color ?? undefined,
      variables: toVariables(r.data),
      sortOrder: environments.length,
      version: 1,
      updatedAt: now(),
    });
  }

  return { collections, requests, environments };
}
