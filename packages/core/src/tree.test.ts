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
  it("returns the collection itself when it is already a root", () => {
    expect(rootCollectionOf(tree, "root")?.id).toBe("root");
  });

  it("climbs several levels up to the root", () => {
    expect(rootCollectionOf(tree, "b")?.id).toBe("root");
  });

  it("returns null for an unknown or null id", () => {
    expect(rootCollectionOf(tree, "fantasma")).toBeNull();
    expect(rootCollectionOf(tree, null)).toBeNull();
  });

  it("does not hang on a cycle", () => {
    const cyclic = [col("x", "y"), col("y", "x")];
    expect(rootCollectionOf(cyclic, "x")).toBeNull();
  });
});

describe("subtreeIds", () => {
  it("takes the root and every descendant, without leaking into another tree", () => {
    expect([...subtreeIds(tree, "root")].sort()).toEqual(["a", "b", "root"]);
  });

  it("works starting from a folder in the middle", () => {
    expect([...subtreeIds(tree, "a")].sort()).toEqual(["a", "b"]);
  });
});
