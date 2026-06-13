import { Router } from 'express'
import { createTask, getTask, getUserTasks } from '../../services/taskRunner.js'
import { getActiveSession } from '../../lib/delegation/authorize.js'
import { requireUser } from '../middleware/auth.js'
import { TaskNotFoundError } from '../../lib/errors.js'
import { z } from 'zod'
import type { TaskRequest } from '../../types/index.js'

export const tasksRouter = Router()

const CreateTaskSchema = z.object({
  userMessage: z.string().min(1).max(2000),
  permissionsContext: z.string().min(1),
  delegationManager: z.string().startsWith('0x'),
  chainId: z.number().int().positive().optional(),
  chatId: z.string().optional(),
  source: z.enum(['web', 'telegram', 'api']).default('api'),
  telegramChatId: z.number().optional(),
  preferredAgentIds: z.array(z.number()).optional(),
  agentPreference: z.enum(['user', 'system', 'mix']).optional(),
})

const PlanTaskSchema = z.object({
  userMessage: z.string().min(1).max(2000),
  preferredAgentIds: z.array(z.number()).optional(),
})

// POST /api/task/plan — plan only, no execution (used before authorization)
tasksRouter.post('/plan', requireUser, async (req, res, next) => {
  try {
    const body = PlanTaskSchema.parse(req.body)
    const userAddress = req.userAddress!

    const { detectUserAgents, buildAgentChoiceMessage } = await import('../../agents/coordinator.js')
    const { classifyPrivacy, getPrivacyNotice } = await import('../../agents/coordinator.js')
    const { getOrCreateSession, buildContextPrompt } = await import('../../lib/privacy/context.js')

    // Detect user's own agents
    const userAgentResult = await detectUserAgents(userAddress)

    // Classify privacy
    const privacy = await classifyPrivacy(body.userMessage)
    const privacyNotice = getPrivacyNotice(privacy)

    // Build plan preview without executing
    const planPreview = {
      userMessage: body.userMessage,
      hasUserAgents: userAgentResult.hasUserAgents,
      userAgents: userAgentResult.agents,
      privacyScore: privacy.score,
      privacyCategories: privacy.categories,
      requiresTEE: privacy.requiresTEE,
      privacyNotice,
      suggestedAgents: privacy.requiresTEE
        ? ['counsel', 'intelligence', 'reflection']
        : ['research', 'audit', 'report'],
      agentChoiceMessage: userAgentResult.hasUserAgents
        ? buildAgentChoiceMessage(userAgentResult.agents)
        : null,
      needsAuth: false, // will be checked on execute
    }

    res.json(planPreview)
  } catch (err) {
    next(err)
  }
})

// POST /api/task — submit a new task
// Each user's task runs independently, multi-user safe
tasksRouter.post('/', requireUser, async (req, res, next) => {
  try {
    const body = CreateTaskSchema.parse(req.body)
    const userAddress = req.userAddress!
    const chainId = body.chainId ?? req.chainId ?? 11155111

    const request: TaskRequest = {
      userMessage: body.userMessage,
      userAddress,
      permissionsContext: body.permissionsContext as `0x${string}`,
      delegationManager: body.delegationManager as `0x${string}`,
      chainId,
      chatId: body.chatId,
      source: body.source,
      telegramChatId: body.telegramChatId,
      preferredAgentIds: body.preferredAgentIds,
      agentPreference: body.agentPreference,
    }

    const task = await createTask(request)

    res.status(202).json({
      taskId: task.taskId,
      status: task.status,
      message: 'Task queued — subscribe to /api/events/:taskId for live updates',
      eventsUrl: `/api/events/${task.taskId}`,
      delegationsUrl: `/api/delegations/${task.taskId}`,
    })
  } catch (err) {
    next(err)
  }
})

// GET /api/task/:taskId — get full task state
tasksRouter.get('/:taskId', requireUser, async (req, res, next) => {
  try {
    const task = await getTask(req.params['taskId']!)

    if (!task) throw new TaskNotFoundError(req.params['taskId']!)

    // Ownership check — users can only read their own tasks
    if (task.userAddress.toLowerCase() !== req.userAddress!.toLowerCase()) {
      res.status(403).json({ error: 'Access denied' })
      return
    }

    res.json(task)
  } catch (err) {
    next(err)
  }
})

// GET /api/tasks — list user's task history
tasksRouter.get('/', requireUser, async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query['limit'] as string) || 20, 100)
    const tasks = await getUserTasks(req.userAddress!, limit)
    res.json({ tasks, total: tasks.length })
  } catch (err) {
    next(err)
  }
})
