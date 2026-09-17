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

describe("importInsomniaExport — real Insomnia v5 file", () => {
  let result: ImportResult;

  beforeAll(async () => {
    result = await importInsomniaExport(fixture, opts);
  });

  it("detects the v5 format and the collection name", () => {
    expect(result.format).toBe("insomnia-v5");
    expect(result.sourceName).toBe("Catcher - Intimations");
  });

  it("imports all 11 requests in the file", () => {
    expect(result.requests).toHaveLength(11);
  });

  it("creates a root collection named after the document", () => {
    const roots = result.collections.filter((c) => c.parentId === null);
    expect(roots).toHaveLength(1);
    expect(roots[0]!.name).toBe("Catcher - Intimations");
  });

  it("keeps nested folders as subfolders, not flattened into the name", () => {
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

  it("a request outside any folder stays in the root collection", () => {
    const root = result.collections.find((c) => c.parentId === null)!;
    const account = result.requests.find((r) => r.name === "Account Detail")!;
    expect(account.collectionId).toBe(root.id);
    expect(account.method).toBe("GET");
  });

  it("links each request to the right folder", () => {
    const trackers = result.collections.find((c) => c.name === "Trackers")!;
    const intimations = result.collections.find((c) => c.name === "Intimations")!;

    expect(result.requests.find((r) => r.name === "Create Tracker")!.collectionId).toBe(
      trackers.id,
    );
    expect(
      result.requests.find((r) => r.name === "List all Intimations")!.collectionId,
    ).toBe(intimations.id);
  });

  it("converts {{ _.var }} to {{ var }} in the URL and in auth", () => {
    const account = result.requests.find((r) => r.name === "Account Detail")!;
    expect(account.url).toBe("{{ base_url }}/account");
    expect(account.auth).toEqual({ type: "bearer", token: "{{ token_staging }}" });
  });

  it("stores path params in pathParams, leaving the :id in the URL", () => {
    const detail = result.requests.find((r) => r.name === "List Tracker Detail")!;
    // the URL keeps the :id — the value resolves it at send time
    expect(detail.url).toBe("{{ base_url }}/trackers/:id");
    expect(detail.pathParams).toEqual([
      expect.objectContaining({ key: "id", value: "8684", enabled: true }),
    ]);

    const update = result.requests.find((r) => r.name === "Update Tracker")!;
    expect(update.pathParams?.[0]).toMatchObject({ key: "id", value: "1164" });
  });

  it("a valueless path param comes in empty, for the person to fill in Params", () => {
    const byTracker = result.requests.find(
      (r) => r.name === "List Intimations by Tracker",
    )!;
    expect(byTracker.url).toBe("{{ base_url }}/trackers/:id/communications");
    // no warning: an empty field is a normal state now, and the UI marks it red
    expect(byTracker.pathParams).toEqual([
      expect.objectContaining({ key: "id", value: "" }),
    ]);
  });

  it("keeps disabled query params", () => {
    const list = result.requests.find((r) => r.name === "List all Trackers")!;
    expect(list.queryParams).toHaveLength(4);
    expect(list.queryParams.every((p) => !p.enabled)).toBe(true);
    expect(list.queryParams.map((p) => p.key)).toEqual(["remote_id", "q", "active", "type"]);
  });

  it("mixes enabled and disabled params correctly", () => {
    const all = result.requests.find((r) => r.name === "List all Intimations")!;
    const enabled = all.queryParams.filter((p) => p.enabled).map((p) => p.key);
    expect(enabled).toEqual(["status", "tracker_id"]);
  });

  it("imports a JSON body and the Content-Type header", () => {
    const create = result.requests.find((r) => r.name === "Create Tracker")!;
    expect(create.bodyType).toBe("json");
    expect(create.body).toContain('"oab_number": "123456"');
    expect(create.headers).toEqual([
      expect.objectContaining({ key: "Content-Type", value: "application/json" }),
    ]);
  });

  it("stores the request description", () => {
    const busca = result.requests.find((r) => r.name === "Search Intimations by Name")!;
    expect(busca.description).toContain("NÃO migrou pra inglês");
  });

  it("imports the base environment and sub-environments with color", () => {
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

  it("pins environments to the root collection, not to the project", () => {
    const root = result.collections.find((c) => c.parentId === null)!;
    expect(result.environments.length).toBeGreaterThan(0);
    for (const env of result.environments) {
      expect(env.collectionId).toBe(root.id);
    }
  });

  it("numbers the environment order starting from the base", () => {
    const base = result.environments.find((e) => e.isBase)!;
    expect(base.sortOrder).toBe(0);
    expect(
      result.environments.filter((e) => !e.isBase).map((e) => e.sortOrder),
    ).toEqual(
      result.environments.filter((e) => !e.isBase).map((_, i) => i + 1),
    );
  });

  it("marks credentials as secret and leaves base_url plain", () => {
    const base = result.environments.find((e) => e.isBase)!;
    expect(base.variables.find((v) => v.key === "base_url")).toMatchObject({
      value: "https://captura-djen.munin.ia.br/api/v1",
      secret: false,
    });
    expect(base.variables.find((v) => v.key === "token")!.secret).toBe(true);
  });

  it("drops the empty key Insomnia leaves in environments", () => {
    const staging = result.environments.find((e) => e.name === "Staging")!;
    expect(staging.variables.map((v) => v.key)).toEqual(["token"]);
  });

  it("warns about tokens written straight into auth", () => {
    expect(result.warnings.some((w) => w.includes("token written straight into auth"))).toBe(true);
  });

  it("respects the sortKey order inside the folder", () => {
    const trackers = result.collections.find((c) => c.name === "Trackers")!;
    const names = result.requests
      .filter((r) => r.collectionId === trackers.id)
      .map((r) => r.name);
    expect(names[0]).toBe("List all Trackers");
    expect(names.at(-1)).toBe("Delete Tracker");
  });
});

describe("format detection", () => {
  it("isInsomniaV5 recognizes the v5 header", () => {
    expect(isInsomniaV5({ type: "collection.insomnia.rest/5.0" })).toBe(true);
    expect(isInsomniaV5({ _type: "export", resources: [] })).toBe(false);
  });

  it("importInsomniaV5 rejects a document without the header", () => {
    expect(() => importInsomniaV5({ collection: [] }, opts)).toThrow(/v5/);
  });

  it("still imports the v4 JSON format", async () => {
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

  it("explains the error when the file is not an Insomnia export", async () => {
    await expect(importInsomniaExport('{"foo":1}', opts)).rejects.toThrow(
      /Unrecognized format/,
    );
  });
});

describe("importInsomniaV5 — folder depth", () => {
  it("keeps the whole chain, with no ceiling on levels", () => {
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

    // root (document name) + N1..N4
    expect(result.collections.map((c) => c.name)).toEqual([
      "Deep",
      "N1",
      "N2",
      "N3",
      "N4",
    ]);

    // each folder points at the previous one: a chain, not five siblings
    const byName = new Map(result.collections.map((c) => [c.name, c]));
    expect(byName.get("Deep")!.parentId).toBeNull();
    for (const [child, parent] of [["N1", "Deep"], ["N2", "N1"], ["N3", "N2"], ["N4", "N3"]]) {
      expect(byName.get(child!)!.parentId).toBe(byName.get(parent!)!.id);
    }

    // the bottom request stays in the deepest folder
    expect(result.requests).toHaveLength(1);
    expect(result.requests[0]!.collectionId).toBe(byName.get("N4")!.id);
  });
});

describe("importInsomniaV5 — form body", () => {
  it("brings the param rows in as formBody, inventing no text", () => {
    let n = 0;
    const result = importInsomniaV5(
      {
        type: "collection.insomnia.rest/5.0",
        name: "Auth",
        collection: [
          {
            name: "Get credentials",
            method: "POST",
            url: "{{ _.credentialsUrl }}",
            body: {
              mimeType: "application/x-www-form-urlencoded",
              params: [
                { name: "grant_type", value: "client_credentials" },
                { name: "client_id", value: "{{ _.clientId }}" },
                { name: "scope", value: "read:api", disabled: true },
              ],
            },
          },
        ],
      },
      { projectId: "prj-1", makeId: () => `form-${++n}`, now: () => "2026-09-01T00:00:00.000Z" },
    );

    const request = result.requests[0]!;
    expect(request.bodyType).toBe("form");
    expect(request.body).toBeNull();
    expect(request.formBody).toEqual([
      { id: expect.any(String), key: "grant_type", value: "client_credentials", enabled: true },
      { id: expect.any(String), key: "client_id", value: "{{ clientId }}", enabled: true },
      { id: expect.any(String), key: "scope", value: "read:api", enabled: false },
    ]);
  });
});
