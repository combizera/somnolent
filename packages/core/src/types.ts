export type HttpMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "HEAD"
  | "OPTIONS";

/**
 * Project: o nível de topo e a unidade que se compartilha inteira. Guarda
 * collections; o antigo `Workspace` era isto, só que implícito no cliente.
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
  /** Bearer — aceita {{vars}}. */
  token?: string;
  /** Basic — aceitam {{vars}}. */
  username?: string;
  password?: string;
}

export interface ApiRequest {
  id: string;
  projectId: string;
  collectionId: string | null;
  name: string;
  /** Anotação livre — vem do campo `description` do Insomnia. */
  description?: string;
  method: HttpMethod;
  /** Template — pode conter {{vars}}, ex.: "{{ base_url }}/v1/clients" */
  url: string;
  headers: KeyValue[];
  queryParams: KeyValue[];
  /**
   * Valores dos `:params` que aparecem na URL. A lista de nomes vem da própria
   * URL — isto aqui só guarda o que a pessoa preencheu.
   */
  pathParams?: KeyValue[];
  body: string | null;
  bodyType: "none" | "json" | "text";
  /** Auth helper — gera o header Authorization no send (header manual tem precedência). */
  auth?: RequestAuth;
  sortOrder: number;
  version: number;
  updatedAt: string;
}

export interface EnvironmentVariable {
  key: string;
  /** Valor de variáveis secretas fica só na máquina local (não sincroniza). */
  value: string;
  secret: boolean;
  enabled: boolean;
}

export interface Environment {
  id: string;
  /**
   * Collection dona — sempre uma raiz (`parentId: null`), nunca uma pasta.
   * É o que faz uma collection compartilhada chegar resolvendo as variáveis.
   */
  collectionId: string;
  name: string;
  /** O base environment é aplicado antes do ambiente ativo. */
  isBase: boolean;
  /** Cor de destaque da UI quando este ambiente está ativo (hex). */
  color?: string;
  variables: EnvironmentVariable[];
  /** Ordem escolhida pela pessoa no gerenciador (o base também entra na ordem). */
  sortOrder: number;
  version: number;
  updatedAt: string;
}
