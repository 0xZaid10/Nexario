/**
 * Chat Message Service
 *
 * Persists the full chat thread to SQLite so it survives server restarts.
 * Supports user messages, agent responses, autonomous executions, and system messages.
 */

import { db } from '../db/client.js'
import { chatMessages } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { childLogger } from '../lib/logger.js'
import { randomUUID } from 'crypto'

const log = childLogger('services:chat-messages')

export type MessageType = 'user' | 'agent' | 'autonomous' | 'system'

export interface ChatMessageData {
  id: string
  type: MessageType
  content: string
  taskId?: string
  scheduledBy?: string
  triggeredBy?: string
  isPrivate: boolean
  audioUrl?: string
  metadata?: Record<string, unknown>
  createdAt: number
}

export async function saveMessage(params: {
  userAddress: string
  sessionId: string
  type: MessageType
  content: string
  taskId?: string
  scheduledBy?: string
  triggeredBy?: string
  isPrivate?: boolean
  audioUrl?: string
  metadata?: Record<string, unknown>
}): Promise<string> {
  const id = randomUUID()
  const now = Math.floor(Date.now() / 1000)

  await db.insert(chatMessages).values({
    id,
    userAddress: params.userAddress.toLowerCase(),
    sessionId: params.sessionId,
    type: params.type,
    content: params.content,
    taskId: params.taskId,
    scheduledBy: params.scheduledBy,
    triggeredBy: params.triggeredBy,
    isPrivate: params.isPrivate ? 1 : 0,
    audioUrl: params.audioUrl,
    metadata: params.metadata ? JSON.stringify(params.metadata) : undefined,
    createdAt: now,
  })

  return id
}

export async function getMessages(
  userAddress: string,
  sessionId?: string,
  limit = 50
): Promise<ChatMessageData[]> {
  try {
    const query = sessionId
      ? db.select().from(chatMessages)
          .where(and(
            eq(chatMessages.userAddress, userAddress.toLowerCase()),
            eq(chatMessages.sessionId, sessionId)
          ))
      : db.select().from(chatMessages)
          .where(eq(chatMessages.userAddress, userAddress.toLowerCase()))

    const rows = await query
      .orderBy(desc(chatMessages.createdAt))
      .limit(limit)

    return rows.reverse().map((r) => ({
      id: r.id,
      type: r.type as MessageType,
      content: r.content,
      taskId: r.taskId ?? undefined,
      scheduledBy: r.scheduledBy ?? undefined,
      triggeredBy: r.triggeredBy ?? undefined,
      isPrivate: r.isPrivate === 1,
      audioUrl: r.audioUrl ?? undefined,
      metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
      createdAt: r.createdAt,
    }))
  } catch (err) {
    log.warn({ err }, 'failed to get messages')
    return []
  }
}

export async function getMessagesByTask(taskId: string): Promise<ChatMessageData[]> {
  try {
    const rows = await db.select()
      .from(chatMessages)
      .where(eq(chatMessages.taskId, taskId))
      .orderBy(chatMessages.createdAt)

    return rows.map((r) => ({
      id: r.id,
      type: r.type as MessageType,
      content: r.content,
      taskId: r.taskId ?? undefined,
      scheduledBy: r.scheduledBy ?? undefined,
      triggeredBy: r.triggeredBy ?? undefined,
      isPrivate: r.isPrivate === 1,
      audioUrl: r.audioUrl ?? undefined,
      metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
      createdAt: r.createdAt,
    }))
  } catch (err) {
    log.warn({ err }, 'failed to get messages by task')
    return []
  }
}
