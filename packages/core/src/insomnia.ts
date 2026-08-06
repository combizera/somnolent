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
 * Grupos aninhados são achatados no grupo de topo (só temos 1 nível de pasta).
 */
export function importInsomnia(
  json: unknown,
  opts: { workspaceId: string; makeId: () => string; now: () => string },
): InsomniaImport {
  const root = json as { __export_format?: number; resources?: InsomniaResource[] };
  if (!root || !Array.isArray(root.resources)) {
    throw new Error("Não parece um export do Insomnia (esperava o campo 'resources').");
  }

  const { workspaceId, makeId, now } = opts;
  const resources = root.resources;
  const byId = new Map(resources.map((r) => [r._id, r]));

  // Grupo de topo de cada resource: sobe a cadeia de request_groups até o último antes do workspace.
  const topGroupOf = (resource: InsomniaResource): InsomniaResource | null => {
    let current: InsomniaResource | null = null;
    let cursor: InsomniaResource | undefined =
      resource._type === "request_group" ? resource : byId.get(resource.parentId ?? "");
    while (cursor && cursor._type === "request_group") {
      current = cursor;
      cursor = byId.get(cursor.parentId ?? "");
    }
    return current;
  };

  const groupIds = new Map<string, string>();
  const collections: Collection[] = [];
  let sort = 0;
  for (const r of resources) {
    if (r._type !== "request_group") continue;
    const top = topGroupOf(r);
    if (top && top._id === r._id && !groupIds.has(r._id)) {
      const id = makeId();
      groupIds.set(r._id, id);
      collections.push({
        id,
        workspaceId,
        parentId: null,
        name: r.name ?? "Pasta importada",
        sortOrder: sort++,
        version: 1,
        updatedAt: now(),
      });
    }
  }

  const requests: ApiRequest[] = [];
  sort = 0;
  for (const r of resources) {
    if (r._type !== "request") continue;
    const top = topGroupOf(r);
    const auth = r.authentication ?? {};
    const request: ApiRequest = {
      id: makeId(),
      workspaceId,
      collectionId: top ? (groupIds.get(top._id) ?? null) : null,
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
      sortOrder: sort++,
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
      workspaceId,
      name: "Base",
      isBase: true,
      variables: toVariables(r.data),
      version: 1,
      updatedAt: now(),
    });
  }
  for (const r of envResources) {
    if (baseIds.has(r._id)) continue;
    environments.push({
      id: makeId(),
      workspaceId,
      name: r.name ?? "env importado",
      isBase: false,
      color: r.color ?? undefined,
      variables: toVariables(r.data),
      version: 1,
      updatedAt: now(),
    });
  }

  return { collections, requests, environments };
}
