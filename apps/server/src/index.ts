import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { buildApp } from './app.js'
import * as schema from './db/schema.js'

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://postgres:somnolent@localhost:5435/somnolent'
// Se definido, criar project exige este segredo. Vazio = criação livre (local).
const CREATE_TOKEN = process.env['PROJECT_CREATE_TOKEN']
const PORT = Number(process.env.PORT ?? 4000)

const pool = new pg.Pool({ connectionString: DATABASE_URL })
const db = drizzle(pool, { schema })

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '..', 'drizzle')
await migrate(db, { migrationsFolder })

const app = buildApp({ db, createToken: CREATE_TOKEN })
await app.listen({ port: PORT, host: '0.0.0.0' })
console.log(`somnolent server em http://localhost:${PORT}`)

// Orquestrador reinicia contêiner o tempo todo (deploy, health check, reschedule).
// Sem isto, cada parada corta requests no meio e deixa conexão pendurada no
// Postgres até o servidor expirar por conta própria.
let closing = false
for (const sinal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sinal, () => {
    if (closing) return
    closing = true
    console.log(`${sinal} recebido, encerrando…`)
    void app
      .close()
      .then(() => pool.end())
      .then(() => process.exit(0))
      .catch(() => process.exit(1))
  })
}
