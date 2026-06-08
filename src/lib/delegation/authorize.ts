import { eq, and, gt, isNull } from 'drizzle-orm'
import { db, schema } from '../../db/client.js'
import { generateTaskId, generateSalt } from '../signature.js'
import { childLogger } from '../logger.js'
import { usdcToAtoms } from '../encoding.js'
import type { Address, Hex } from 'viem'
import type { LeaseParams, LeaseResponse, AgentCapability } from '../../types/index.js'

const log = childLogger('delegation:authorize')

// Called server-side after the frontend receives permissionsContext
// from wallet_requestExecutionPermissions (ERC-7715).
// We store the session so subsequent tasks reuse the same lease.
export async function createSession(params: {
  userAddress: Address
  chainId: number
  chatId?: string
  chatName?: string
  permissionsContext: Hex
  delegationManager: Address
  budgetUsdc: number
  actions: AgentCapability[]
  durationSeconds: number
  agentRequirements?: Record<string, {
    minReputation?: number
    minRevenue?: number
    maxBudget?: number
    requiredTrust?: string[]
  }>
  veniceQualityOracle?: boolean
}): Promise<LeaseResponse> {
  const sessionId = generateTaskId()
  const now = Math.floor(Date.now() / 1000)
  const expiresAt = now + params.durationSeconds
  const budgetAtoms = usdcToAtoms(params.budgetUsdc)

  // Revoke existing session for this chatId (or global if no chatId)
  if (params.chatId) {
    await db
      .update(schema.sessions)
      .set({ isRevoked: true })
      .where(
        and(
          eq(schema.sessions.userAddress, params.userAddress),
          eq(schema.sessions.chatId, params.chatId),
          eq(schema.sessions.isRevoked, false)
        )
      )
  } else {
    await db
      .update(schema.sessions)
      .set({ isRevoked: true })
      .where(
        and(
          eq(schema.sessions.userAddress, params.userAddress),
          eq(schema.sessions.chainId, params.chainId),
          eq(schema.sessions.isRevoked, false)
        )
      )
  }

  await db.insert(schema.sessions).values({
    sessionId,
    userAddress: params.userAddress,
    chainId: params.chainId,
    chatId: params.chatId ?? null,
    chatName: params.chatName ?? null,
    permissionsContext: params.permissionsContext,
    delegationManager: params.delegationManager,
    budgetUsdc: budgetAtoms.toString(),
    spentUsdc: '0',
    allowedActions: params.actions,
    expiresAt,
    isRevoked: false,
    agentRequirements: params.agentRequirements ?? null,
    veniceQualityOracle: params.veniceQualityOracle ?? false,
  })

  // Create/update chat thread in DB with session link
  if (params.chatId) {
    try {
      const { createChatThread } = await import('../../services/chatThreads.js')
      const { db, schema: s } = await import('../../db/client.js')
      const { eq } = await import('drizzle-orm')

      // Check if thread exists
      const existing = await db.query.chatThreads.findFirst({
        where: eq(s.chatThreads.chatId, params.chatId),
      })

      if (existing) {
        // Update existing thread with new session
        await db.update(s.chatThreads)
          .set({ sessionId: sessionId, updatedAt: Math.floor(Date.now() / 1000) })
          .where(eq(s.chatThreads.chatId, params.chatId))
      } else {
        // Create new thread
        await createChatThread({
          userAddress: params.userAddress,
          chatId: params.chatId,
          name: params.chatName ?? 'New Chat',
        })
        // Link session to thread
        await db.update(s.chatThreads)
          .set({ sessionId: sessionId })
          .where(eq(s.chatThreads.chatId, params.chatId))
      }
    } catch (err) { log.warn({ err }, 'chat thread upsert failed') }
  }

  log.info(
    {
      sessionId,
      userAddress: params.userAddress,
      budgetUsdc: params.budgetUsdc,
      agentRequirements: params.agentRequirements,
      veniceQualityOracle: params.veniceQualityOracle,
    },
    'session created'
  )

  return {
    leaseId: sessionId,
    permissionsContext: params.permissionsContext,
    delegationManager: params.delegationManager,
    delegation: {
      delegate: params.delegationManager,
      delegator: params.userAddress,
      authority: '0x' + '00'.repeat(32) as Hex,
      caveats: [],
      salt: generateSalt(),
      signature: '0x' as Hex,
    },
    chainId: params.chainId,
    expiresAt,
    budgetUsdc: budgetAtoms,
    remainingUsdc: budgetAtoms,
    agentRequirements: params.agentRequirements,
    veniceQualityOracle: params.veniceQualityOracle,
  }
}

export async function getActiveSession(
  userAddress: Address,
  chainId: number,
  chatId?: string
): Promise<typeof schema.sessions.$inferSelect | null> {
  const now = Math.floor(Date.now() / 1000)

  // If chatId provided, look for session scoped to that chat first
  if (chatId) {
    const chatSession = await db.query.sessions.findFirst({
      where: and(
        eq(schema.sessions.userAddress, userAddress),
        eq(schema.sessions.chatId, chatId),
        eq(schema.sessions.isRevoked, false),
        gt(schema.sessions.expiresAt, now)
      ),
    })
    if (chatSession) return chatSession
  }

  // Fallback: any active session for this user+chain (backward compat)
  const session = await db.query.sessions.findFirst({
    where: and(
      eq(schema.sessions.userAddress, userAddress),
      eq(schema.sessions.chainId, chainId),
      eq(schema.sessions.isRevoked, false),
      gt(schema.sessions.expiresAt, now)
    ),
    orderBy: (s, { desc }) => [desc(s.createdAt)],
  })

  return session ?? null
}

// Get all active sessions for a user (across all chats)
export async function getAllActiveSessions(
  userAddress: Address
): Promise<typeof schema.sessions.$inferSelect[]> {
  const now = Math.floor(Date.now() / 1000)
  return db.query.sessions.findMany({
    where: and(
      eq(schema.sessions.userAddress, userAddress),
      eq(schema.sessions.isRevoked, false),
      gt(schema.sessions.expiresAt, now)
    ),
    orderBy: (s, { desc }) => [desc(s.createdAt)],
  })
}

export async function deductFromSession(
  sessionId: string,
  spentUsdc: bigint
): Promise<void> {
  const session = await db.query.sessions.findFirst({
    where: eq(schema.sessions.sessionId, sessionId),
  })

  if (!session) return

  const newSpent = BigInt(session.spentUsdc) + spentUsdc

  await db
    .update(schema.sessions)
    .set({ spentUsdc: newSpent.toString() })
    .where(eq(schema.sessions.sessionId, sessionId))
}

export async function revokeSession(
  sessionId: string,
  userAddress: Address
): Promise<void> {
  await db
    .update(schema.sessions)
    .set({ isRevoked: true })
    .where(
      and(
        eq(schema.sessions.sessionId, sessionId),
        eq(schema.sessions.userAddress, userAddress)
      )
    )

  log.info({ sessionId, userAddress }, 'session revoked')
}

export async function getRemainingBudget(sessionId: string): Promise<bigint> {
  const session = await db.query.sessions.findFirst({
    where: eq(schema.sessions.sessionId, sessionId),
  })

  if (!session) return 0n

  const budget = BigInt(session.budgetUsdc)
  const spent = BigInt(session.spentUsdc)
  return budget > spent ? budget - spent : 0n
}
