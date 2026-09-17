export type HttpMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "HEAD"
  | "OPTIONS";

/**
 * Project: the top level and the unit shared as a whole. Holds collections;
 * the old `Workspace` was this, only implicit in the client.
 */
export interface Project {
  id: string;
  name: string;
  sortOrder: number;
  version: number;
  updatedAt: string;
}

export interface Collection {
  id: string;
  projectId: string;
  parentId: string | null;
  name: string;
  sortOrder: number;
  version: number;
  updatedAt: string;
}

export interface KeyValue {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
}

export interface RequestAuth {
  type: "none" | "bearer" | "basic";
  /** Bearer — accepts {{vars}}. */
  token?: string;
  /** Basic — accept {{vars}}. */
  username?: string;
  password?: string;
}

export interface ApiRequest {
  id: string;
  projectId: string;
  collectionId: string | null;
  name: string;
  /** Free-form note — comes from Insomnia's `description` field. */
  description?: string;
  method: HttpMethod;
  /** Template — may contain {{vars}}, e.g. "{{ base_url }}/v1/clients" */
  url: string;
  headers: KeyValue[];
  queryParams: KeyValue[];
  /**
   * Values for the `:params` in the URL. The list of names comes from the URL
   * itself — this only holds what the person filled in.
   */
  pathParams?: KeyValue[];
  body: string | null;
  bodyType: "none" | "json" | "text" | "form";
  /** `form-urlencoded` rows. Kept apart from `body` so Form ↔ JSON loses nothing. */
  formBody?: KeyValue[];
  /** Auth helper — builds the Authorization header on send (a manual header wins). */
  auth?: RequestAuth;
  sortOrder: number;
  version: number;
  updatedAt: string;
}

export interface EnvironmentVariable {
  key: string;
  /** Secret variable values stay on the local machine only (never synced). */
  value: string;
  secret: boolean;
  enabled: boolean;
}

export interface Environment {
  id: string;
  /**
   * Owning collection — always a root (`parentId: null`), never a folder.
   * It is what makes a shared collection arrive resolving its variables.
   */
  collectionId: string;
  name: string;
  /** The base environment is applied before the active one. */
  isBase: boolean;
  /** UI accent color while this environment is active (hex). */
  color?: string;
  variables: EnvironmentVariable[];
  /** Order chosen by the person in the manager (the base is in it too). */
  sortOrder: number;
  version: number;
  updatedAt: string;
}
