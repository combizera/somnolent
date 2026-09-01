import type { ApiRequest, Collection, Environment, Project } from '@somnolent/core'

/** Estado persistido, com os campos que já existiram em versões anteriores. */
export interface LegacyState {
  projects?: Project[]
  openProjectId?: string | null
  collections?: (Collection & { workspaceId?: string })[]
  requests?: (ApiRequest & { workspaceId?: string })[]
  environments?: (Environment & { workspaceId?: string })[]
  activeEnvId?: string | null
  activeEnvByCollection?: Record<string, string | null>
}

interface Deps {
  uid: () => string
  now: () => string
}

/**
 * Migra o workspace salvo no localStorage entre versões do schema.
 *
 * v0 → v1: `Environment.sortOrder` não existia e a ordem era a de inserção.
 *          Congela essa ordem em números.
 *
 * v1 → v2: nasce o `Project`, `workspaceId` vira `projectId` e o environment
 *          passa a pertencer a uma collection. Os envs antigos eram do
 *          workspace inteiro, então são **copiados pra cada collection raiz** —
 *          eleger uma collection "dona" deixaria as outras sem variável, e
 *          request sem `{{ base_url }}` não resolve.
 */
export function migrateWorkspace(
  persisted: unknown,
  version: number,
  deps: Deps = { uid: () => crypto.randomUUID(), now: () => new Date().toISOString() },
): LegacyState | undefined {
  const state = persisted as LegacyState | undefined
  if (!state) return state

  let next: LegacyState = { ...state }

  if (version < 1) {
    next.environments = (next.environments ?? []).map((env, i) => ({
      ...env,
      sortOrder: typeof env.sortOrder === 'number' ? env.sortOrder : i,
    }))
  }

  if (version < 2) {
    const project: Project = {
      id: deps.uid(),
      name: 'Pessoal',
      sortOrder: 0,
      version: 1,
      updatedAt: deps.now(),
    }
    const collections = (next.collections ?? []).map((c) => ({ ...c, projectId: project.id }))
    const requests = (next.requests ?? []).map((r) => ({ ...r, projectId: project.id }))
    const roots = collections.filter((c) => c.parentId === null)
    const legacyEnvs = next.environments ?? []

    const environments: Environment[] = []
    const activeEnvByCollection: Record<string, string | null> = {}
    for (const root of roots) {
      for (const env of legacyEnvs) {
        const copy: Environment = { ...env, id: deps.uid(), collectionId: root.id }
        delete (copy as Environment & { workspaceId?: string }).workspaceId
        environments.push(copy)
        if (env.id === next.activeEnvId) activeEnvByCollection[root.id] = copy.id
      }
    }

    next = {
      ...next,
      projects: [project],
      openProjectId: project.id,
      collections,
      requests,
      environments,
      activeEnvByCollection,
    }
    delete next.activeEnvId
  }

  return next
}
