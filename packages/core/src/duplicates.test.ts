import { describe, expect, it } from "vitest";
import {
  duplicateEnvIds,
  duplicateVarIndexes,
  normalizeEnvName,
  uniqueEnvName,
} from "./duplicates.js";
import type { Environment, EnvironmentVariable } from "./types.js";

function makeEnv(id: string, name: string): Environment {
  return {
    id,
    collectionId: "col-1",
    name,
    isBase: false,
    variables: [],
    sortOrder: 0,
    version: 1,
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function makeVars(...keys: string[]): EnvironmentVariable[] {
  return keys.map((key) => ({ key, value: "v", secret: false, enabled: true }));
}

describe("normalizeEnvName", () => {
  it("ignora caixa e espaços nas pontas", () => {
    expect(normalizeEnvName("  Staging ")).toBe("staging");
  });
});

describe("duplicateEnvIds", () => {
  it("aponta os dois lados de uma colisão que só difere na caixa", () => {
    const dupes = duplicateEnvIds([
      makeEnv("a", "staging"),
      makeEnv("b", "Staging"),
      makeEnv("c", "prod"),
    ]);
    expect([...dupes].sort()).toEqual(["a", "b"]);
  });

  it("trata espaço nas pontas como o mesmo nome", () => {
    const dupes = duplicateEnvIds([makeEnv("a", "prod"), makeEnv("b", " prod ")]);
    expect([...dupes].sort()).toEqual(["a", "b"]);
  });

  it("marca todos quando há três iguais", () => {
    const dupes = duplicateEnvIds([
      makeEnv("a", "novo-env"),
      makeEnv("b", "novo-env"),
      makeEnv("c", "novo-env"),
    ]);
    expect(dupes.size).toBe(3);
  });

  it("não reclama de nome vazio, que é o env recém-criado", () => {
    const dupes = duplicateEnvIds([makeEnv("a", ""), makeEnv("b", "   ")]);
    expect(dupes.size).toBe(0);
  });

  it("não vê duplicata onde não há", () => {
    expect(duplicateEnvIds([makeEnv("a", "staging"), makeEnv("b", "prod")]).size).toBe(0);
  });
});

describe("duplicateVarIndexes", () => {
  it("aponta chaves exatamente iguais", () => {
    const dupes = duplicateVarIndexes(makeVars("base_url", "token", "token"));
    expect([...dupes].sort()).toEqual([1, 2]);
  });

  it("preserva o case-sensitive do engine: token e Token são distintas", () => {
    expect(duplicateVarIndexes(makeVars("token", "Token")).size).toBe(0);
  });

  it("ignora linhas em branco", () => {
    expect(duplicateVarIndexes(makeVars("", "", "token")).size).toBe(0);
  });
});

describe("uniqueEnvName", () => {
  it("devolve o nome pedido quando está livre", () => {
    expect(uniqueEnvName("novo-env", ["staging"])).toBe("novo-env");
  });

  it("sufixa até achar um livre", () => {
    expect(uniqueEnvName("novo-env", ["novo-env"])).toBe("novo-env 2");
    expect(uniqueEnvName("novo-env", ["novo-env", "novo-env 2"])).toBe("novo-env 3");
  });

  it("considera colisão ignorando a caixa", () => {
    expect(uniqueEnvName("staging", ["STAGING"])).toBe("staging 2");
  });
});
