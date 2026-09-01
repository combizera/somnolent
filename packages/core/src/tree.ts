import type { Collection } from "./types.js";

/**
 * Sobe a cadeia de `parentId` até a collection raiz (a que tem `parentId: null`).
 * É ela que dá nome à collection na sidebar, que é dona dos environments e que
 * define o escopo de uma chave de compartilhamento.
 *
 * Devolve null se o id não existe ou se a cadeia estiver quebrada.
 */
export function rootCollectionOf(
  collections: Collection[],
  collectionId: string | null,
): Collection | null {
  if (!collectionId) return null;
  const byId = new Map(collections.map((c) => [c.id, c]));
  let current = byId.get(collectionId);
  // guarda contra ciclo: no pior caso visita cada collection uma vez
  for (let hops = 0; current && hops <= collections.length; hops++) {
    if (current.parentId === null) return current;
    current = byId.get(current.parentId);
  }
  return null;
}

/** Ids da collection e de tudo que pende dela. */
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
