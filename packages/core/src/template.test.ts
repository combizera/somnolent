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
  it("substitutes a simple variable", () => {
    const r = resolveTemplate("{{ base_url }}/v1/clients", {
      base_url: "https://api.staging.dev",
    });
    expect(r.output).toBe("https://api.staging.dev/v1/clients");
    expect(r.missing).toEqual([]);
  });

  it("accepts {{var}} with and without spaces", () => {
    const ctx = { a: "1", b: "2" };
    expect(resolveTemplate("{{a}}/{{ b }}", ctx).output).toBe("1/2");
  });

  it("keeps the placeholder and reports the missing variable", () => {
    const r = resolveTemplate("{{ base_url }}/x/{{ nope }}", {
      base_url: "u",
    });
    expect(r.output).toBe("u/x/{{ nope }}");
    expect(r.missing).toEqual(["nope"]);
  });

  it("does not duplicate repeated missing names", () => {
    const r = resolveTemplate("{{x}} {{x}}", {});
    expect(r.missing).toEqual(["x"]);
  });

  it("resolves the same variable several times", () => {
    const r = resolveTemplate("{{h}}//{{h}}", { h: "ok" });
    expect(r.output).toBe("ok//ok");
  });

  it("text with no variables passes through intact", () => {
    const r = resolveTemplate("https://fixo.com/path", { a: "1" });
    expect(r.output).toBe("https://fixo.com/path");
    expect(r.missing).toEqual([]);
  });
});

describe("buildContext", () => {
  it("the active environment overrides the base", () => {
    const base = makeEnv("base", { base_url: "http://localhost", tz: "utc" }, true);
    const prod = makeEnv("prod", { base_url: "https://api.prod.com" });
    expect(buildContext(base, prod)).toEqual({
      base_url: "https://api.prod.com",
      tz: "utc",
    });
  });

  it("ignores disabled variables", () => {
    const env = makeEnv("e", { on: "1" });
    env.variables.push({ key: "off", value: "2", secret: false, enabled: false });
    expect(buildContext(null, env)).toEqual({ on: "1" });
  });

  it("works with neither base nor active", () => {
    expect(buildContext(null, null)).toEqual({});
  });
});

