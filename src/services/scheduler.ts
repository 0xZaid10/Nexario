/**
 * Scheduler Service
 *
 * Runs recurring tasks autonomously using the user's ERC-7715 authorization.
 * Checks every minute for tasks due to run.
 * Pushes results via SSE to connected clients.
 *
 * Schedule formats:
 *   "every:5:minutes"
 *   "every:1:hours"
 *   "every:1:days"
 *   "daily:09:00"        — every day at 9:00 AM
 *   "weekly:1:09:00"     — every Monday at 9:00 AM (1=Mon, 7=Sun)
 */

import { db } from '../db/client.js'
import { scheduledTasks, chatMessages } from '../db/schema.js'
import { eq, lte, and } from 'drizzle-orm'
import { childLogger } from '../lib/logger.js'
import { randomUUID } from 'crypto'
import { sseManager } from './sse.js'

const log = childLogger('services:scheduler')

let schedulerInterval: ReturnType<typeof setInterval> | null = null

// ── Schedule parsing ──────────────────────────────────────────────────────────

export function parseNextRun(schedule: string, fromTime = Date.now()): number {
  const now = Math.floor(fromTime / 1000)

  // every:N:unit
  const everyMatch = schedule.match(/^every:(\d+):(minutes?|hours?|days?|weeks?)$/)
  if (everyMatch) {
    const n = parseInt(everyMatch[1]!)
    const unit = everyMatch[2]!
    const seconds = unit.startsWith('minute') ? n * 60
      : unit.startsWith('hour') ? n * 3600
      : unit.startsWith('day') ? n * 86400
      : n * 604800
    return now + seconds
  }

  // daily:HH:MM
  const dailyMatch = schedule.match(/^daily:(\d{2}):(\d{2})$/)
  if (dailyMatch) {
    const [, hh, mm] = dailyMatch
    const target = new Date()
    target.setHours(parseInt(hh!), parseInt(mm!), 0, 0)
    if (target.getTime() / 1000 <= now) {
      target.setDate(target.getDate() + 1)
    }
    return Math.floor(target.getTime() / 1000)
  }

  // weekly:DOW:HH:MM (1=Mon, 7=Sun)
  const weeklyMatch = schedule.match(/^weekly:(\d):(\d{2}):(\d{2})$/)
  if (weeklyMatch) {
    const [, dow, hh, mm] = weeklyMatch
    const target = new Date()
    const currentDow = target.getDay() || 7
    const targetDow = parseInt(dow!)
    let daysUntil = targetDow - currentDow
    if (daysUntil < 0 || (daysUntil === 0 && target.getHours() >= parseInt(hh!))) {
      daysUntil += 7
    }
    target.setDate(target.getDate() + daysUntil)
    target.setHours(parseInt(hh!), parseInt(mm!), 0, 0)
    return Math.floor(target.getTime() / 1000)
  }

  // Default: 1 hour from now
  return now + 3600
}

