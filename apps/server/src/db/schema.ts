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

/** Project: the top level, owner of the collections. Was `workspaces`. */
export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

/**
 * Access key — the credential. No accounts: whoever holds the key syncs what it
 * opens. Only the sha-256 is stored; the raw value exists at creation only.
 */
export const accessKeys = pgTable(
  'access_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tokenHash: text('token_hash').notNull().unique(),
    /** 'project' opens the whole project; 'collection' opens a single one. */
    scope: text('scope', { enum: ['project', 'collection'] }).notNull(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /** Only filled when scope = 'collection'. */
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
     * Root collection owning the entity — the filter a 'collection'-scoped key
     * uses. The root collection itself points at its own id.
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
