import { describe, expect, it } from "vitest";
import {
  buildContext,
  applyPathParams,
  completeToken,
  extractPathParams,
  splitQueryParams,
  extractVariables,
  findOpenToken,
  rankVariables,
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
    collectionId: "col-1",
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
    projectId: "prj-1",
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

describe("findOpenToken", () => {
  it("acha o {{ aberto imediatamente antes do caret", () => {
    const text = "{{ ba";
    expect(findOpenToken(text, text.length)).toEqual({ start: 0, query: "ba" });
  });

  it("aceita o {{ vazio, logo depois de abrir as chaves", () => {
    expect(findOpenToken("https://x/{{", 12)).toEqual({ start: 10, query: "" });
  });

  it("ignora token já fechado", () => {
    const text = "{{ base_url }}/api";
    expect(findOpenToken(text, text.length)).toBeNull();
  });

  it("usa o {{ mais próximo quando há vários", () => {
    const text = "{{ base_url }}/x/{{ to";
    expect(findOpenToken(text, text.length)).toEqual({ start: 17, query: "to" });
  });

  it("não sugere fora de chaves", () => {
    expect(findOpenToken("/api/login", 5)).toBeNull();
  });

  it("olha só o que está à esquerda do caret", () => {
    // caret antes do `{{`
    expect(findOpenToken("abc{{ tok", 3)).toBeNull();
  });

  it("desiste quando o nome tem caractere que não é de variável", () => {
    const text = "{{ tok/en";
    expect(findOpenToken(text, text.length)).toBeNull();
  });
});

describe("completeToken", () => {
  it("insere a variável e devolve o caret depois dela", () => {
    const text = "{{ ba";
    const token = findOpenToken(text, text.length)!;
    expect(completeToken(text, text.length, token, "base_url")).toEqual({
      text: "{{ base_url }}",
      caret: 14,
    });
  });

  it("preserva o que vem depois do caret", () => {
    const text = "{{ ba/api/login";
    const token = { start: 0, query: "ba" };
    expect(completeToken(text, 5, token, "base_url")).toEqual({
      text: "{{ base_url }}/api/login",
      caret: 14,
    });
  });

  it("não duplica as chaves quando o }} já existe à frente", () => {
    const text = "{{ ba }}/api";
    const token = { start: 0, query: "ba" };
    expect(completeToken(text, 5, token, "base_url")).toEqual({
      text: "{{ base_url }}/api",
      caret: 14,
    });
  });

  it("completa o segundo token sem tocar no primeiro", () => {
    const text = "{{ base_url }}/x/{{ to";
    const token = findOpenToken(text, text.length)!;
    const out = completeToken(text, text.length, token, "token");
    expect(out.text).toBe("{{ base_url }}/x/{{ token }}");
  });
});

describe("rankVariables", () => {
  const vars = ["base_url", "token", "page_size", "client_token", "cnj"];

  it("sem query, devolve todas em ordem alfabética", () => {
    expect(rankVariables(vars, "")).toEqual([
      "base_url",
      "client_token",
      "cnj",
      "page_size",
      "token",
    ]);
  });

  it("não corta a lista — variável no fim do alfabeto continua aparecendo", () => {
    const many = Array.from({ length: 40 }, (_, i) => `var_${i}`).concat("zzz_ultima");
    expect(rankVariables(many, "")).toHaveLength(41);
    expect(rankVariables(many, "")).toContain("zzz_ultima");
  });

  it("quem começa com a query vem antes de quem só contém", () => {
    expect(rankVariables(vars, "token")).toEqual(["token", "client_token"]);
  });

  it("ignora caixa", () => {
    expect(rankVariables(["Token", "BASE_URL"], "to")).toEqual(["Token"]);
  });

  it("devolve vazio quando nada bate", () => {
    expect(rankVariables(vars, "xyz")).toEqual([]);
  });
});

describe("path params (:id)", () => {
  it("acha os nomes citados na URL, sem repetir", () => {
    expect(extractPathParams("{{ base_url }}/api/pushes/:push_id/force")).toEqual(["push_id"]);
    expect(extractPathParams("/a/:x/b/:y/c/:x")).toEqual(["x", "y"]);
  });

  it("não confunde com esquema nem com porta", () => {
    expect(extractPathParams("https://api.com:8080/v1/coisas")).toEqual([]);
  });

  it("substitui o valor preenchido, escapando o que precisa", () => {
    const out = applyPathParams("/lawsuits/:cnj/movements", { cnj: "0000832-55.2024.4.01.3202" });
    expect(out.output).toBe("/lawsuits/0000832-55.2024.4.01.3202/movements");
    expect(out.missing).toEqual([]);
  });

  it("escapa barra no valor pra não inventar segmento de rota", () => {
    expect(applyPathParams("/oab/:oab", { oab: "511107/SP" }).output).toBe("/oab/511107%2FSP");
  });

  it("param vazio continua visível e vira aviso", () => {
    const out = applyPathParams("/pushes/:push_id/force", { push_id: "" });
    expect(out.output).toBe("/pushes/:push_id/force");
    expect(out.missing).toEqual([":push_id"]);
  });

  it("resolveRequest junta {{var}}, :param e query na ordem certa", () => {
    const env = makeEnv("local", { base_url: "https://api.com" });
    const request: ApiRequest = {
      id: "r1",
      projectId: "prj-1",
      collectionId: "c1",
      name: "force",
      method: "POST",
      url: "{{ base_url }}/api/pushes/:push_id/force",
      headers: [],
      queryParams: [{ id: "q1", key: "dry_run", value: "true", enabled: true }],
      pathParams: [{ id: "p1", key: "push_id", value: "abc-123", enabled: true }],
      body: null,
      bodyType: "none",
      sortOrder: 0,
      version: 1,
      updatedAt: "2026-09-01T00:00:00.000Z",
    };
    const out = resolveRequest(request, null, env);
    expect(out.url).toBe("https://api.com/api/pushes/abc-123/force?dry_run=true");
    expect(out.missing).toEqual([]);
  });

  it("path param vazio não vira aviso: fica na URL e a request segue enviável", () => {
    const request: ApiRequest = {
      id: "r2",
      projectId: "prj-1",
      collectionId: "c1",
      name: "force",
      method: "POST",
      url: "https://api.com/pushes/:push_id/force",
      headers: [],
      queryParams: [],
      pathParams: [],
      body: null,
      bodyType: "none",
      sortOrder: 0,
      version: 1,
      updatedAt: "2026-09-01T00:00:00.000Z",
    };
    const out = resolveRequest(request, null, null);
    expect(out.missing).toEqual([]);
    // o :push_id continua cru na URL — é o que vai pro servidor
    expect(out.url).toBe("https://api.com/pushes/:push_id/force");
  });

  it("o valor do path param também aceita {{var}}", () => {
    const env = makeEnv("local", { tenant: "advbox" });
    const request: ApiRequest = {
      id: "r3",
      projectId: "prj-1",
      collectionId: "c1",
      name: "x",
      method: "GET",
      url: "https://api.com/:tenant/lawyers",
      headers: [],
      queryParams: [],
      pathParams: [{ id: "p1", key: "tenant", value: "{{ tenant }}", enabled: true }],
      body: null,
      bodyType: "none",
      sortOrder: 0,
      version: 1,
      updatedAt: "2026-09-01T00:00:00.000Z",
    };
    expect(resolveRequest(request, null, env).url).toBe("https://api.com/advbox/lawyers");
  });
});

describe("query string e path params não se misturam", () => {
  const prod =
    "https://captura-djen.munin.ia.br/api/v1/communications?:status=all&tracker_id=16853&published_at=2026-09-14&per_page=100";

  it("`:` dentro da query não é path param", () => {
    expect(extractPathParams(prod)).toEqual([]);
  });

  it("path param no caminho continua valendo mesmo com query na URL", () => {
    expect(extractPathParams("/api/trackers/:id/pushes?status=all")).toEqual(["id"]);
  });

  it("preencher um path param não mexe no que está depois do `?`", () => {
    const out = applyPathParams("/api/trackers/:id?:status=all", { id: "16853" });
    expect(out.output).toBe("/api/trackers/16853?:status=all");
    expect(out.missing).toEqual([]);
  });

  it("separa a query da URL de prod em pares", () => {
    const out = splitQueryParams(prod);
    expect(out.url).toBe("https://captura-djen.munin.ia.br/api/v1/communications");
    expect(out.params).toEqual([
      { key: ":status", value: "all" },
      { key: "tracker_id", value: "16853" },
      { key: "published_at", value: "2026-09-14" },
      { key: "per_page", value: "100" },
    ]);
  });

  it("URL sem query fica como está", () => {
    expect(splitQueryParams("https://api.com/v1/coisas")).toEqual({
      url: "https://api.com/v1/coisas",
      params: [],
    });
  });

  it("valor sai decodificado pra não encodar de novo no envio", () => {
    expect(splitQueryParams("https://api.com/x?q=a%20b&s=1%2B2").params).toEqual([
      { key: "q", value: "a b" },
      { key: "s", value: "1+2" },
    ]);
  });

  it("par sem valor vira valor vazio, não some", () => {
    expect(splitQueryParams("https://api.com/x?debug&page=2").params).toEqual([
      { key: "debug", value: "" },
      { key: "page", value: "2" },
    ]);
  });

  it("chave repetida mantém as duas linhas, na ordem", () => {
    expect(splitQueryParams("https://api.com/x?tag=a&tag=b").params).toEqual([
      { key: "tag", value: "a" },
      { key: "tag", value: "b" },
    ]);
  });

  it("`?` sozinho não engole a URL", () => {
    expect(splitQueryParams("https://api.com/x?")).toEqual({
      url: "https://api.com/x?",
      params: [],
    });
  });
});
