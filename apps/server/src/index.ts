import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { buildApp } from './app.js'
import * as schema from './db/schema.js'

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://postgres:somnolent@localhost:5435/somnolent'
const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret-troque-em-producao'
const PORT = Number(process.env.PORT ?? 4000)

const pool = new pg.Pool({ connectionString: DATABASE_URL })
const db = drizzle(pool, { schema })

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '..', 'drizzle')
await migrate(db, { migrationsFolder })

const app = buildApp({ db, jwtSecret: JWT_SECRET })
await app.listen({ port: PORT, host: '0.0.0.0' })
console.log(`somnolent server em http://localhost:${PORT}`)
