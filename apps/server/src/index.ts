import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { buildApp } from './app.js'
import * as schema from './db/schema.js'

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://postgres:somnolent@localhost:5435/somnolent'
// When set, creating a project requires this secret. Empty = open creation (local).
const CREATE_TOKEN = process.env['PROJECT_CREATE_TOKEN']
const PORT = Number(process.env.PORT ?? 4000)

const pool = new pg.Pool({ connectionString: DATABASE_URL })
const db = drizzle(pool, { schema })

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '..', 'drizzle')
await migrate(db, { migrationsFolder })

const app = buildApp({ db, createToken: CREATE_TOKEN })
await app.listen({ port: PORT, host: '0.0.0.0' })
console.log(`somnolent server at http://localhost:${PORT}`)

// The orchestrator restarts the container all the time; without this, each stop
// cuts requests midway and leaves connections hanging in Postgres.
let closing = false
for (const sinal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sinal, () => {
    if (closing) return
    closing = true
    console.log(`${sinal} received, shutting down…`)
    void app
      .close()
      .then(() => pool.end())
      .then(() => process.exit(0))
      .catch(() => process.exit(1))
  })
}
