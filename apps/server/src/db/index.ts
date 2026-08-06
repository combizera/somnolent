import { drizzle } from 'drizzle-orm/node-postgres'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import pg from 'pg'
import * as schema from './schema.js'

/** Tipo comum aos drivers node-postgres (produção) e PGlite (testes). */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>

export function createDb(databaseUrl: string): { db: Db; pool: pg.Pool } {
  const pool = new pg.Pool({ connectionString: databaseUrl })
  return { db: drizzle(pool, { schema }), pool }
}
