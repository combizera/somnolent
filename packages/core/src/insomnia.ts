import {
  convertTemplates,
  toMethod,
  toVariables,
} from "./insomniaCommon.js";
import type { ApiRequest, Collection, Environment, KeyValue } from "./types.js";

/** Minimal shape of the Insomnia v4 export we consume. */
interface InsomniaResource {
  _id: string;
  _type: string;
  parentId: string | null;
  name?: string;
  url?: string;
  method?: string;
  headers?: { name: string; value: string; disabled?: boolean }[];
  parameters?: { name: string; value: string; disabled?: boolean }[];
  body?: {
    mimeType?: string;
    text?: string;
    /** Form bodies only: the key/value rows. */
    params?: { name: string; value: string; disabled?: boolean }[];
  };
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
 * Imports an Insomnia v4 export ("Export Data" → JSON): the whole file lands in
 * ONE collection named after its workspace, nested groups becoming subfolders.
 */
export function importInsomnia(
  json: unknown,
  opts: { projectId: string; makeId: () => string; now: () => string },
): InsomniaImport {
  const root = json as { __export_format?: number; resources?: InsomniaResource[] };
  if (!root || !Array.isArray(root.resources)) {
    throw new Error("This does not look like an Insomnia export (expected the 'resources' field).");
  }

  const { projectId, makeId, now } = opts;
  const resources = root.resources;

  // sortOrder is per parent, not global.
  const nextSort = new Map<string, number>();
  const takeSort = (parentId: string) => {
    const at = nextSort.get(parentId) ?? 0;
    nextSort.set(parentId, at + 1);
    return at;
  };

  const collections: Collection[] = [];

  // One root collection per import: it is what shows up in the sidebar list.
  const workspaceResource = resources.find((r) => r._type === "workspace");
  const rootId = makeId();
  collections.push({
    id: rootId,
    projectId,
    parentId: null,
    name: workspaceResource?.name?.trim() || "Imported collection",
    sortOrder: 0,
    version: 1,
    updatedAt: now(),
  });

  // One id of ours per group before resolving parents: a group can show up in
  // the JSON before its own parent.
  const groupIds = new Map<string, string>();
  const groups = resources.filter((r) => r._type === "request_group");
  for (const r of groups) groupIds.set(r._id, makeId());

  /** Folder owning a resource: the parent group, or the root collection. */
  const ownerOf = (resource: InsomniaResource): string =>
    groupIds.get(resource.parentId ?? "") ?? rootId;

  for (const r of groups) {
    const parentId = ownerOf(r);
    collections.push({
      id: groupIds.get(r._id)!,
      projectId,
      parentId,
      name: r.name ?? "Imported folder",
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
      name: r.name ?? "Imported request",
      method: toMethod(r.method),
      url: convertTemplates(r.url ?? ""),
      headers: toKeyValues(r.headers, makeId),
      queryParams: toKeyValues(r.parameters, makeId),
      body: isForm(r.body) || !r.body?.text ? null : convertTemplates(r.body.text),
      bodyType: bodyTypeOf(r.body),
      sortOrder: takeSort(owner),
      version: 1,
      updatedAt: now(),
    };
    if (isForm(r.body)) request.formBody = toKeyValues(r.body?.params, makeId);
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

  // Environments: the base hangs off the workspace; its children become ours.
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
      name: r.name ?? "imported env",
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
