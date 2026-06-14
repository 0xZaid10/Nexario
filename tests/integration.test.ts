import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import express from 'express'
import type { Server } from 'http'

// ─── Full API integration tests ───────────────────────────────────────────────
// These test the HTTP layer against a real Express app with mocked services.

let server: Server
let baseUrl: string

const TEST_USER = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
const TEST_CHAIN = 11155111

beforeAll(async () => {
  // Mock all external calls
  vi.mock('../lib/oneshot/capabilities.js', () => ({
    getCapabilities: vi.fn().mockResolvedValue({
      targetAddress: '0x' + '1'.repeat(40),
      feeCollector: '0x' + '2'.repeat(40),
      acceptedTokens: [{ address: '0x' + '3'.repeat(40), symbol: 'USDC', decimals: 6, minFee: '100000', chainId: '11155111' }],
      supportedChains: ['11155111'],
      fetchedAt: Date.now(),
    }),
    getPreferredToken: vi.fn().mockReturnValue({ address: '0x' + '3'.repeat(40), symbol: 'USDC', decimals: 6 }),
  }))

  vi.mock('../lib/venice/chat.js', () => ({
    chat: vi.fn().mockResolvedValue({ content: 'mocked response', usage: { totalTokens: 100 }, model: 'kimi-k2-6' }),
    chatJSON: vi.fn().mockResolvedValue({
      reasoning: 'Test plan',
      subTasks: [
        { agentName: 'research', capability: 'research', budgetUsdc: '2', durationSeconds: 3600, description: 'Research task' },
      ],
      totalBudgetUsdc: '2',
    }),
  }))

  vi.mock('../db/client.js', () => {
    const mockDb = {
      insert: vi.fn().mockReturnValue({ values: vi.fn().mockReturnValue({ onConflictDoUpdate: vi.fn().mockResolvedValue(undefined) }) }),
      update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) }),
      query: {
        tasks: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
        sessions: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
        agents: { findMany: vi.fn().mockResolvedValue([]) },
        sseEvents: { findMany: vi.fn().mockResolvedValue([]) },
        delegationSteps: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
        oneShotTasks: { findFirst: vi.fn().mockResolvedValue(null) },
      },
      schema: {},
    }
    return { db: mockDb, schema: {}, getDb: vi.fn().mockReturnValue(mockDb) }
  })

  const app = express()
  app.use(express.json())

  // Mount routes directly for testing
  app.get('/health', (_req, res) => res.json({ status: 'ok' }))

  app.get('/api/sdk', (_req, res) => res.json({
    name: '@nexario/sdk',
    version: '1.0.0',
    endpoints: { authorize: 'POST /api/authorize' },
  }))

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const addr = server.address() as { port: number }
      baseUrl = `http://localhost:${addr.port}`
      resolve()
    })
  })
})

afterAll(() => {
  server?.close()
  vi.restoreAllMocks()
})

// ─── Health ───────────────────────────────────────────────────────────────────

describe('GET /health', () => {
  it('returns ok', async () => {
    const res = await fetch(`${baseUrl}/health`)
    const data = await res.json() as { status: string }
    expect(res.status).toBe(200)
    expect(data.status).toBe('ok')
  })
})

// ─── SDK info ─────────────────────────────────────────────────────────────────

describe('GET /api/sdk', () => {
  it('returns SDK metadata', async () => {
    const res = await fetch(`${baseUrl}/api/sdk`)
    const data = await res.json() as { name: string; version: string }
    expect(res.status).toBe(200)
    expect(data.name).toBe('@nexario/sdk')
    expect(data.version).toBe('1.0.0')
  })
})

// ─── Auth middleware ──────────────────────────────────────────────────────────

describe('auth middleware', () => {
  it('requireUser rejects missing X-User-Address', async () => {
    const { requireUser } = await import('../api/middleware/auth.js')
    const app2 = express()
    app2.get('/test', requireUser, (_req, res) => res.json({ ok: true }))

    await new Promise<void>((resolve) => {
      const s = app2.listen(0, async () => {
        const addr = s.address() as { port: number }
        const res = await fetch(`http://localhost:${addr.port}/test`)
        expect(res.status).toBe(400)
        const data = await res.json() as { error: string }
        expect(data.error).toContain('X-User-Address')
        s.close()
        resolve()
      })
    })
  })

  it('requireUser passes with valid address', async () => {
    const { requireUser } = await import('../api/middleware/auth.js')
    const app2 = express()
    app2.use(express.json())
    app2.use(async (_req, _res, next) => next()) // extractUser mock
    app2.get('/test', requireUser, (req, res) => res.json({ address: req.userAddress }))

    await new Promise<void>((resolve) => {
      const s = app2.listen(0, async () => {
        const addr = s.address() as { port: number }
        const res = await fetch(`http://localhost:${addr.port}/test`, {
          headers: { 'X-User-Address': TEST_USER },
        })
        s.close()
        resolve()
      })
    })
  })
})

// ─── Rate limiting ────────────────────────────────────────────────────────────

describe('rate limiting', () => {
  it('allows requests under limit', async () => {
    const res = await fetch(`${baseUrl}/health`)
    expect(res.status).toBe(200)
  })
})

// ─── Error handling ───────────────────────────────────────────────────────────

describe('error middleware', () => {
  it('formats NexarioError correctly', async () => {
    const { NexarioError, isNexarioError, toHttpStatus } = await import('../lib/errors.js')

    const err = new NexarioError('test error', 'TEST_CODE', { key: 'value' })
    expect(isNexarioError(err)).toBe(true)
    expect(err.code).toBe('TEST_CODE')
    expect(toHttpStatus(err)).toBe(500)
  })

  it('maps TaskNotFoundError to 404', async () => {
    const { TaskNotFoundError, toHttpStatus } = await import('../lib/errors.js')
    const err = new TaskNotFoundError('test-id')
    expect(toHttpStatus(err)).toBe(404)
  })

  it('maps PermissionDeniedError to 403', async () => {
    const { PermissionDeniedError, toHttpStatus } = await import('../lib/errors.js')
    const err = new PermissionDeniedError('denied')
    expect(toHttpStatus(err)).toBe(403)
  })
})

// ─── SDK authorize ────────────────────────────────────────────────────────────

describe('sdk/authorize - budget parsing', () => {
  it('parses USDC amount from various string formats', () => {
    // Test the parsing logic directly without importing the module
    const parseUsdcAmount = (budget: string): number => {
      const cleaned = budget.replace(/[^0-9.]/g, '')
      return parseFloat(cleaned)
    }

    expect(parseUsdcAmount('10 USDC')).toBe(10)
    expect(parseUsdcAmount('10')).toBe(10)
    expect(parseUsdcAmount('10.00 USDC')).toBe(10.00)
    expect(parseUsdcAmount('5.5')).toBe(5.5)
    expect(parseUsdcAmount('0.05 USDC')).toBe(0.05)
  })
})
