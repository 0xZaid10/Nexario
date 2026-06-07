import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import * as schema from './schema.js'
import { env } from '../config/env.js'
import { logger } from '../lib/logger.js'

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null

export function getDb() {
  if (_db) return _db

  const sqlite = new Database(env.DATABASE_URL, {
    verbose:
      env.NODE_ENV === 'development'
        ? (msg) => logger.trace({ sql: msg }, 'sqlite')
        : undefined,
  })

  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  sqlite.pragma('synchronous = NORMAL')
  sqlite.pragma('cache_size = -32000')
  sqlite.pragma('temp_store = MEMORY')

  _db = drizzle(sqlite, { schema })
  logger.info({ path: env.DATABASE_URL }, 'database connected')
  return _db
}

export function runMigrations() {
  const db = getDb()
  migrate(db, { migrationsFolder: './src/db/migrations' })
  logger.info('database migrations applied')
}

export const db = new Proxy({} as ReturnType<typeof getDb>, {
  get(_target, prop) {
    return getDb()[prop as keyof ReturnType<typeof getDb>]
  },
})

export { schema }
