import { describe, expect, it } from "vitest";
import { importInsomnia } from "./insomnia.js";
import { parseCurl, toCurl } from "./curl.js";
import { resolveRequest } from "./template.js";
import type { ApiRequest } from "./types.js";

let counter = 0;
const opts = {
  projectId: "prj-1",
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
      _id: "req_3",
      _type: "request",
      parentId: "wrk_1",
      name: "Token",
      method: "POST",
      url: "{{ _.base_url }}/oauth/token",
      headers: [],
      body: {
        mimeType: "application/x-www-form-urlencoded",
        params: [
          { name: "grant_type", value: "client_credentials" },
          { name: "client_id", value: "{{ _.client_id }}" },
          { name: "scope", value: "read", disabled: true },
        ],
      },
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

  it("puts everything in a root collection named after the file workspace", () => {
    const roots = result.collections.filter((c) => c.parentId === null);
    expect(roots).toHaveLength(1);
    expect(roots[0]?.name).toBe("Meu projeto");

    // a request loose in the workspace lands in the root
    const create = result.requests.find((r) => r.name === "Criar cliente")!;
    expect(create.collectionId).toBe(roots[0]?.id);
  });

  it("keeps nested groups as subfolders", () => {
    const root = result.collections.find((c) => c.parentId === null)!;
    const clientes = result.collections.find((c) => c.name === "Clientes")!;
    const aninhada = result.collections.find((c) => c.name === "Aninhada")!;

    expect(clientes.parentId).toBe(root.id);
    expect(aninhada.parentId).toBe(clientes.id);

    // the request lived in the deepest group and stays there
    const req = result.requests.find((r) => r.name === "Listar clientes")!;
    expect(req.collectionId).toBe(aninhada.id);
  });

  it("converts {{ _.var }} to {{ var }} in url, headers and body", () => {
    const list = result.requests.find((r) => r.name === "Listar clientes")!;
    expect(list.url).toBe("{{ base_url }}/v1/clients");
    expect(list.headers[0]?.value).toBe("Bearer {{ token }}");

    const create = result.requests.find((r) => r.name === "Criar cliente")!;
    expect(create.body).toBe('{"name": "{{ name }}"}');
    expect(create.bodyType).toBe("json");
  });

  it("a form body becomes bodyType form with the rows in formBody", () => {
    const token = result.requests.find((r) => r.name === "Token")!;
    expect(token.bodyType).toBe("form");
    // Text stays null: a form is its rows.
    expect(token.body).toBeNull();
    expect(token.formBody).toEqual([
      { id: expect.any(String), key: "grant_type", value: "client_credentials", enabled: true },
      { id: expect.any(String), key: "client_id", value: "{{ client_id }}", enabled: true },
      { id: expect.any(String), key: "scope", value: "read", enabled: false },
    ]);
  });

  it("keeps disabled headers and bearer auth", () => {
    const list = result.requests.find((r) => r.name === "Listar clientes")!;
    expect(list.headers[1]).toMatchObject({ key: "X-Off", enabled: false });

    const create = result.requests.find((r) => r.name === "Criar cliente")!;
    expect(create.auth).toEqual({ type: "bearer", token: "{{ token }}" });
  });

  it("maps base environment and sub-environments (nested data flattened)", () => {
    const base = result.environments.find((e) => e.isBase)!;
    expect(base.variables).toEqual([
      { key: "page_size", value: "20", secret: false, enabled: true },
    ]);

    const stg = result.environments.find((e) => !e.isBase)!;
    expect(stg.name).toBe("Staging");
    expect(stg.color).toBe("#f59e0b");
    // Credential keys come in marked as secret (the value never goes up in the sync).
    expect(stg.variables).toContainEqual({
      key: "nested.token",
      value: "abc",
      secret: true,
      enabled: true,
    });
  });

  it("rejects JSON that is not an Insomnia export", () => {
    expect(() => importInsomnia({ foo: 1 }, opts)).toThrow(/resources/);
  });
});

describe("parseCurl", () => {
  it("parses method, headers, body and URL", () => {
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

  it("-d without -X becomes POST; nothing at all becomes GET", () => {
    expect(parseCurl("curl https://a.com -d x=1").method).toBe("POST");
    expect(parseCurl("curl https://a.com").method).toBe("GET");
  });

  it("supports line continuation with \\ and double quotes", () => {
    const parsed = parseCurl('curl "https://a.com/x" \\\n  -H "X-A: 1"');
    expect(parsed.url).toBe("https://a.com/x");
    expect(parsed.headers).toEqual([{ key: "X-A", value: "1" }]);
  });

  it("-u becomes a Basic header", () => {
    const parsed = parseCurl("curl https://a.com -u user:pass");
    expect(parsed.headers[0]?.value).toBe(`Basic ${btoa("user:pass")}`);
  });

  it("rejects a command that is not curl", () => {
    expect(() => parseCurl("wget https://a.com")).toThrow(/curl/);
  });
});

describe("toCurl + auth helper", () => {
  const request: ApiRequest = {
    id: "r1",
    projectId: "prj-1",
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
    collectionId: "col-1",
    name: "stg",
    isBase: false,
    variables: [{ key: "token", value: "tok-123", secret: true, enabled: true }],
    sortOrder: 0,
    version: 1,
    updatedAt: "2026-08-04T00:00:00.000Z",
  };

  it("bearer auth builds a resolved Authorization header", () => {
    const resolved = resolveRequest(request, null, env);
    expect(resolved.headers).toContainEqual({
      key: "Authorization",
      value: "Bearer tok-123",
    });
  });

  it("a manual Authorization header wins over the auth helper", () => {
    const withManual: ApiRequest = {
      ...request,
      headers: [{ id: "h1", key: "Authorization", value: "custom", enabled: true }],
    };
    const resolved = resolveRequest(withManual, null, env);
    expect(resolved.headers.filter((h) => h.key === "Authorization")).toEqual([
      { key: "Authorization", value: "custom" },
    ]);
  });

  it("basic auth builds base64 of user:pass", () => {
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

  it("builds curl with escaped headers and body", () => {
    const resolved = resolveRequest(request, null, env);
    const cmd = toCurl(resolved);
    expect(cmd).toContain("curl -X POST 'https://api.com/login'");
    expect(cmd).toContain("-H 'Authorization: Bearer tok-123'");
    expect(cmd).toContain(`-d '{"a":1}'`);
  });

  it("the URL query becomes param rows, and the URL is left clean", () => {
    const parsed = parseCurl(
      "curl 'https://captura-djen.munin.ia.br/api/v1/communications?:status=all&tracker_id=16853&per_page=100'",
    );
    expect(parsed.url).toBe("https://captura-djen.munin.ia.br/api/v1/communications");
    expect(parsed.queryParams).toEqual([
      { key: ":status", value: "all" },
      { key: "tracker_id", value: "16853" },
      { key: "per_page", value: "100" },
    ]);
  });

  it("a curl with no query gains no param", () => {
    expect(parseCurl("curl https://a.com/x").queryParams).toEqual([]);
  });

  it("curl → parse → curl is stable", () => {
    const resolved = resolveRequest(request, null, env);
    const reparsed = parseCurl(toCurl(resolved));
    expect(reparsed.method).toBe("POST");
    expect(reparsed.url).toBe("https://api.com/login");
    expect(reparsed.body).toBe('{"a":1}');
  });
});
