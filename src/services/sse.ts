import type { Response } from 'express'
import { db, schema } from '../db/client.js'
import { childLogger } from '../lib/logger.js'
import type { TaskEvent } from '../types/index.js'

const log = childLogger('services:sse')

// Per-task SSE subscriber registry
// Map<taskId, Set<Response>> — multi-user safe, each task has its own set
const subscribers = new Map<string, Set<Response>>()

export function subscribe(taskId: string, res: Response): void {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no') // nginx: disable buffering
  res.flushHeaders()

  if (!subscribers.has(taskId)) {
    subscribers.set(taskId, new Set())
  }
  subscribers.get(taskId)!.add(res)

  log.debug({ taskId, total: subscribers.get(taskId)!.size }, 'SSE client subscribed')

  // Send all buffered events so reconnecting clients catch up
  replayBufferedEvents(taskId, res).then(async () => {
    // If task is already complete, close connection after replay
    const { db, schema } = await import('../db/client.js')
    const { eq } = await import('drizzle-orm')
    const task = await db.query.tasks.findFirst({
      where: eq(schema.tasks.taskId, taskId),
      columns: { status: true }
    })
    if (task?.status === 'completed' || task?.status === 'failed') {
      // Give client 500ms to process events then close
      setTimeout(() => {
        try { res.end() } catch {}
      }, 500)
    }
  }).catch((err) =>
    log.error({ taskId, err }, 'failed to replay buffered events')
  )

  res.on('close', () => {
    subscribers.get(taskId)?.delete(res)
    if (subscribers.get(taskId)?.size === 0) {
      subscribers.delete(taskId)
    }
    log.debug({ taskId }, 'SSE client disconnected')
  })
}

export async function emit(
  taskId: string,
  userAddress: string,
  type: TaskEvent['type'],
  data: Record<string, unknown>
): Promise<void> {
  const event: TaskEvent = {
    taskId,
    type,
    data,
    timestamp: Date.now(),
  }

  // Persist to DB buffer (for reconnecting clients)
  await db.insert(schema.sseEvents).values({
    taskId,
    userAddress,
    eventType: type,
    data,
  })

  // Broadcast to all live subscribers for this task
  const subs = subscribers.get(taskId)
  if (!subs || subs.size === 0) return

  const payload = formatSSE(event)

  for (const res of subs) {
    try {
      res.write(payload)
    } catch {
      subs.delete(res)
    }
  }

  log.debug({ taskId, type, subscribers: subs.size }, 'SSE event emitted')
}

async function replayBufferedEvents(
  taskId: string,
  res: Response
): Promise<void> {
  const buffered = await db.query.sseEvents.findMany({
    where: (t, { eq }) => eq(t.taskId, taskId),
    orderBy: (t, { asc }) => [asc(t.createdAt)],
  })

  for (const event of buffered) {
    try {
      res.write(
        formatSSE({
          taskId,
          type: event.eventType as TaskEvent['type'],
          data: event.data as Record<string, unknown>,
          timestamp: event.createdAt * 1000,
        })
      )
    } catch {
      break
    }
  }
}

function formatSSE(event: TaskEvent): string {
  // Use unnamed events (no 'event:' line) so EventSource.onmessage fires
  // Type is included in the data payload: event.type
  return `data: ${JSON.stringify({ ...event.data, type: event.type, taskId: event.taskId })}\n\n`
}

export function getSubscriberCount(taskId: string): number {
  return subscribers.get(taskId)?.size ?? 0
}

// User-level broadcast — pushes to all tasks the user is subscribed to
// Used for autonomous task notifications
const userSubscriptions = new Map<string, Set<string>>() // userAddress → taskIds

export function registerUserSubscription(userAddress: string, taskId: string): void {
  const addr = userAddress.toLowerCase()
  if (!userSubscriptions.has(addr)) userSubscriptions.set(addr, new Set())
  userSubscriptions.get(addr)!.add(taskId)
}

export const sseManager = {
  broadcastToUser(userAddress: string, event: Record<string, unknown>): void {
    const addr = userAddress.toLowerCase()
    const taskIds = userSubscriptions.get(addr)
    if (!taskIds || taskIds.size === 0) return

    // Push to all active task subscriptions for this user
    for (const taskId of taskIds) {
      const subs = subscribers.get(taskId)
      if (!subs) continue
      const formatted = `event: autonomous\ndata: ${JSON.stringify({ ...event, taskId })}\n\n`
      for (const res of subs) {
        try { res.write(formatted) } catch { /* client disconnected */ }
      }
    }
  }
}
