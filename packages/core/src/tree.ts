import type { Collection } from "./types.js";

/**
 * Walks up `parentId` to the root collection: it names the entry in the sidebar,
 * owns the environments and scopes a share key. Null if the chain is broken.
 */
export function rootCollectionOf(
  collections: Collection[],
  collectionId: string | null,
): Collection | null {
  if (!collectionId) return null;
  const byId = new Map(collections.map((c) => [c.id, c]));
  let current = byId.get(collectionId);
  // cycle guard: at worst it visits each collection once
  for (let hops = 0; current && hops <= collections.length; hops++) {
    if (current.parentId === null) return current;
    current = byId.get(current.parentId);
  }
  return null;
}

/** Ids of the collection and of everything hanging from it. */
export function subtreeIds(collections: Collection[], rootId: string): Set<string> {
  const ids = new Set<string>([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of collections) {
      if (c.parentId && ids.has(c.parentId) && !ids.has(c.id)) {
        ids.add(c.id);
        grew = true;
      }
    }
  }
  return ids;
}

/**
 * Ids of a project's collections — roots and folders. An environment has no
 * `projectId`, so this set decides whether one belongs to the project.
 */
export function collectionIdsOfProject(
  collections: Collection[],
  projectId: string,
): Set<string> {
  return new Set(
    collections.filter((c) => c.projectId === projectId).map((c) => c.id),
  );
}
