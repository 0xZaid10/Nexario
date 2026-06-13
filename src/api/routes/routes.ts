import { Router } from 'express'
import { getDelegationTree } from '../../services/delegationTracker.js'
import { markStepConfirmed, markStepFailed } from '../../services/delegationTracker.js'
import { subscribe } from '../../services/sse.js'
import { authorize } from '../../sdk/authorize.js'
import { getActiveSession, revokeSession } from '../../lib/delegation/authorize.js'
import { verifyAndParseWebhook } from '../../lib/oneshot/webhook.js'
import { requireUser } from '../middleware/auth.js'
import { childLogger } from '../../lib/logger.js'
import { z } from 'zod'

const log = childLogger('api:routes')

export const delegationsRouter = Router()
export const authorizeRouter = Router()
export const sseRouter = Router()
export const webhookRouter = Router()

// ─── Delegations ─────────────────────────────────────────────────────────────

// GET /api/delegations/:taskId — full delegation tree with tx hashes
delegationsRouter.get('/:taskId', requireUser, async (req, res, next) => {
  try {
    const tree = await getDelegationTree(req.params['taskId']!)
    res.json(tree)
  } catch (err) {
    next(err)
  }
})

// ─── Authorize ────────────────────────────────────────────────────────────────

// POST /api/authorize — create or retrieve session after MetaMask approval
// Frontend calls this after wallet_requestExecutionPermissions succeeds
authorizeRouter.post('/', requireUser, async (req, res, next) => {
  try {
    const agentRequirementSchema = z.object({
      minReputation: z.number().min(0).max(100).optional(),
      minRevenue: z.number().min(0).optional(),
      maxBudget: z.number().positive().optional(),
      requiredTrust: z.array(z.string()).optional(),
    })

    const body = z.object({
      permissionsContext: z.string().min(1),
      delegationManager: z.string().startsWith('0x'),
      chainId: z.number().int().positive().optional(),
      chatId: z.string().optional(),
      chatName: z.string().optional(),
      budget: z.string().default('10 USDC'),
      actions: z.array(z.string()).default(['research', 'audit', 'report']),
      durationHours: z.number().positive().max(720).default(24),
      agentRequirements: z.record(agentRequirementSchema).optional(),
      veniceQualityOracle: z.boolean().optional().default(false),
    }).parse(req.body)

    const result = await authorize({
      userAddress: req.userAddress!,
      chainId: body.chainId ?? req.chainId ?? 8453,
      chatId: body.chatId,
      chatName: body.chatName,
      permissionsContext: body.permissionsContext as `0x${string}`,
      delegationManager: body.delegationManager as `0x${string}`,
      budget: body.budget,
      actions: body.actions as any,
      durationHours: body.durationHours,
      agentRequirements: body.agentRequirements,
      veniceQualityOracle: body.veniceQualityOracle,
    })

    // Link session to chat thread if chatId provided
    if (body.chatId && result.sessionId) {
      const { updateChatThread } = await import('../../services/chatThreads.js')
      await updateChatThread(body.chatId, {
        sessionId: result.sessionId,
        status: 'active',
      })
    }

    res.json(result)
  } catch (err) {
    next(err)
  }
})

// ── Chat Thread routes ────────────────────────────────────────────────────────

// GET /api/authorize/chats — list all chat threads for user
authorizeRouter.get('/chats', requireUser, async (req, res, next) => {
  try {
    const { getUserChatThreads } = await import('../../services/chatThreads.js')
    const threads = await getUserChatThreads(req.userAddress!)
    res.json({ threads, total: threads.length })
  } catch (err) { next(err) }
})

// POST /api/authorize/chats — create a new chat thread
authorizeRouter.post('/chats', requireUser, async (req, res, next) => {
  try {
    const body = z.object({
      name: z.string().min(1).max(100).optional(),
      description: z.string().max(500).optional(),
    }).parse(req.body)

    const { createChatThread } = await import('../../services/chatThreads.js')
    const chatId = await createChatThread({
      userAddress: req.userAddress!,
      name: body.name,
      description: body.description,
    })

    res.json({ chatId, name: body.name ?? 'New Chat' })
  } catch (err) { next(err) }
})

