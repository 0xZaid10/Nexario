import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import { env } from '../config/env.js'
import { logger } from '../lib/logger.js'
import { runMigrations } from '../db/client.js'
import { loadDeployedAddresses } from '../config/contracts.js'
import { loadDemoAgentsFromDB } from '../agents/registry.js'
import { startIndexer } from '../lib/erc8004/indexer.js'
import { loadUpgradedAddresses } from '../lib/oneshot/upgrade.js'
import { startScheduler } from '../services/scheduler.js'
import { tasksRouter } from './routes/tasks.js'
import { agentsRouter } from './routes/agents.js'
import {
  delegationsRouter,
  authorizeRouter,
  sseRouter,
  webhookRouter,
} from './routes/routes.js'
import { errorHandler, notFound } from './middleware/errors.js'
import { rateLimit, extractUser } from './middleware/auth.js'

const app = express()

// ─── Security ─────────────────────────────────────────────────────────────────

app.use(helmet({
  contentSecurityPolicy: false, // API — no HTML served
  crossOriginEmbedderPolicy: false,
}))

app.use(cors({
  origin: env.NODE_ENV === 'production'
    ? ['https://nexario.xyz', 'https://app.nexario.xyz']
    : '*',
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-API-Key',
    'X-User-Address',
    'X-Chain-Id',
  ],
}))

// ─── Body parsing ─────────────────────────────────────────────────────────────

// Raw body saved for webhook signature verification
app.use('/api/webhook', express.json({
  verify: (req: express.Request & { rawBody?: Buffer }, _res, buf) => {
    req.rawBody = buf
  },
}))

app.use(express.json({ limit: '1mb' }))

// ─── Global middleware ────────────────────────────────────────────────────────

app.use(rateLimit)
app.use(extractUser)

// ─── Health ───────────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    version: '1.0.0',
    env: env.NODE_ENV,
    timestamp: new Date().toISOString(),
  })
})

// ─── API routes ───────────────────────────────────────────────────────────────

app.use('/api/task', tasksRouter)
app.use('/api/tasks', tasksRouter)
app.use('/api/agents', agentsRouter)
app.use('/api/delegations', delegationsRouter)
app.use('/api/authorize', authorizeRouter)
app.use('/api/events', sseRouter)
app.use('/api/webhook', webhookRouter)

// ─── SDK info endpoint ────────────────────────────────────────────────────────

app.get('/api/sdk', (_req, res) => {
  res.json({
    name: '@nexario/sdk',
    version: '1.0.0',
    description: 'Authority leasing for autonomous agents',
    endpoints: {
      authorize: 'POST /api/authorize',
      task: 'POST /api/task',
      events: 'GET /api/events/:taskId',
      delegations: 'GET /api/delegations/:taskId',
      agents: 'GET /api/agents',
      chat: 'POST /api/agents/chat',
      research: 'POST /api/agents/research',
      audit: 'POST /api/agents/audit',
      report: 'POST /api/agents/report',
      session: 'GET /api/authorize/session',
    },
    docs: 'https://nexario.xyz/docs',
  })
})

// ─── Error handling ───────────────────────────────────────────────────────────

app.use(notFound)
app.use(errorHandler)

// ─── Startup ──────────────────────────────────────────────────────────────────

async function start(): Promise<void> {
  logger.info('nexario starting...')

  // 1. DB migrations
  runMigrations()
  logger.info('migrations applied')

  // 2. Load deployed contract addresses
  loadDeployedAddresses()

  // 3. Load EIP-7702 upgrade tracker
  await loadUpgradedAddresses()

  // 4. Load demo agents from DB
  await loadDemoAgentsFromDB()

  // 5. Start ERC-8004 event indexer (non-blocking)
  startIndexer().then(async () => {
    // Warm reputation cache after indexer loads agents
    try {
      const { warmRepCache } = await import('./routes/agents.js')
      const { getAllAgents } = await import('../lib/erc8004/registry.js')
      const agents = await getAllAgents()
      const ids = agents.map(a => a.agentId).filter(id => id > 0)
      logger.info({ count: ids.length }, 'warming reputation cache')
      await warmRepCache(ids)
      logger.info('reputation cache warm')
    } catch (err) {
      logger.warn({ err }, 'reputation cache warmup failed')
    }
  }).catch((err) =>
    logger.warn({ err }, 'indexer failed to start — agents must be manually registered')
  )

  // Start recurring task scheduler
  startScheduler()

  // 6. Start server
  app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV }, 'nexario api ready')
    logger.info(`  Health:     http://localhost:${env.PORT}/health`)
    logger.info(`  SDK info:   http://localhost:${env.PORT}/api/sdk`)
    logger.info(`  Agents:     http://localhost:${env.PORT}/api/agents`)
  })
}

start().catch((err) => {
  logger.fatal({ err }, 'startup failed')
  process.exit(1)
})

export default app
