import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { importInsomniaExport, type ImportResult } from "./importer.js";
import { importInsomniaV5, isInsomniaV5 } from "./insomnia5.js";

const fixture = readFileSync(
  fileURLToPath(new URL("./__fixtures__/catcher-intimations.yaml", import.meta.url)),
  "utf-8",
);

let counter = 0;
const opts = {
  projectId: "prj-1",
  makeId: () => `id-${++counter}`,
  now: () => "2026-08-04T00:00:00.000Z",
};

describe("importInsomniaExport — arquivo real do Insomnia v5", () => {
  let result: ImportResult;

  beforeAll(async () => {
    result = await importInsomniaExport(fixture, opts);
  });

  it("detecta o formato v5 e o nome da collection", () => {
    expect(result.format).toBe("insomnia-v5");
    expect(result.sourceName).toBe("Catcher - Intimations");
  });

  it("importa todas as 11 requests do arquivo", () => {
    expect(result.requests).toHaveLength(11);
  });

  it("cria uma collection raiz com o nome do documento", () => {
    const roots = result.collections.filter((c) => c.parentId === null);
    expect(roots).toHaveLength(1);
    expect(roots[0]!.name).toBe("Catcher - Intimations");
  });

  it("mantém as pastas aninhadas como subpastas, não achatadas no nome", () => {
    const root = result.collections.find((c) => c.parentId === null)!;
    const trackers = result.collections.find((c) => c.name === "Trackers")!;
    const intimations = result.collections.find((c) => c.name === "Intimations")!;

    expect(trackers.parentId).toBe(root.id);
    expect(intimations.parentId).toBe(trackers.id);
    expect(result.collections.map((c) => c.name)).toEqual([
      "Catcher - Intimations",
      "Trackers",
      "Intimations",
    ]);
  });

  it("request fora de pasta fica na collection raiz", () => {
    const root = result.collections.find((c) => c.parentId === null)!;
    const account = result.requests.find((r) => r.name === "Account Detail")!;
    expect(account.collectionId).toBe(root.id);
    expect(account.method).toBe("GET");
  });

  it("liga cada request à pasta certa", () => {
    const trackers = result.collections.find((c) => c.name === "Trackers")!;
    const intimations = result.collections.find((c) => c.name === "Intimations")!;

    expect(result.requests.find((r) => r.name === "Create Tracker")!.collectionId).toBe(
      trackers.id,
    );
    expect(
      result.requests.find((r) => r.name === "List all Intimations")!.collectionId,
    ).toBe(intimations.id);
  });

  it("converte {{ _.var }} para {{ var }} na URL e no auth", () => {
    const account = result.requests.find((r) => r.name === "Account Detail")!;
    expect(account.url).toBe("{{ base_url }}/account");
    expect(account.auth).toEqual({ type: "bearer", token: "{{ token_staging }}" });
  });

  it("substitui path params pelo valor guardado", () => {
    const detail = result.requests.find((r) => r.name === "List Tracker Detail")!;
    expect(detail.url).toBe("{{ base_url }}/trackers/8684");

    const update = result.requests.find((r) => r.name === "Update Tracker")!;
    expect(update.url).toBe("{{ base_url }}/trackers/1164");
  });

  it("path param vazio permanece na URL e vira aviso", () => {
    const byTracker = result.requests.find(
      (r) => r.name === "List Intimations by Tracker",
    )!;
    expect(byTracker.url).toBe("{{ base_url }}/trackers/:id/communications");
    expect(result.warnings.some((w) => w.includes("List Intimations by Tracker"))).toBe(
      true,
    );
  });

  it("preserva query params desabilitados", () => {
    const list = result.requests.find((r) => r.name === "List all Trackers")!;
    expect(list.queryParams).toHaveLength(4);
    expect(list.queryParams.every((p) => !p.enabled)).toBe(true);
    expect(list.queryParams.map((p) => p.key)).toEqual(["remote_id", "q", "active", "type"]);
  });

  it("mistura params ligados e desligados corretamente", () => {
    const all = result.requests.find((r) => r.name === "List all Intimations")!;
    const enabled = all.queryParams.filter((p) => p.enabled).map((p) => p.key);
    expect(enabled).toEqual(["status", "tracker_id"]);
  });

  it("importa body JSON e header Content-Type", () => {
    const create = result.requests.find((r) => r.name === "Create Tracker")!;
    expect(create.bodyType).toBe("json");
    expect(create.body).toContain('"oab_number": "123456"');
    expect(create.headers).toEqual([
      expect.objectContaining({ key: "Content-Type", value: "application/json" }),
    ]);
  });

  it("guarda a descrição da request", () => {
    const busca = result.requests.find((r) => r.name === "Search Intimations by Name")!;
    expect(busca.description).toContain("NÃO migrou pra inglês");
  });

  it("importa base environment e sub-environments com cor", () => {
    expect(result.environments.map((e) => e.name)).toEqual([
      "Base",
      "Staging",
      "Production",
    ]);
    const [base, staging, prod] = result.environments;
    expect(base!.isBase).toBe(true);
    expect(staging!.color).toBe("#f9f001");
    expect(prod!.color).toBe("#e10505");
  });

  it("prende os environments na collection raiz, não no project", () => {
    const root = result.collections.find((c) => c.parentId === null)!;
    expect(result.environments.length).toBeGreaterThan(0);
    for (const env of result.environments) {
      expect(env.collectionId).toBe(root.id);
    }
  });

  it("numera a ordem dos environments a partir do base", () => {
    const base = result.environments.find((e) => e.isBase)!;
    expect(base.sortOrder).toBe(0);
    expect(
      result.environments.filter((e) => !e.isBase).map((e) => e.sortOrder),
    ).toEqual(
      result.environments.filter((e) => !e.isBase).map((_, i) => i + 1),
    );
  });

  it("marca credenciais como secretas e deixa base_url normal", () => {
    const base = result.environments.find((e) => e.isBase)!;
    expect(base.variables.find((v) => v.key === "base_url")).toMatchObject({
      value: "https://captura-djen.munin.ia.br/api/v1",
      secret: false,
    });
    expect(base.variables.find((v) => v.key === "token")!.secret).toBe(true);
  });

  it("descarta a chave vazia que o Insomnia deixa nos environments", () => {
    const staging = result.environments.find((e) => e.name === "Staging")!;
    expect(staging.variables.map((v) => v.key)).toEqual(["token"]);
  });

  it("avisa sobre tokens escritos direto no auth", () => {
    expect(result.warnings.some((w) => w.includes("token escrito direto"))).toBe(true);
  });

  it("respeita a ordem por sortKey dentro da pasta", () => {
    const trackers = result.collections.find((c) => c.name === "Trackers")!;
    const names = result.requests
      .filter((r) => r.collectionId === trackers.id)
      .map((r) => r.name);
    expect(names[0]).toBe("List all Trackers");
    expect(names.at(-1)).toBe("Delete Tracker");
  });
});