// PATCH /api/authorize/chats/:chatId — rename or archive a chat
authorizeRouter.patch('/chats/:chatId', requireUser, async (req, res, next) => {
  try {
    const body = z.object({
      name: z.string().min(1).max(100).optional(),
      status: z.enum(['active', 'archived']).optional(),
    }).parse(req.body)

    const { renameChatThread, archiveChatThread } = await import('../../services/chatThreads.js')

    if (body.name) await renameChatThread(req.params['chatId']!, req.userAddress!, body.name)
    if (body.status === 'archived') await archiveChatThread(req.params['chatId']!, req.userAddress!)

    res.json({ success: true })
  } catch (err) { next(err) }
})

// GET /api/authorize/session — check active session status
authorizeRouter.get('/session', requireUser, async (req, res, next) => {
  try {
    const chainId = req.chainId ?? 8453
    const chatId = req.query['chatId'] as string | undefined
    const session = await getActiveSession(req.userAddress!, chainId, chatId)

    if (!session) {
      res.json({ active: false, message: 'No active session — connect MetaMask to authorize' })
      return
    }

    const budget = Number(session.budgetUsdc) / 1_000_000
    const spent = Number(session.spentUsdc) / 1_000_000

    res.json({
      active: true,
      sessionId: session.sessionId,
      budgetUsdc: budget,
      spentUsdc: spent,
      remainingUsdc: budget - spent,
      expiresAt: session.expiresAt,
      allowedActions: session.allowedActions,
      expiresIn: session.expiresAt - Math.floor(Date.now() / 1000),
      agentRequirements: session.agentRequirements ?? {},
      veniceQualityOracle: session.veniceQualityOracle ?? false,
    })
  } catch (err) {
    next(err)
  }
})

// DELETE /api/authorize/session — revoke active session
authorizeRouter.delete('/session', requireUser, async (req, res, next) => {
  try {
    // sessionId can come from body or we look up the active session
    const body = z.object({
      sessionId: z.string().optional(),
    }).parse(req.body ?? {})

    let sessionId = body.sessionId
    if (!sessionId) {
      const session = await getActiveSession(req.userAddress!)
      sessionId = session?.sessionId
    }

    if (!sessionId) {
      res.json({ success: true, message: 'No active session to revoke' })
      return
    }

    await revokeSession(sessionId, req.userAddress!)
    res.json({ success: true, message: 'Session revoked' })
  } catch (err) {
    next(err)
  }
})

// ─── SSE ──────────────────────────────────────────────────────────────────────

// GET /api/events/:taskId — SSE stream for live task updates
// Ownership enforced: only the task's owner can subscribe
sseRouter.get('/:taskId', requireUser, async (req, res, next) => {
  try {
    const { getTask } = await import('../../services/taskRunner.js')
    const task = await getTask(req.params['taskId']!)

    if (!task) {
      res.status(404).json({ error: 'Task not found' })
      return
    }

    if (task.userAddress.toLowerCase() !== req.userAddress!.toLowerCase()) {
      res.status(403).json({ error: 'Access denied' })
      return
    }

    subscribe(req.params['taskId']!, res)
  } catch (err) {
    next(err)
  }
})

// ─── Webhook ──────────────────────────────────────────────────────────────────

