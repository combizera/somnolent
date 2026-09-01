import { describe, expect, it } from "vitest";
import {
  buildContext,
  extractVariables,
  resolveRequest,
  resolveTemplate,
} from "./template.js";
import type { ApiRequest, Environment } from "./types.js";

function makeEnv(
  name: string,
  vars: Record<string, string>,
  isBase = false,
): Environment {
  return {
    id: `env-${name}`,
    workspaceId: "ws-1",
    name,
    isBase,
    variables: Object.entries(vars).map(([key, value]) => ({
      key,
      value,
      secret: false,
      enabled: true,
    })),
    sortOrder: 0,
    version: 1,
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

describe("resolveTemplate", () => {
  it("substitui uma variável simples", () => {
    const r = resolveTemplate("{{ base_url }}/v1/clients", {
      base_url: "https://api.staging.dev",
    });
    expect(r.output).toBe("https://api.staging.dev/v1/clients");
    expect(r.missing).toEqual([]);
  });

  it("aceita {{var}} sem espaços e com espaços", () => {
    const ctx = { a: "1", b: "2" };
    expect(resolveTemplate("{{a}}/{{ b }}", ctx).output).toBe("1/2");
  });

  it("mantém o placeholder e reporta variável faltante", () => {
    const r = resolveTemplate("{{ base_url }}/x/{{ nope }}", {
      base_url: "u",
    });
    expect(r.output).toBe("u/x/{{ nope }}");
    expect(r.missing).toEqual(["nope"]);
  });

  it("não duplica faltantes repetidas", () => {
    const r = resolveTemplate("{{x}} {{x}}", {});
    expect(r.missing).toEqual(["x"]);
  });

  it("resolve a mesma variável múltiplas vezes", () => {
    const r = resolveTemplate("{{h}}//{{h}}", { h: "ok" });
    expect(r.output).toBe("ok//ok");
  });

  it("texto sem variáveis passa intacto", () => {
    const r = resolveTemplate("https://fixo.com/path", { a: "1" });
    expect(r.output).toBe("https://fixo.com/path");
    expect(r.missing).toEqual([]);
  });
});

describe("buildContext", () => {
  it("ambiente ativo sobrescreve o base", () => {
    const base = makeEnv("base", { base_url: "http://localhost", tz: "utc" }, true);
    const prod = makeEnv("prod", { base_url: "https://api.prod.com" });
    expect(buildContext(base, prod)).toEqual({
      base_url: "https://api.prod.com",
      tz: "utc",
    });
  });

  it("ignora variáveis desabilitadas", () => {
    const env = makeEnv("e", { on: "1" });
    env.variables.push({ key: "off", value: "2", secret: false, enabled: false });
    expect(buildContext(null, env)).toEqual({ on: "1" });
  });

  it("funciona sem base e sem ativo", () => {
    expect(buildContext(null, null)).toEqual({});
  });
});

describe("extractVariables", () => {
  it("lista variáveis únicas na ordem de aparição", () => {
    expect(extractVariables("{{a}}/{{ b }}/{{a}}")).toEqual(["a", "b"]);
  });
});

describe("resolveRequest", () => {
  const request: ApiRequest = {
    id: "req-1",
    workspaceId: "ws-1",
    collectionId: null,
    name: "List clients",
    method: "GET",
    url: "{{ base_url }}/v1/clients",
    headers: [
      {
        id: "h1",
        key: "Authorization",
        value: "Bearer {{ token }}",
        enabled: true,
      },
      { id: "h2", key: "X-Debug", value: "1", enabled: false },
    ],
    queryParams: [
      { id: "q1", key: "page", value: "{{ page }}", enabled: true },
    ],
    body: null,
    bodyType: "none",
    sortOrder: 0,
    version: 1,
    updatedAt: "2026-01-01T00:00:00Z",
  };

  const base = makeEnv("base", { page: "1" }, true);
  const staging = makeEnv("staging", {
    base_url: "https://api.staging.dev",
    token: "stg-token",
  });
  const prod = makeEnv("prod", {
    base_url: "https://api.prod.com",
    token: "prod-token",
  });

  it("resolve URL, headers e query no ambiente ativo", () => {
    const r = resolveRequest(request, base, staging);
    expect(r.url).toBe("https://api.staging.dev/v1/clients?page=1");
    expect(r.headers).toEqual([
      { key: "Authorization", value: "Bearer stg-token" },
    ]);
    expect(r.missing).toEqual([]);
  });

  it("trocar o environment troca URL e token sem tocar na request", () => {
    const r = resolveRequest(request, base, prod);
    expect(r.url).toBe("https://api.prod.com/v1/clients?page=1");
    expect(r.headers[0]?.value).toBe("Bearer prod-token");
  });

  it("resolve variáveis no body JSON", () => {
    const withBody: ApiRequest = {
      ...request,
      method: "POST",
      bodyType: "json",
      body: '{"env": "{{ token }}"}',
      queryParams: [],
    };
    const r = resolveRequest(withBody, base, staging);
    expect(r.body).toBe('{"env": "stg-token"}');
  });

  it("acumula variáveis faltantes de todas as partes", () => {
    const r = resolveRequest(request, null, null);
    expect(r.missing.sort()).toEqual(["base_url", "page", "token"]);
  });
});
