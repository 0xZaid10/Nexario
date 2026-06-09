/**
 * Context Manager
 *
 * Manages two levels of context:
 *
 * 1. Session context (in-memory, per authorization period)
 *    - Recent task outputs
 *    - Research cache (avoid re-fetching same data)
 *    - Privacy profile for user
 *
 * 2. Persistent memory (SQLite)
 *    - User preferences learned over time
 *    - Watched assets/wallets
 *    - Past decisions and outcomes
 *    - Risk tolerance profile
 */

import { db } from '../../db/client.js'
import { userMemory } from '../../db/schema.js'
import { eq, desc } from 'drizzle-orm'
import { childLogger } from '../logger.js'
import type { PrivacyClassification } from './classifier.js'

const log = childLogger('context:manager')

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TaskSummary {
  taskId: string
  userMessage: string
  result: string
  agentsUsed: string[]
  privacyScore: number
  createdAt: number
}

export interface ResearchCache {
  key: string          // e.g. "eth_price", "agent:2:reputation"
  value: string
  fetchedAt: number
  ttlSeconds: number
}

export interface SessionContext {
  userAddress: string
  sessionId: string
  recentTasks: TaskSummary[]
  researchCache: Map<string, ResearchCache>
  privacyProfile: {
    averageScore: number
    prefersTEE: boolean
    sensitiveCategories: string[]
  }
  startedAt: number
}

export interface UserMemoryEntry {
  key: string
  value: string
  category: 'preference' | 'fact' | 'decision' | 'watchlist' | 'risk'
  isPrivate: boolean
  createdAt: number
  updatedAt: number
}

// ─── Session store (in-memory per server instance) ────────────────────────────

const sessionStore = new Map<string, SessionContext>()

const RESEARCH_TTL: Record<string, number> = {
  eth_price:    300,    // 5 minutes
  gas_price:    60,     // 1 minute
  agent_rep:    600,    // 10 minutes
  default:      300,
}

// ─── Session Context ──────────────────────────────────────────────────────────

export function getOrCreateSession(
  userAddress: string,
  sessionId: string
): SessionContext {
  const key = `${userAddress}:${sessionId}`
  const existing = sessionStore.get(key)
  if (existing) return existing

  const ctx: SessionContext = {
    userAddress,
    sessionId,
    recentTasks: [],
    researchCache: new Map(),
    privacyProfile: {
      averageScore: 0,
      prefersTEE: false,
      sensitiveCategories: [],
    },
    startedAt: Date.now(),
  }

  sessionStore.set(key, ctx)
  return ctx
}

export function updateSessionWithTask(
  ctx: SessionContext,
  task: TaskSummary,
  classification: PrivacyClassification
): void {
  // Add to recent tasks (keep last 10)
  ctx.recentTasks = [task, ...ctx.recentTasks].slice(0, 10)

  // Update privacy profile
  const scores = ctx.recentTasks.map((t) => t.privacyScore)
  ctx.privacyProfile.averageScore = scores.reduce((a, b) => a + b, 0) / scores.length
  ctx.privacyProfile.prefersTEE = ctx.privacyProfile.averageScore > 50

  for (const cat of classification.categories) {
    if (cat !== 'none' && !ctx.privacyProfile.sensitiveCategories.includes(cat)) {
      ctx.privacyProfile.sensitiveCategories.push(cat)
    }
  }
}

export function getCachedResearch(ctx: SessionContext, key: string): string | null {
  const cached = ctx.researchCache.get(key)
  if (!cached) return null

  const age = (Date.now() - cached.fetchedAt) / 1000
  if (age > cached.ttlSeconds) {
    ctx.researchCache.delete(key)
    return null
  }

  return cached.value
}

export function setCachedResearch(
  ctx: SessionContext,
  key: string,
  value: string,
  ttlSeconds?: number
): void {
  ctx.researchCache.set(key, {
    key,
    value,
    fetchedAt: Date.now(),
    ttlSeconds: ttlSeconds ?? RESEARCH_TTL[key] ?? RESEARCH_TTL['default']!,
  })
}

// ─── Persistent Memory ────────────────────────────────────────────────────────