describe("detecção de formato", () => {
  it("isInsomniaV5 reconhece o cabeçalho do v5", () => {
    expect(isInsomniaV5({ type: "collection.insomnia.rest/5.0" })).toBe(true);
    expect(isInsomniaV5({ _type: "export", resources: [] })).toBe(false);
  });

  it("importInsomniaV5 rejeita documento sem o cabeçalho", () => {
    expect(() => importInsomniaV5({ collection: [] }, opts)).toThrow(/v5/);
  });

  it("ainda importa o formato v4 em JSON", async () => {
    const v4 = JSON.stringify({
      _type: "export",
      __export_format: 4,
      resources: [
        { _id: "wrk_1", _type: "workspace", parentId: null, name: "W" },
        {
          _id: "req_1",
          _type: "request",
          parentId: "wrk_1",
          name: "Ping",
          method: "GET",
          url: "{{ _.base_url }}/ping",
        },
      ],
    });
    const result = await importInsomniaExport(v4, opts);
    expect(result.format).toBe("insomnia-v4");
    expect(result.requests[0]?.url).toBe("{{ base_url }}/ping");
  });

  it("explica o erro quando o arquivo não é um export do Insomnia", async () => {
    await expect(importInsomniaExport('{"foo":1}', opts)).rejects.toThrow(
      /Formato não reconhecido/,
    );
  });
});

describe("importInsomniaV5 — profundidade de pastas", () => {
  it("preserva a cadeia inteira, sem teto de níveis", () => {
    let n = 0;
    const doc = {
      type: "collection.insomnia.rest/5.0",
      name: "Deep",
      collection: [
        {
          name: "N1",
          children: [
            {
              name: "N2",
              children: [
                {
                  name: "N3",
                  children: [
                    {
                      name: "N4",
                      children: [
                        { name: "fundo", method: "GET", url: "{{ _.base_url }}/fundo" },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const result = importInsomniaV5(doc, {
      projectId: "prj-1",
      makeId: () => `deep-${++n}`,
      now: () => "2026-09-01T00:00:00.000Z",
    });

    // raiz (nome do documento) + N1..N4
    expect(result.collections.map((c) => c.name)).toEqual([
      "Deep",
      "N1",
      "N2",
      "N3",
      "N4",
    ]);

    // cada pasta aponta pra anterior: uma corrente, não cinco irmãs
    const byName = new Map(result.collections.map((c) => [c.name, c]));
    expect(byName.get("Deep")!.parentId).toBeNull();
    for (const [child, parent] of [["N1", "Deep"], ["N2", "N1"], ["N3", "N2"], ["N4", "N3"]]) {
      expect(byName.get(child!)!.parentId).toBe(byName.get(parent!)!.id);
    }

    // a request do fundo fica na pasta mais profunda
    expect(result.requests).toHaveLength(1);
    expect(result.requests[0]!.collectionId).toBe(byName.get("N4")!.id);
  });
});
