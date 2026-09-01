import type { Environment, EnvironmentVariable } from "./types.js";

/**
 * Nome de environment é rótulo humano: "staging" e " Staging " são o mesmo
 * ambiente pra quem lê, então a comparação ignora caixa e espaços nas pontas.
 */
export function normalizeEnvName(name: string): string {
  return name.trim().toLocaleLowerCase();
}

/**
 * Ids dos environments cujo nome colide com o de outro.
 * Environments sem nome não contam — o usuário ainda está digitando.
 */
export function duplicateEnvIds(environments: Environment[]): Set<string> {
  const byName = new Map<string, string[]>();
  for (const env of environments) {
    const key = normalizeEnvName(env.name);
    if (!key) continue;
    const ids = byName.get(key);
    if (ids) ids.push(env.id);
    else byName.set(key, [env.id]);
  }
  const dupes = new Set<string>();
  for (const ids of byName.values()) {
    if (ids.length > 1) for (const id of ids) dupes.add(id);
  }
  return dupes;
}

/**
 * Índices das variáveis cuja chave colide dentro do mesmo environment.
 * A comparação é exata (case-sensitive) porque a resolução de {{var}} também
 * é — `token` e `Token` são variáveis distintas, não duplicata.
 * Chaves vazias são ignoradas: é a linha recém-criada, ainda em branco.
 */
export function duplicateVarIndexes(variables: EnvironmentVariable[]): Set<number> {
  const byKey = new Map<string, number[]>();
  variables.forEach((v, i) => {
    if (!v.key.trim()) return;
    const at = byKey.get(v.key);
    if (at) at.push(i);
    else byKey.set(v.key, [i]);
  });
  const dupes = new Set<number>();
  for (const indexes of byKey.values()) {
    if (indexes.length > 1) for (const i of indexes) dupes.add(i);
  }
  return dupes;
}

/**
 * Nome livre a partir de `desired`, sufixando " 2", " 3"... enquanto colidir.
 * Usado onde o nome nasce sem o usuário digitar (botão "+ environment", import).
 */
export function uniqueEnvName(desired: string, taken: string[]): string {
  const used = new Set(taken.map(normalizeEnvName));
  if (!used.has(normalizeEnvName(desired))) return desired;
  for (let n = 2; ; n++) {
    const candidate = `${desired} ${n}`;
    if (!used.has(normalizeEnvName(candidate))) return candidate;
  }
}