export function describeSchedule(schedule: string): string {
  const everyMatch = schedule.match(/^every:(\d+):(minutes?|hours?|days?)$/)
  if (everyMatch) return `Every ${everyMatch[1]} ${everyMatch[2]}`

  const dailyMatch = schedule.match(/^daily:(\d{2}):(\d{2})$/)
  if (dailyMatch) return `Daily at ${dailyMatch[1]}:${dailyMatch[2]}`

  const weeklyMatch = schedule.match(/^weekly:(\d):(\d{2}):(\d{2})$/)
  if (weeklyMatch) {
    const days = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    return `Weekly on ${days[parseInt(weeklyMatch[1]!)]} at ${weeklyMatch[2]}:${weeklyMatch[3]}`
  }

  return schedule
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

export async function createScheduledTask(params: {
  userAddress: string
  sessionId: string
  name: string
  prompt: string
  schedule: string
  timezone?: string
  permissionsContext: string
  delegationManager: string
}): Promise<string> {
  const id = randomUUID()
  const nextRunAt = parseNextRun(params.schedule)

  await db.insert(scheduledTasks).values({
    id,
    userAddress: params.userAddress.toLowerCase(),
    sessionId: params.sessionId,
    name: params.name,
    prompt: params.prompt,
    schedule: params.schedule,
    timezone: params.timezone ?? 'UTC',
    enabled: 1,
    runCount: 0,
    nextRunAt,
    permissionsContext: params.permissionsContext,
    delegationManager: params.delegationManager,
  })

  log.info({ id, name: params.name, nextRunAt, schedule: params.schedule }, 'scheduled task created')
  return id
}

export async function listScheduledTasks(userAddress: string) {
  return db.select()
    .from(scheduledTasks)
    .where(eq(scheduledTasks.userAddress, userAddress.toLowerCase()))
}

export async function cancelScheduledTask(id: string, userAddress: string): Promise<boolean> {
  const result = await db.update(scheduledTasks)
    .set({ enabled: 0, updatedAt: Math.floor(Date.now() / 1000) })
    .where(and(
      eq(scheduledTasks.id, id),
      eq(scheduledTasks.userAddress, userAddress.toLowerCase())
    ))

  log.info({ id }, 'scheduled task cancelled')
  return true
}

export async function deleteScheduledTask(id: string, userAddress: string): Promise<boolean> {
  await db.delete(scheduledTasks)
    .where(and(
      eq(scheduledTasks.id, id),
      eq(scheduledTasks.userAddress, userAddress.toLowerCase())
    ))
  return true
}

// ── Execution ─────────────────────────────────────────────────────────────────

async function runDueTasks(): Promise<void> {
  const now = Math.floor(Date.now() / 1000)

  const due = await db.select()
    .from(scheduledTasks)
    .where(and(
      eq(scheduledTasks.enabled, 1),
      lte(scheduledTasks.nextRunAt, now)
    ))
    .limit(10)

  if (due.length === 0) return

  log.info({ count: due.length }, 'running due scheduled tasks')

  for (const task of due) {
    try {
      await runScheduledTask(task)
    } catch (err) {
      log.error({ err, taskId: task.id }, 'scheduled task failed')
    }
  }
}

async function runScheduledTask(task: typeof scheduledTasks.$inferSelect): Promise<void> {
  log.info({ name: task.name, userAddress: task.userAddress }, 'executing scheduled task')

  const taskId = randomUUID()
  const now = Math.floor(Date.now() / 1000)

  // Save autonomous chat message BEFORE execution so user sees it firing
  const msgId = randomUUID()
  await db.insert(chatMessages).values({
    id: msgId,
    userAddress: task.userAddress,
    sessionId: task.sessionId,
    type: 'autonomous',
    content: `🤖 Running scheduled task: ${task.name}`,
    taskId,
    scheduledBy: task.name,
    triggeredBy: `Scheduled: ${describeSchedule(task.schedule)}`,
    isPrivate: 0,
    createdAt: now,
  })

  // Push autonomous trigger to SSE
  sseManager.broadcastToUser(task.userAddress, {
    type: 'autonomous_task_started',
    taskId,
    scheduledBy: task.name,
    triggeredBy: `Scheduled: ${describeSchedule(task.schedule)}`,
    prompt: task.prompt,
    timestamp: now * 1000,
  })

  // Check if this is a condition monitor (check condition first, only run if YES)
  const isConditionMonitor = task.prompt.startsWith('CHECK CONDITION:')
  if (isConditionMonitor) {
    const conditionMatch = task.prompt.match(/CHECK CONDITION: (.+?)\n\nIF CONDITION MET/)
    const triggerMatch = task.prompt.match(/IF CONDITION MET, RUN: (.+?)\n\nEXECUTION_PARAMS/)
    const checkPrompt = conditionMatch?.[1] ?? task.prompt
    
    // Quick research check
    try {
      const { runResearch } = await import('../agents/research.js')
      const checkResult = await runResearch({ query: checkPrompt })
      const answer = (checkResult.summary ?? checkResult.content ?? '').trim().toUpperCase()
      const conditionMet = answer.startsWith('YES') || answer.includes('YES,') || answer.includes('YES.')
      
      log.info({ condition: checkPrompt.slice(0, 50), answer: answer.slice(0, 20), conditionMet }, 'condition check result')
      
      if (!conditionMet) {
        // Condition not met — update schedule and skip
        const nextRunAt = parseNextRun(task.schedule)
        await db.update(scheduledTasks)
          .set({ runCount: task.runCount + 1, lastRunAt: now, nextRunAt })
          .where(eq(scheduledTasks.id, task.id))
        // Update the autonomous message
        await db.update(chatMessages)
          .set({ content: `🔍 Condition check: ${checkPrompt.slice(0, 60)}... → Not yet met. Next check: ${new Date(nextRunAt * 1000).toLocaleTimeString()}` })
          .where(eq(chatMessages.id, msgId))
        return
      }
      
      // Condition met — run trigger prompt
      log.info({ name: task.name }, 'condition met — firing trigger pipeline')
    } catch (err) {
      log.warn({ err }, 'condition check failed — skipping trigger')
      return
    }
  }

  // Submit the actual task via the task runner
  const { runTask } = await import('./taskRunner.js')
  await runTask({
    taskId,
    userMessage: task.prompt,
    userAddress: task.userAddress as `0x${string}`,
    sessionId: task.sessionId,
    permissionsContext: task.permissionsContext as `0x${string}`,
    delegationManager: task.delegationManager as `0x${string}`,
    chainId: 8453, // Base
    isAutonomous: true,
    scheduledTaskId: task.id,
  })

  // Update next run time
  const nextRunAt = parseNextRun(task.schedule)
  await db.update(scheduledTasks)
    .set({
      runCount: task.runCount + 1,
      lastRunAt: now,
      lastTaskId: taskId,
      nextRunAt,
      updatedAt: now,
    })
    .where(eq(scheduledTasks.id, task.id))

  log.info({ name: task.name, nextRunAt }, 'scheduled task completed, next run set')
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

export function startScheduler(): void {
  if (schedulerInterval) return

  log.info('scheduler started — checking every 60 seconds')
  // Check immediately on start
  runDueTasks().catch((err) => log.error({ err }, 'initial scheduler check failed'))

  schedulerInterval = setInterval(() => {
    runDueTasks().catch((err) => log.error({ err }, 'scheduler tick failed'))
  }, 60_000) // every minute
}

export function stopScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval)
    schedulerInterval = null
    log.info('scheduler stopped')
  }
}
