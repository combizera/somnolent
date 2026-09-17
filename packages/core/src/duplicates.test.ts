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
  it("ignores case and surrounding spaces", () => {
    expect(normalizeEnvName("  Staging ")).toBe("staging");
  });
});

describe("duplicateEnvIds", () => {
  it("flags both sides of a collision that only differs in case", () => {
    const dupes = duplicateEnvIds([
      makeEnv("a", "staging"),
      makeEnv("b", "Staging"),
      makeEnv("c", "prod"),
    ]);
    expect([...dupes].sort()).toEqual(["a", "b"]);
  });

  it("treats surrounding spaces as the same name", () => {
    const dupes = duplicateEnvIds([makeEnv("a", "prod"), makeEnv("b", " prod ")]);
    expect([...dupes].sort()).toEqual(["a", "b"]);
  });

  it("marks all three when three names match", () => {
    const dupes = duplicateEnvIds([
      makeEnv("a", "novo-env"),
      makeEnv("b", "novo-env"),
      makeEnv("c", "novo-env"),
    ]);
    expect(dupes.size).toBe(3);
  });

  it("stays quiet on an empty name, which is the freshly created env", () => {
    const dupes = duplicateEnvIds([makeEnv("a", ""), makeEnv("b", "   ")]);
    expect(dupes.size).toBe(0);
  });

  it("sees no duplicate where there is none", () => {
    expect(duplicateEnvIds([makeEnv("a", "staging"), makeEnv("b", "prod")]).size).toBe(0);
  });
});

describe("duplicateVarIndexes", () => {
  it("flags exactly equal keys", () => {
    const dupes = duplicateVarIndexes(makeVars("base_url", "token", "token"));
    expect([...dupes].sort()).toEqual([1, 2]);
  });

  it("keeps the engine case-sensitive: token and Token are distinct", () => {
    expect(duplicateVarIndexes(makeVars("token", "Token")).size).toBe(0);
  });

  it("ignores blank rows", () => {
    expect(duplicateVarIndexes(makeVars("", "", "token")).size).toBe(0);
  });
});

describe("uniqueEnvName", () => {
  it("returns the asked name when it is free", () => {
    expect(uniqueEnvName("novo-env", ["staging"])).toBe("novo-env");
  });

  it("suffixes until it finds a free one", () => {
    expect(uniqueEnvName("novo-env", ["novo-env"])).toBe("novo-env 2");
    expect(uniqueEnvName("novo-env", ["novo-env", "novo-env 2"])).toBe("novo-env 3");
  });

  it("counts a collision ignoring case", () => {
    expect(uniqueEnvName("staging", ["STAGING"])).toBe("staging 2");
  });
});