export async function saveMemory(
  userAddress: string,
  key: string,
  value: string,
  category: UserMemoryEntry['category'],
  isPrivate = false
): Promise<void> {
  try {
    await db
      .insert(userMemory)
      .values({
        userAddress: userAddress.toLowerCase(),
        memoryKey: key,
        memoryValue: value,
        category,
        isPrivate: isPrivate ? 1 : 0,
        createdAt: Math.floor(Date.now() / 1000),
        updatedAt: Math.floor(Date.now() / 1000),
      })
      .onConflictDoUpdate({
        target: [userMemory.userAddress, userMemory.memoryKey],
        set: {
          memoryValue: value,
          updatedAt: Math.floor(Date.now() / 1000),
        },
      })
  } catch (err) {
    log.warn({ err, key }, 'failed to save memory')
  }
}

export async function getMemory(
  userAddress: string,
  category?: UserMemoryEntry['category']
): Promise<UserMemoryEntry[]> {
  try {
    const rows = await db
      .select()
      .from(userMemory)
      .where(eq(userMemory.userAddress, userAddress.toLowerCase()))
      .orderBy(desc(userMemory.updatedAt))
      .limit(50)

    const filtered = category
      ? rows.filter((r) => r.category === category)
      : rows

    return filtered.map((r) => ({
      key: r.memoryKey,
      value: r.memoryValue,
      category: r.category as UserMemoryEntry['category'],
      isPrivate: r.isPrivate === 1,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }))
  } catch (err) {
    log.warn({ err }, 'failed to get memory')
    return []
  }
}

export async function deleteMemory(
  userAddress: string,
  key: string
): Promise<void> {
  try {
    await db
      .delete(userMemory)
      .where(eq(userMemory.userAddress, userAddress.toLowerCase()))
  } catch (err) {
    log.warn({ err, key }, 'failed to delete memory')
  }
}

// ─── Context builder for coordinator prompt ───────────────────────────────────

export async function buildContextPrompt(
  ctx: SessionContext
): Promise<string> {
  const parts: string[] = []

  // Recent tasks this session
  if (ctx.recentTasks.length > 0) {
    parts.push('## Recent tasks this session:')
    for (const task of ctx.recentTasks.slice(0, 3)) {
      parts.push(`- "${task.userMessage.slice(0, 80)}" → ${task.result.slice(0, 100)}`)
    }
  }

  // Persistent memory
  const memories = await getMemory(ctx.userAddress)
  const publicMemories = memories.filter((m) => !m.isPrivate)

  if (publicMemories.length > 0) {
    parts.push('\n## User context:')
    const prefs = publicMemories.filter((m) => m.category === 'preference')
    const facts = publicMemories.filter((m) => m.category === 'fact')
    const watchlist = publicMemories.filter((m) => m.category === 'watchlist')

    if (prefs.length > 0) {
      parts.push('Preferences: ' + prefs.map((m) => `${m.key}=${m.value}`).join(', '))
    }
    if (facts.length > 0) {
      parts.push('Known facts: ' + facts.map((m) => `${m.key}: ${m.value}`).join('; '))
    }
    if (watchlist.length > 0) {
      parts.push('Watching: ' + watchlist.map((m) => m.value).join(', '))
    }
  }

  // Cached research available
  if (ctx.researchCache.size > 0) {
    const cached = [...ctx.researchCache.keys()]
    parts.push(`\n## Cached data available (don't re-fetch): ${cached.join(', ')}`)
  }

  return parts.length > 0 ? parts.join('\n') : ''
}

/**
 * Extract and save learnable facts from task results
 */
export async function extractAndSaveMemory(
  userAddress: string,
  userMessage: string,
  result: string,
  isPrivate: boolean
): Promise<void> {
  // Don't extract from private sessions
  if (isPrivate) return

  // Simple extraction patterns
  const patterns = [
    { pattern: /prefer[s]?\s+(\w+)/i, key: 'preference', category: 'preference' as const },
    { pattern: /risk tolerance[:\s]+(\w+)/i, key: 'risk_tolerance', category: 'risk' as const },
    { pattern: /watching\s+(0x[a-fA-F0-9]{40})/i, key: 'watched_wallet', category: 'watchlist' as const },
  ]

  for (const { pattern, key, category } of patterns) {
    const match = userMessage.match(pattern) ?? result.match(pattern)
    if (match?.[1]) {
      await saveMemory(userAddress, key, match[1], category, false)
    }
  }
}
