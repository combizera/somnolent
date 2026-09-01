import { describe, expect, it } from "vitest";
import { importInsomnia } from "./insomnia.js";
import { parseCurl, toCurl } from "./curl.js";
import { resolveRequest } from "./template.js";
import type { ApiRequest } from "./types.js";

let counter = 0;
const opts = {
  workspaceId: "ws-1",
  makeId: () => `id-${++counter}`,
  now: () => "2026-08-04T00:00:00.000Z",
};

const insomniaExport = {
  _type: "export",
  __export_format: 4,
  resources: [
    { _id: "wrk_1", _type: "workspace", parentId: null, name: "Meu projeto" },
    { _id: "fld_1", _type: "request_group", parentId: "wrk_1", name: "Clientes" },
    { _id: "fld_2", _type: "request_group", parentId: "fld_1", name: "Aninhada" },
    {
      _id: "req_1",
      _type: "request",
      parentId: "fld_2",
      name: "Listar clientes",
      method: "GET",
      url: "{{ _.base_url }}/v1/clients",
      headers: [
        { name: "Authorization", value: "Bearer {{ _.token }}" },
        { name: "X-Off", value: "1", disabled: true },
      ],
      parameters: [{ name: "page", value: "1" }],
      body: {},
    },
    {
      _id: "req_2",
      _type: "request",
      parentId: "wrk_1",
      name: "Criar cliente",
      method: "POST",
      url: "{{ _.base_url }}/v1/clients",
      headers: [],
      body: { mimeType: "application/json", text: '{"name": "{{ _.name }}"}' },
      authentication: { type: "bearer", token: "{{ _.token }}" },
    },
    {
      _id: "env_base",
      _type: "environment",
      parentId: "wrk_1",
      name: "Base Environment",
      data: { page_size: 20 },
    },
    {
      _id: "env_stg",
      _type: "environment",
      parentId: "env_base",
      name: "Staging",
      color: "#f59e0b",
      data: { base_url: "https://stg.api.com", nested: { token: "abc" } },
    },
  ],
};

describe("importInsomnia", () => {
  const result = importInsomnia(insomniaExport, opts);

  it("põe tudo numa collection raiz com o nome do workspace do arquivo", () => {
    const roots = result.collections.filter((c) => c.parentId === null);
    expect(roots).toHaveLength(1);
    expect(roots[0]?.name).toBe("Meu projeto");

    // request solta no workspace cai na raiz
    const create = result.requests.find((r) => r.name === "Criar cliente")!;
    expect(create.collectionId).toBe(roots[0]?.id);
  });

  it("preserva grupos aninhados como subpastas", () => {
    const root = result.collections.find((c) => c.parentId === null)!;
    const clientes = result.collections.find((c) => c.name === "Clientes")!;
    const aninhada = result.collections.find((c) => c.name === "Aninhada")!;

    expect(clientes.parentId).toBe(root.id);
    expect(aninhada.parentId).toBe(clientes.id);

    // a request vivia no grupo mais profundo e continua nele
    const req = result.requests.find((r) => r.name === "Listar clientes")!;
    expect(req.collectionId).toBe(aninhada.id);
  });

  it("converte {{ _.var }} pra {{ var }} em url, headers e body", () => {
    const list = result.requests.find((r) => r.name === "Listar clientes")!;
    expect(list.url).toBe("{{ base_url }}/v1/clients");
    expect(list.headers[0]?.value).toBe("Bearer {{ token }}");

    const create = result.requests.find((r) => r.name === "Criar cliente")!;
    expect(create.body).toBe('{"name": "{{ name }}"}');
    expect(create.bodyType).toBe("json");
  });

  it("preserva headers desabilitados e auth bearer", () => {
    const list = result.requests.find((r) => r.name === "Listar clientes")!;
    expect(list.headers[1]).toMatchObject({ key: "X-Off", enabled: false });

    const create = result.requests.find((r) => r.name === "Criar cliente")!;
    expect(create.auth).toEqual({ type: "bearer", token: "{{ token }}" });
  });

  it("mapeia base environment e sub-environments (com data aninhado achatado)", () => {
    const base = result.environments.find((e) => e.isBase)!;
    expect(base.variables).toEqual([
      { key: "page_size", value: "20", secret: false, enabled: true },
    ]);

    const stg = result.environments.find((e) => !e.isBase)!;
    expect(stg.name).toBe("Staging");
    expect(stg.color).toBe("#f59e0b");
    // Chaves de credencial entram marcadas como secretas (valor não sobe no sync).
    expect(stg.variables).toContainEqual({
      key: "nested.token",
      value: "abc",
      secret: true,
      enabled: true,
    });
  });

  it("rejeita JSON que não é export do Insomnia", () => {
    expect(() => importInsomnia({ foo: 1 }, opts)).toThrow(/resources/);
  });
});