describe("extractVariables", () => {
  it("lists unique variables in order of appearance", () => {
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

  it("resolves URL, headers and query in the active environment", () => {
    const r = resolveRequest(request, base, staging);
    expect(r.url).toBe("https://api.staging.dev/v1/clients?page=1");
    expect(r.headers).toEqual([
      { key: "Authorization", value: "Bearer stg-token" },
    ]);
    expect(r.missing).toEqual([]);
  });

  it("switching the environment switches URL and token without touching the request", () => {
    const r = resolveRequest(request, base, prod);
    expect(r.url).toBe("https://api.prod.com/v1/clients?page=1");
    expect(r.headers[0]?.value).toBe("Bearer prod-token");
  });

  it("resolves variables in the JSON body", () => {
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

  it("a form body becomes x-www-form-urlencoded, enabled rows only", () => {
    const form: ApiRequest = {
      ...request,
      method: "POST",
      bodyType: "form",
      body: null,
      queryParams: [],
      formBody: [
        { id: "1", key: "grant_type", value: "client_credentials", enabled: true },
        { id: "2", key: "client_secret", value: "{{ token }}", enabled: true },
        { id: "3", key: "scope", value: "read", enabled: false },
      ],
    };
    const r = resolveRequest(form, base, staging);
    expect(r.body).toBe("grant_type=client_credentials&client_secret=stg-token");
  });

  it("in a form, the text body is kept but never sent", () => {
    const form: ApiRequest = {
      ...request,
      bodyType: "form",
      body: '{"sobrou": "do json"}',
      queryParams: [],
      formBody: [{ id: "1", key: "a", value: "b", enabled: true }],
    };
    expect(resolveRequest(form, base, staging).body).toBe("a=b");
  });

  it("accumulates missing variables from every part", () => {
    const r = resolveRequest(request, null, null);
    expect(r.missing.sort()).toEqual(["base_url", "page", "token"]);
  });
});

describe("findOpenToken", () => {
  it("finds the {{ opened right before the caret", () => {
    const text = "{{ ba";
    expect(findOpenToken(text, text.length)).toEqual({ start: 0, query: "ba" });
  });

  it("accepts the empty {{, right after the braces open", () => {
    expect(findOpenToken("https://x/{{", 12)).toEqual({ start: 10, query: "" });
  });

  it("ignores an already closed token", () => {
    const text = "{{ base_url }}/api";
    expect(findOpenToken(text, text.length)).toBeNull();
  });

  it("uses the nearest {{ when there are several", () => {
    const text = "{{ base_url }}/x/{{ to";
    expect(findOpenToken(text, text.length)).toEqual({ start: 17, query: "to" });
  });

  it("suggests nothing outside braces", () => {
    expect(findOpenToken("/api/login", 5)).toBeNull();
  });

  it("looks only at what is left of the caret", () => {
    // caret before the `{{`
    expect(findOpenToken("abc{{ tok", 3)).toBeNull();
  });

  it("gives up when the name holds a non-variable character", () => {
    const text = "{{ tok/en";
    expect(findOpenToken(text, text.length)).toBeNull();
  });
});

describe("completeToken", () => {
  it("inserts the variable and returns the caret after it", () => {
    const text = "{{ ba";
    const token = findOpenToken(text, text.length)!;
    expect(completeToken(text, text.length, token, "base_url")).toEqual({
      text: "{{ base_url }}",
      caret: 14,
    });
  });

  it("keeps what comes after the caret", () => {
    const text = "{{ ba/api/login";
    const token = { start: 0, query: "ba" };
    expect(completeToken(text, 5, token, "base_url")).toEqual({
      text: "{{ base_url }}/api/login",
      caret: 14,
    });
  });

  it("does not double the braces when a }} is already ahead", () => {
    const text = "{{ ba }}/api";
    const token = { start: 0, query: "ba" };
    expect(completeToken(text, 5, token, "base_url")).toEqual({
      text: "{{ base_url }}/api",
      caret: 14,
    });
  });

  it("completes the second token without touching the first", () => {
    const text = "{{ base_url }}/x/{{ to";
    const token = findOpenToken(text, text.length)!;
    const out = completeToken(text, text.length, token, "token");
    expect(out.text).toBe("{{ base_url }}/x/{{ token }}");
  });
});

describe("rankVariables", () => {
  const vars = ["base_url", "token", "page_size", "client_token", "cnj"];

  it("with no query, returns them all alphabetically", () => {
    expect(rankVariables(vars, "")).toEqual([
      "base_url",
      "client_token",
      "cnj",
      "page_size",
      "token",
    ]);
  });

  it("does not cut the list — a variable late in the alphabet still shows", () => {
    const many = Array.from({ length: 40 }, (_, i) => `var_${i}`).concat("zzz_ultima");
    expect(rankVariables(many, "")).toHaveLength(41);
    expect(rankVariables(many, "")).toContain("zzz_ultima");
  });

  it("prefix matches come before substring matches", () => {
    expect(rankVariables(vars, "token")).toEqual(["token", "client_token"]);
  });

  it("ignores case", () => {
    expect(rankVariables(["Token", "BASE_URL"], "to")).toEqual(["Token"]);
  });

  it("returns empty when nothing matches", () => {
    expect(rankVariables(vars, "xyz")).toEqual([]);
  });
});

describe("path params (:id)", () => {
  it("finds the names cited in the URL, without repeats", () => {
    expect(extractPathParams("{{ base_url }}/api/pushes/:push_id/force")).toEqual(["push_id"]);
    expect(extractPathParams("/a/:x/b/:y/c/:x")).toEqual(["x", "y"]);
  });

  it("is not confused by the scheme or by a port", () => {
    expect(extractPathParams("https://api.com:8080/v1/coisas")).toEqual([]);
  });

  it("substitutes the filled value, escaping what needs it", () => {
    const out = applyPathParams("/lawsuits/:cnj/movements", { cnj: "0000832-55.2024.4.01.3202" });
    expect(out.output).toBe("/lawsuits/0000832-55.2024.4.01.3202/movements");
    expect(out.missing).toEqual([]);
  });

  it("escapes a slash in the value so no route segment is invented", () => {
    expect(applyPathParams("/oab/:oab", { oab: "511107/SP" }).output).toBe("/oab/511107%2FSP");
  });

  it("an empty param stays visible and becomes a warning", () => {
    const out = applyPathParams("/pushes/:push_id/force", { push_id: "" });
    expect(out.output).toBe("/pushes/:push_id/force");
    expect(out.missing).toEqual([":push_id"]);
  });

  it("resolveRequest joins {{var}}, :param and query in the right order", () => {
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

  it("an empty path param is no warning: it stays in the URL and the request still sends", () => {
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
    // the :push_id stays raw in the URL — that is what reaches the server
    expect(out.url).toBe("https://api.com/pushes/:push_id/force");
  });

  it("a path param value accepts {{var}} too", () => {
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

describe("query string and path params do not mix", () => {
  const prod =
    "https://captura-djen.munin.ia.br/api/v1/communications?:status=all&tracker_id=16853&published_at=2026-09-14&per_page=100";

  it("a `:` inside the query is not a path param", () => {
    expect(extractPathParams(prod)).toEqual([]);
  });

  it("a path param in the path still counts with a query in the URL", () => {
    expect(extractPathParams("/api/trackers/:id/pushes?status=all")).toEqual(["id"]);
  });

  it("filling a path param leaves what follows the `?` alone", () => {
    const out = applyPathParams("/api/trackers/:id?:status=all", { id: "16853" });
    expect(out.output).toBe("/api/trackers/16853?:status=all");
    expect(out.missing).toEqual([]);
  });

  it("splits the prod URL query into pairs", () => {
    const out = splitQueryParams(prod);
    expect(out.url).toBe("https://captura-djen.munin.ia.br/api/v1/communications");
    expect(out.params).toEqual([
      { key: ":status", value: "all" },
      { key: "tracker_id", value: "16853" },
      { key: "published_at", value: "2026-09-14" },
      { key: "per_page", value: "100" },
    ]);
  });

  it("a URL with no query is left as is", () => {
    expect(splitQueryParams("https://api.com/v1/coisas")).toEqual({
      url: "https://api.com/v1/coisas",
      params: [],
    });
  });

  it("the value comes out decoded so it is not encoded twice on send", () => {
    expect(splitQueryParams("https://api.com/x?q=a%20b&s=1%2B2").params).toEqual([
      { key: "q", value: "a b" },
      { key: "s", value: "1+2" },
    ]);
  });

  it("a pair with no value becomes an empty value, it does not vanish", () => {
    expect(splitQueryParams("https://api.com/x?debug&page=2").params).toEqual([
      { key: "debug", value: "" },
      { key: "page", value: "2" },
    ]);
  });

  it("a repeated key keeps both rows, in order", () => {
    expect(splitQueryParams("https://api.com/x?tag=a&tag=b").params).toEqual([
      { key: "tag", value: "a" },
      { key: "tag", value: "b" },
    ]);
  });

  it("a lone `?` does not swallow the URL", () => {
    expect(splitQueryParams("https://api.com/x?")).toEqual({
      url: "https://api.com/x?",
      params: [],
    });
  });
});
