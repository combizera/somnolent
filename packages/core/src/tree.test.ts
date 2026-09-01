import { describe, expect, it } from "vitest";
import { rootCollectionOf, subtreeIds } from "./tree.js";
import type { Collection } from "./types.js";

const col = (id: string, parentId: string | null): Collection => ({
  id,
  projectId: "prj-1",
  parentId,
  name: id,
  sortOrder: 0,
  version: 1,
  updatedAt: "2026-09-01T00:00:00.000Z",
});

const tree = [col("root", null), col("a", "root"), col("b", "a"), col("outra", null)];

describe("rootCollectionOf", () => {
  it("devolve a própria collection quando ela já é raiz", () => {
    expect(rootCollectionOf(tree, "root")?.id).toBe("root");
  });

  it("sobe vários níveis até a raiz", () => {
    expect(rootCollectionOf(tree, "b")?.id).toBe("root");
  });

  it("devolve null pra id inexistente ou nulo", () => {
    expect(rootCollectionOf(tree, "fantasma")).toBeNull();
    expect(rootCollectionOf(tree, null)).toBeNull();
  });

  it("não trava num ciclo", () => {
    const cyclic = [col("x", "y"), col("y", "x")];
    expect(rootCollectionOf(cyclic, "x")).toBeNull();
  });
});

describe("subtreeIds", () => {
  it("pega a raiz e todos os descendentes, sem vazar pra outra árvore", () => {
    expect([...subtreeIds(tree, "root")].sort()).toEqual(["a", "b", "root"]);
  });

  it("funciona a partir de uma pasta do meio", () => {
    expect([...subtreeIds(tree, "a")].sort()).toEqual(["a", "b"]);
  });
});
