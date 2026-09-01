import {
  boolean,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'

/** Project: o nível de topo, dono das collections. Era `workspaces`. */
export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

/**
 * Chave de acesso — a credencial. Não existe conta: quem tem a chave sincroniza
 * o que ela abre. Várias chaves por alvo, cada uma com rótulo e papel, pra dar
 * revogação por pessoa sem cadastrar pessoa.
 *
 * O valor cru só existe no momento da criação; aqui fica o sha-256.
 */
export const accessKeys = pgTable(
  'access_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tokenHash: text('token_hash').notNull().unique(),
    /** 'project' abre o project inteiro; 'collection' abre uma collection só. */
    scope: text('scope', { enum: ['project', 'collection'] }).notNull(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /** Preenchido só quando scope = 'collection'. */
    collectionId: text('collection_id'),
    role: text('role', { enum: ['write', 'read'] }).notNull().default('write'),
    label: text('label').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [index('access_keys_project_idx').on(t.projectId)],
)

export const entities = pgTable(
  'entities',
  {
    id: text('id').notNull(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /**
     * Collection raiz dona da entidade — é o filtro que uma chave de escopo
     * 'collection' usa. A própria collection raiz aponta pro próprio id.
     */
    rootCollectionId: text('root_collection_id'),
    kind: text('kind', { enum: ['collection', 'request', 'environment'] }).notNull(),
    data: jsonb('data').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    deleted: boolean('deleted').notNull().default(false),
    syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.id] }),
    index('entities_project_synced_idx').on(t.projectId, t.syncedAt),
    index('entities_scope_idx').on(t.projectId, t.rootCollectionId, t.syncedAt),
  ],
)
