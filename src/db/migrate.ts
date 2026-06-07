import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { getDb } from './client.js'
import { logger } from '../lib/logger.js'

async function main() {
  logger.info('running database migrations...')
  const db = getDb()
  migrate(db, { migrationsFolder: './src/db/migrations' })
  logger.info('migrations complete')
  process.exit(0)
}

main().catch((err) => {
  logger.fatal({ err }, 'migration failed')
  process.exit(1)
})