// POST /api/webhook/oneshot — receives 1Shot transaction confirmations
// No auth — verified by Ed25519 signature in the payload
webhookRouter.post('/oneshot', async (req, res) => {
  try {
    // Must read raw body — signature covers exact bytes
    const rawBody = (req as any).rawBody?.toString('utf8') ?? JSON.stringify(req.body)
    const bodyObj = req.body as any
    const signature = bodyObj.signature ?? ''
    // Save full payload for CLI debugging
    const { writeFileSync } = await import('fs')
    writeFileSync('/tmp/webhook_last.json', JSON.stringify({ rawBody, signature, body: bodyObj }, null, 2))
    log.info({ 
      hasRawBody: !!(req as any).rawBody, 
      rawBodyLen: rawBody?.length,
      sigLen: signature.length,
      rawBodySample: rawBody?.slice(0, 100)
    }, 'webhook debug — payload saved to /tmp/webhook_last.json')


    const event = await verifyAndParseWebhook(rawBody, signature)

    log.info(
      { type: event.type, oneShotTaskId: event.oneShotTaskId, txHash: event.txHash },
      '1Shot webhook received'
    )

    // Acknowledge immediately — process async
    res.status(200).json({ received: true })

    // Process the event
    if (event.type === 'confirmed' && event.txHash) {
      await markStepConfirmed(
        event.oneShotTaskId,
        event.txHash,
        event.blockNumber ?? 0,
        event.chainId,
        event.gasUsed
      )
    } else if (event.type === 'failed') {
      await markStepFailed(event.oneShotTaskId, 'reverted')
    } else if (event.type === 'rejected') {
      await markStepFailed(event.oneShotTaskId, 'rejected')
    }
    // type: 'pending' — status update only, no action needed

  } catch (err) {
    log.error({ err }, 'webhook processing failed')
    // Always return 200 to 1Shot — don't cause retries on our processing errors
    res.status(200).json({ received: true, warning: 'Processing error logged' })
  }
})

// POST /api/authorize/revoke-lease — revoke a specific on-chain lease
authorizeRouter.post('/revoke-lease', requireUser, async (req, res, next) => {
  try {
    const body = z.object({
      leaseId: z.string().min(1),
    }).parse(req.body)

    const { revokeOnChainLease } = await import('../../services/leaseRegistry.js')

    const txHash = await revokeOnChainLease(body.leaseId as `0x${string}`)

    res.json({
      success: true,
      leaseId: body.leaseId,
      txHash,
      explorerUrl: `https://basescan.org/tx/${txHash}`,
    })
  } catch (err) {
    next(err)
  }
})

// ── Scheduler routes ──────────────────────────────────────────────────────────

// GET /api/schedule — list user's scheduled tasks
authorizeRouter.get('/schedule', requireUser, async (req, res, next) => {
  try {
    const { listScheduledTasks } = await import('../../services/scheduler.js')
    const tasks = await listScheduledTasks(req.userAddress!)
    res.json({ tasks })
  } catch (err) { next(err) }
})

// POST /api/schedule — create a recurring task
authorizeRouter.post('/schedule', requireUser, async (req, res, next) => {
  try {
    const body = z.object({
      name:     z.string().min(1).max(64),
      prompt:   z.string().min(1).max(2000),
      schedule: z.string().min(1),
      timezone: z.string().optional(),
    }).parse(req.body)

    const session = await getActiveSession(req.userAddress!)
    if (!session) {
      res.status(401).json({ error: 'No active session. Authorize first.' })
      return
    }

    const { createScheduledTask, describeSchedule, parseNextRun } = await import('../../services/scheduler.js')

    const id = await createScheduledTask({
      userAddress: req.userAddress!,
      sessionId: session.sessionId,
      name: body.name,
      prompt: body.prompt,
      schedule: body.schedule,
      timezone: body.timezone,
      permissionsContext: session.permissionsContext ?? '0x',
      delegationManager: session.delegationManager ?? '0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3',
    })

    res.json({
      id,
      name: body.name,
      schedule: body.schedule,
      description: describeSchedule(body.schedule),
      nextRunAt: parseNextRun(body.schedule),
    })
  } catch (err) { next(err) }
})

// DELETE /api/schedule/:id — cancel a scheduled task
authorizeRouter.delete('/schedule/:id', requireUser, async (req, res, next) => {
  try {
    const { deleteScheduledTask } = await import('../../services/scheduler.js')
    await deleteScheduledTask(req.params['id']!, req.userAddress!)
    res.json({ success: true })
  } catch (err) { next(err) }
})

// ── Chat message routes ───────────────────────────────────────────────────────

// GET /api/chat/messages — get chat thread
authorizeRouter.get('/chat/messages', requireUser, async (req, res, next) => {
  try {
    const { getMessages } = await import('../../services/chatMessages.js')
    const sessionId = req.query['sessionId'] as string | undefined
    const messages = await getMessages(req.userAddress!, sessionId)
    res.json({ messages })
  } catch (err) { next(err) }
})
