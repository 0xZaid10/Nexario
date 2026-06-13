import type { Request, Response, NextFunction } from 'express'
import { env } from '../../config/env.js'
import { childLogger } from '../../lib/logger.js'

const log = childLogger('middleware:auth')

declare global {
  namespace Express {
    interface Request {
      userAddress?: `0x${string}`
      chainId?: number
      sessionId?: string
    }
  }
}

// API key check — accepts header or query param (SSE can't send headers)
export function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  const key = req.headers['x-api-key']
    ?? req.headers['authorization']?.replace('Bearer ', '')
    ?? (req.query['apiKey'] as string | undefined)

  if (!key || key !== env.NEXARIO_API_KEY) {
    res.status(401).json({ error: 'Invalid or missing API key' })
    return
  }

  next()
}

// Extract and validate userAddress from request
// Accepts header (standard) OR query param (SSE — EventSource doesn't support headers)
export function extractUser(req: Request, _res: Response, next: NextFunction): void {
  const address = (req.headers['x-user-address'] as string | undefined)
    ?? (req.query['userAddress'] as string | undefined)

  const chainId = req.headers['x-chain-id']
    ? parseInt(req.headers['x-chain-id'] as string)
    : undefined

  if (address?.startsWith('0x') && address.length === 42) {
    req.userAddress = address as `0x${string}`
  }

  if (chainId && !isNaN(chainId)) {
    req.chainId = chainId
  }

  next()
}

// Require valid userAddress — for user-scoped routes
export function requireUser(req: Request, res: Response, next: NextFunction): void {
  if (!req.userAddress) {
    res.status(400).json({
      error: 'Missing X-User-Address header',
      hint: 'Send your Ethereum address in X-User-Address header or ?userAddress= query param',
    })
    return
  }
  next()
}

// Rate limiting — simple in-memory per IP
const ipRequests = new Map<string, { count: number; resetAt: number }>()
const RATE_LIMIT = 60
const RATE_WINDOW_MS = 60_000

export function rateLimit(req: Request, res: Response, next: NextFunction): void {
  const ip = req.ip ?? 'unknown'
  const now = Date.now()
  const record = ipRequests.get(ip)

  if (!record || now > record.resetAt) {
    ipRequests.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS })
    next()
    return
  }

  if (record.count >= RATE_LIMIT) {
    res.status(429).json({
      error: 'Rate limit exceeded',
      retryAfter: Math.ceil((record.resetAt - now) / 1000),
    })
    return
  }

  record.count++
  next()
}