describe("parseCurl", () => {
  it("parseia método, headers, body e URL", () => {
    const parsed = parseCurl(
      `curl -X POST 'https://api.com/v1/users' -H 'Content-Type: application/json' -H 'Authorization: Bearer abc' -d '{"name":"Ana"}'`,
    );
    expect(parsed.method).toBe("POST");
    expect(parsed.url).toBe("https://api.com/v1/users");
    expect(parsed.headers).toEqual([
      { key: "Content-Type", value: "application/json" },
      { key: "Authorization", value: "Bearer abc" },
    ]);
    expect(parsed.body).toBe('{"name":"Ana"}');
    expect(parsed.bodyType).toBe("json");
  });

  it("-d sem -X vira POST; sem nada vira GET", () => {
    expect(parseCurl("curl https://a.com -d x=1").method).toBe("POST");
    expect(parseCurl("curl https://a.com").method).toBe("GET");
  });

  it("suporta continuação de linha com \\ e aspas duplas", () => {
    const parsed = parseCurl('curl "https://a.com/x" \\\n  -H "X-A: 1"');
    expect(parsed.url).toBe("https://a.com/x");
    expect(parsed.headers).toEqual([{ key: "X-A", value: "1" }]);
  });

  it("-u vira header Basic", () => {
    const parsed = parseCurl("curl https://a.com -u user:pass");
    expect(parsed.headers[0]?.value).toBe(`Basic ${btoa("user:pass")}`);
  });

  it("rejeita comando que não é curl", () => {
    expect(() => parseCurl("wget https://a.com")).toThrow(/curl/);
  });
});

describe("toCurl + auth helper", () => {
  const request: ApiRequest = {
    id: "r1",
    workspaceId: "ws-1",
    collectionId: null,
    name: "x",
    method: "POST",
    url: "https://api.com/login",
    headers: [],
    queryParams: [],
    body: '{"a":1}',
    bodyType: "json",
    auth: { type: "bearer", token: "{{ token }}" },
    sortOrder: 0,
    version: 1,
    updatedAt: "2026-08-04T00:00:00.000Z",
  };
  const env = {
    id: "e1",
    workspaceId: "ws-1",
    name: "stg",
    isBase: false,
    variables: [{ key: "token", value: "tok-123", secret: true, enabled: true }],
    version: 1,
    updatedAt: "2026-08-04T00:00:00.000Z",
  };

  it("auth bearer gera header Authorization resolvido", () => {
    const resolved = resolveRequest(request, null, env);
    expect(resolved.headers).toContainEqual({
      key: "Authorization",
      value: "Bearer tok-123",
    });
  });

  it("header Authorization manual tem precedência sobre o auth helper", () => {
    const withManual: ApiRequest = {
      ...request,
      headers: [{ id: "h1", key: "Authorization", value: "custom", enabled: true }],
    };
    const resolved = resolveRequest(withManual, null, env);
    expect(resolved.headers.filter((h) => h.key === "Authorization")).toEqual([
      { key: "Authorization", value: "custom" },
    ]);
  });

  it("auth basic gera base64 de user:pass", () => {
    const basic: ApiRequest = {
      ...request,
      auth: { type: "basic", username: "ana", password: "s3nha" },
    };
    const resolved = resolveRequest(basic, null, env);
    expect(resolved.headers).toContainEqual({
      key: "Authorization",
      value: `Basic ${btoa("ana:s3nha")}`,
    });
  });

  it("gera curl com headers e body escapados", () => {
    const resolved = resolveRequest(request, null, env);
    const cmd = toCurl(resolved);
    expect(cmd).toContain("curl -X POST 'https://api.com/login'");
    expect(cmd).toContain("-H 'Authorization: Bearer tok-123'");
    expect(cmd).toContain(`-d '{"a":1}'`);
  });

  it("curl → parse → curl é estável", () => {
    const resolved = resolveRequest(request, null, env);
    const reparsed = parseCurl(toCurl(resolved));
    expect(reparsed.method).toBe("POST");
    expect(reparsed.url).toBe("https://api.com/login");
    expect(reparsed.body).toBe('{"a":1}');
  });
});
