/**
 * Chat Thread Service
 *
 * Each chat thread is an independent authorization context:
 *   - Own ERC-7715 session + budget
 *   - Own agent requirements + caveats
 *   - Own delegation chain
 *   - Own message history
 *   - Runs indefinitely until user cancels or budget exhausted
 */

import { db } from '../db/client.js'
import { chatThreads, sessions } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { childLogger } from '../lib/logger.js'
import { randomUUID } from 'crypto'

const log = childLogger('services:chat-threads')

export interface ChatThreadInfo {
  chatId: string
  name: string
  description?: string
  sessionId?: string
  status: 'active' | 'expired' | 'archived'
  messageCount: number
  lastMessageAt?: number
  createdAt: number
  // Populated from joined session
  session?: {
    budgetUsdc: number
    spentUsdc: number
    remainingUsdc: number
    expiresAt: number
    agentRequirements?: Record<string, unknown>
    veniceQualityOracle?: boolean
    isExpired: boolean
    permissionsContext?: string
    delegationManager?: string
    sessionId?: string
    allowedActions?: string[]
  }
}

export async function createChatThread(params: {
  userAddress: string
  name?: string
  description?: string
  chatId?: string
}): Promise<string> {
  const chatId = params.chatId ?? randomUUID()
  const now = Math.floor(Date.now() / 1000)

  await db.insert(chatThreads).values({
    chatId,
    userAddress: params.userAddress.toLowerCase(),
    name: params.name ?? 'New Chat',
    description: params.description,
    status: 'active',
    messageCount: 0,
    createdAt: now,
    updatedAt: now,
  })

  log.info({ chatId, name: params.name }, 'chat thread created')
  return chatId
}

export async function getChatThread(chatId: string, userAddress: string) {
  return db.query.chatThreads.findFirst({
    where: and(
      eq(chatThreads.chatId, chatId),
      eq(chatThreads.userAddress, userAddress.toLowerCase())
    ),
  })
}

export async function getUserChatThreads(userAddress: string): Promise<ChatThreadInfo[]> {
  const threads = await db.query.chatThreads.findMany({
    where: and(
      eq(chatThreads.userAddress, userAddress.toLowerCase()),
    ),
    orderBy: [desc(chatThreads.updatedAt)],
    limit: 50,
  })

  const now = Math.floor(Date.now() / 1000)
  const result: ChatThreadInfo[] = []

  for (const thread of threads) {
    const info: ChatThreadInfo = {
      chatId: thread.chatId,
      name: thread.name,
      description: thread.description ?? undefined,
      sessionId: thread.sessionId ?? undefined,
      status: thread.status as any,
      messageCount: thread.messageCount,
      lastMessageAt: thread.lastMessageAt ?? undefined,
      createdAt: thread.createdAt,
    }

    // Attach session info if exists
    if (thread.sessionId) {
      const session = await db.query.sessions.findFirst({
        where: eq(sessions.sessionId, thread.sessionId),
      })

      if (session) {
        const budgetUsdc = Number(session.budgetUsdc) / 1_000_000
        const spentUsdc = Number(session.spentUsdc) / 1_000_000
        const isExpired = session.expiresAt < now || session.isRevoked

        info.session = {
          budgetUsdc,
          spentUsdc,
          remainingUsdc: budgetUsdc - spentUsdc,
          expiresAt: session.expiresAt,
          agentRequirements: session.agentRequirements as any,
          veniceQualityOracle: session.veniceQualityOracle ?? false,
          isExpired,
          permissionsContext: session.permissionsContext,
          delegationManager: session.delegationManager ?? undefined,
          sessionId: session.sessionId,
          allowedActions: session.allowedActions as string[] ?? [],
        }

        // Update thread status if session expired
        if (isExpired && thread.status === 'active') {
          await db.update(chatThreads)
            .set({ status: 'expired', updatedAt: now })
            .where(eq(chatThreads.chatId, thread.chatId))
          info.status = 'expired'
        }
      }
    }

    result.push(info)
  }

  return result
}

export async function updateChatThread(chatId: string, updates: {
  name?: string
  description?: string
  sessionId?: string
  status?: 'active' | 'expired' | 'archived'
  messageCount?: number
  lastMessageAt?: number
}): Promise<void> {
  await db.update(chatThreads)
    .set({
      ...updates,
      updatedAt: Math.floor(Date.now() / 1000),
    })
    .where(eq(chatThreads.chatId, chatId))
}

export async function incrementMessageCount(chatId: string): Promise<void> {
  const thread = await db.query.chatThreads.findFirst({
    where: eq(chatThreads.chatId, chatId),
  })
  if (!thread) return

  await db.update(chatThreads)
    .set({
      messageCount: thread.messageCount + 1,
      lastMessageAt: Math.floor(Date.now() / 1000),
      updatedAt: Math.floor(Date.now() / 1000),
    })
    .where(eq(chatThreads.chatId, chatId))
}

export async function archiveChatThread(chatId: string, userAddress: string): Promise<void> {
  await db.update(chatThreads)
    .set({ status: 'archived', updatedAt: Math.floor(Date.now() / 1000) })
    .where(and(
      eq(chatThreads.chatId, chatId),
      eq(chatThreads.userAddress, userAddress.toLowerCase())
    ))
  log.info({ chatId }, 'chat thread archived')
}

export async function renameChatThread(chatId: string, userAddress: string, name: string): Promise<void> {
  await db.update(chatThreads)
    .set({ name, updatedAt: Math.floor(Date.now() / 1000) })
    .where(and(
      eq(chatThreads.chatId, chatId),
      eq(chatThreads.userAddress, userAddress.toLowerCase())
    ))
}
