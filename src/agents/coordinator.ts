import { chat, chatJSON } from '../lib/venice/chat.js'
import { buildSubDelegation } from '../lib/delegation/build.js'
import { childLogger } from '../lib/logger.js'
import { generateStepId, generateSubTaskId } from '../lib/signature.js'
import { usdcToAtoms } from '../lib/encoding.js'
import { classifyPrivacy, getPrivacyNotice } from '../lib/privacy/classifier.js'
import {
  getOrCreateSession,
  updateSessionWithTask,
  buildContextPrompt,
  getCachedResearch,
  setCachedResearch,
  extractAndSaveMemory,
} from '../lib/privacy/context.js'
import type { Address, Hex } from 'viem'
import type {
  ExecutionPlan,
  SubTask,
  DelegationStep,
  AgentCapability,
} from '../types/index.js'
import { DEMO_AGENTS } from './registry.js'

const log = childLogger('agent:coordinator')

// All available agent names
const ALL_AGENTS = [
  'research', 'audit', 'report',
  'monitor', 'executor', 'counsel',
  'reputation', 'intelligence', 'reflection',
] as const

type AgentName = typeof ALL_AGENTS[number]

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    reasoning: { type: 'string' },
    subTasks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          agentName: { type: 'string' },
          capability: { type: 'string' },
          budgetUsdc: { type: 'string' },
          durationSeconds: { type: 'number' },
          description: { type: 'string' },
          requiresPrivacy: { type: 'boolean' },
          executionParams: {
            type: 'object',
            properties: {
              action: { type: 'string' },
              token: { type: 'string' },
              amount: { type: 'string' },
              to: { type: 'string' },
            },
          },
        },
        required: ['agentName', 'capability', 'budgetUsdc', 'durationSeconds', 'description'],
      },
    },
    totalBudgetUsdc: { type: 'string' },
  },
  required: ['reasoning', 'subTasks', 'totalBudgetUsdc'],
}

export async function detectUserAgents(userAddress: string): Promise<{
  hasUserAgents: boolean
  agents: { agentId: number; name: string; capabilities: string[]; reputationScore: number }[]
}> {
  try {
    const { getAgentsByOwner } = await import('../lib/erc8004/registry.js')
    const userAgents = await getAgentsByOwner(userAddress)

    if (userAgents.length === 0) return { hasUserAgents: false, agents: [] }

    const agents = userAgents.map((a) => {
      const reg = a.registration as any
      return {
        agentId: a.agentId,
        name: reg?.name ?? `agent-${a.agentId}`,
        capabilities: (reg?.capabilities ?? a.capabilities ?? []) as string[],
        reputationScore: a.reputationScore ?? 0,
      }
    })

    return { hasUserAgents: true, agents }
  } catch {
    return { hasUserAgents: false, agents: [] }
  }
}

export function buildAgentChoiceMessage(userAgents: {
  agentId: number
  name: string
  capabilities: string[]
  reputationScore: number
}[]): string {
  const list = userAgents
    .map((a) => `  • **${a.name}** (agentId: ${a.agentId}, rep: ${a.reputationScore}, capabilities: ${a.capabilities.slice(0, 3).join(', ')})`)
    .join('\n')

  return `I found ${userAgents.length} agent${userAgents.length > 1 ? 's' : ''} registered to your wallet:\n\n${list}\n\nWould you like me to:\n1. **Use your agents** where their capabilities match\n2. **Let me choose** from the full Nexario network\n3. **Mix** — use yours where possible, fill gaps with system agents\n\nReply with 1, 2, or 3 — or just proceed and I'll use your agents by default.`
}

export function parseAgentPreference(message: string): 'user' | 'system' | 'mix' | null {
  const lower = message.toLowerCase().trim()
  if (/^1$|use (my|mine|own)|my agents/.test(lower)) return 'user'
  if (/^2$|you choose|let you|nexario|system|auto/.test(lower)) return 'system'
  if (/^3$|mix|both|combination/.test(lower)) return 'mix'
  return null
}
export async function planTask(params: {
  taskId: string
  userMessage: string
  userAddress: Address
  chainId: number
  availableBudgetUsdc: number
  sessionId: string
  preferredAgentIds?: number[]
  agentPreference?: 'user' | 'system' | 'mix'
}): Promise<ExecutionPlan & {
  privacyClassification: Awaited<ReturnType<typeof classifyPrivacy>>
  privacyNotice: string | null
}> {
  log.info({ taskId: params.taskId }, 'coordinator planning task')

  // ── Step 1: Classify privacy ─────────────────────────────────────────────
  const [privacyClassification, sessionCtx] = await Promise.all([
    classifyPrivacy(params.userMessage),
    Promise.resolve(getOrCreateSession(params.userAddress, params.sessionId)),
  ])

  const privacyNotice = getPrivacyNotice(privacyClassification)

  if (privacyClassification.requiresTEE) {
    log.info({
      score: privacyClassification.score,
      categories: privacyClassification.categories,
      model: privacyClassification.modelOverride,
    }, 'sensitive content detected — routing to TEE')
  }

  // ── Step 2: Build context from session + memory ──────────────────────────
  const contextPrompt = await buildContextPrompt(sessionCtx)

  // ── Step 3: Check research cache ─────────────────────────────────────────
  const cachedKeys: string[] = []
  const commonKeys = ['eth_price', 'gas_price', 'btc_price']
  for (const key of commonKeys) {
    if (getCachedResearch(sessionCtx, key)) {
      cachedKeys.push(key)
    }
  }

  // ── Step 4: Plan with privacy-aware model ────────────────────────────────
  // Use TEE model for planning if content is sensitive
  const planningModel = privacyClassification.requiresTEE
    ? privacyClassification.modelOverride ?? 'coordinator'
    : 'coordinator'

  const agentDescriptions = `
Available agents:
- research: live web search + on-chain data (prices, gas, contracts, wallets)
- audit: deep risk analysis with extended reasoning
- report: executive summary + TTS audio output
- monitor: watches on-chain conditions, sets up triggers
- executor: executes on-chain actions via 1Shot relay
- counsel: legal/contract/deal analysis via Venice TEE (private)
- reputation: on-chain wallet/address identity scoring
- intelligence: private competitive/business research via Venice TEE
- reflection: private journaling, wellness, personal reasoning via uncensored TEE`

  const privacyInstruction = privacyClassification.requiresTEE
    ? `\n⚠ PRIVACY MODE: This request contains sensitive content (${privacyClassification.categories.join(', ')}). Mark requiresPrivacy=true for all sub-tasks. Prefer counsel/intelligence/reflection agents.`
    : ''

  const cachedInstruction = cachedKeys.length > 0
    ? `\nCached data available (skip re-fetching): ${cachedKeys.join(', ')}`
    : ''

  // Build user agent instruction if they have preferred agents
  let userAgentInstruction = ''
  if (params.preferredAgentIds && params.preferredAgentIds.length > 0) {
    const pref = params.agentPreference ?? 'mix'
    if (pref === 'user') {
      userAgentInstruction = `\n🎯 USER AGENTS ONLY: Use only these agent IDs: [${params.preferredAgentIds.join(', ')}]. Do not use system agents.`
    } else if (pref === 'mix') {
      userAgentInstruction = `\n🎯 PREFERRED AGENTS: Prefer these agent IDs where capabilities match: [${params.preferredAgentIds.join(', ')}]. Fall back to system agents for gaps.`
    }
    // pref === 'system' — ignore user agents, use system
  }

  const plan = await chatJSON<Omit<ExecutionPlan, 'taskId'>>({
    model: 'coordinator',
    messages: [{
      role: 'user',
      content: [
        `User request: "${params.userMessage}"`,
        `Available budget: $${params.availableBudgetUsdc} USDC`,
        contextPrompt ? `\nContext:\n${contextPrompt}` : '',
        cachedInstruction,
        privacyInstruction,
        userAgentInstruction,
        `\nPlan the optimal agent workflow. Keep budgets conservative. Total must not exceed $${params.availableBudgetUsdc}.`,
      ].filter(Boolean).join('\n'),
    }],
    systemPrompt: `You are the Nexario coordinator. You decompose user tasks into sub-tasks for specialized agents.
${agentDescriptions}

Rules:
- Use research first for data gathering tasks
- Use audit for risk analysis (needs research output)
- Use report last for output generation — include after executor for on-chain actions to summarize the transaction result
- Use counsel for legal/contract/deal content
- Use intelligence for competitive/business research
- Use reflection for personal/wellness content
- Use reputation for wallet/address analysis
- Use monitor only for ongoing watch tasks
- Use executor when user wants to SEND or TRANSFER USDC/tokens to an address — ALWAYS include executor for these
- NOTE: SWAP/BUY/EXCHANGE crypto is NOT yet supported via delegation (ERC20PeriodTransferEnforcer blocks swap calldata). For swap requests, use research agent to explain current rates and suggest "send USDC to a DEX" as alternative.
- Mark requiresPrivacy=true if the sub-task handles sensitive data
- Reuse cached data when available — don't re-fetch same data

IMPORTANT: Return valid JSON with field "subTasks" (not "tasks"). Each subTask must have:
  agentName, capability, budgetUsdc (string like "0.3"), durationSeconds (number), description, requiresPrivacy (boolean)
  For executor: MUST include executionParams: { action: "transfer"|"swap", token: "USDC"|"ETH", amount: "0.1", to: "0x..." }
  CRITICAL: For send/transfer/swap tasks plan is: research → audit → executor → report

Return valid JSON only. No markdown, no explanation outside JSON.`,
    schema: PLAN_SCHEMA,
    temperature: 0,
    reasoningEffort: 'low',
  })

  return {
    taskId: params.taskId,
    ...plan,
    privacyClassification,
    privacyNotice,
  }
}

export async function createSubDelegations(params: {
  plan: ExecutionPlan
  parentPermissionsContext: Hex
  parentDelegation: DelegationStep
  coordinatorAddress: Address
  chainId: number
}): Promise<{ subTask: Partial<SubTask>; delegationStep: DelegationStep }[]> {
  const results = []

  for (const subTaskPlan of params.plan.subTasks) {
    const agentName = subTaskPlan.agentName as AgentName
    const demoAgent = DEMO_AGENTS[agentName as keyof typeof DEMO_AGENTS]
    if (!demoAgent) {
      log.warn({ agentName }, 'no demo agent registered for this agent type — skipping')
      continue
    }

    const budgetUsdc = usdcToAtoms(parseFloat(subTaskPlan.budgetUsdc))

    const subDelegation = await buildSubDelegation({
      delegate: demoAgent.address,
      budgetUsdc,
      actions: [subTaskPlan.capability as AgentCapability],
      durationSeconds: subTaskPlan.durationSeconds,
      parentDelegation: params.parentDelegation.delegation as any,
      chainId: params.chainId,
    })

    const stepId = generateStepId()

    const delegationStep: DelegationStep = {
      stepId,
      taskId: params.plan.taskId,
      agentName,
      agentAddress: demoAgent.address,
      parentStepId: params.parentDelegation.stepId,
      delegation: subDelegation.delegation as any,
      permissionContext: subDelegation.permissionContext,
      status: 'pending',
      budgetAllocated: budgetUsdc,
      budgetUsed: 0n,
      chainId: params.chainId,
    }

    results.push({
      subTask: {
        subTaskId: generateSubTaskId(),
        taskId: params.plan.taskId,
        agentName,
        capability: subTaskPlan.capability as AgentCapability,
        input: {
          description: subTaskPlan.description,
          requiresPrivacy: (subTaskPlan as any).requiresPrivacy ?? false,
        },
        status: 'queued' as const,
        budgetUsdc,
      },
      delegationStep,
    })
  }

  return results
}

export async function synthesizeResults(params: {
  taskId: string
  userMessage: string
  userAddress: string
  sessionId: string
  subTaskOutputs: { agentName: string; content: string }[]
  privacyClassification?: Awaited<ReturnType<typeof classifyPrivacy>>
  onChunk?: (delta: string) => void
}): Promise<string> {
  log.info({ taskId: params.taskId }, 'synthesizing results')

  const outputsText = params.subTaskOutputs
    .map((o) => `=== ${o.agentName.toUpperCase()} ===\n${o.content}`)
    .join('\n\n')

  // Use TEE model for synthesis if content was sensitive
  const synthesisModel = params.privacyClassification?.requiresTEE
    ? params.privacyClassification.modelOverride ?? 'coordinator'
    : 'report'  // lighter model for synthesis — avoids 429 on coordinator (qwen3-235b)

  const result = await chat({
    model: synthesisModel as any,
    messages: [{
      role: 'user',
      content: `Original request: "${params.userMessage}"\n\nAgent outputs:\n${outputsText}\n\nSynthesize into a clear, comprehensive final response.`,
    }],
    systemPrompt: 'You synthesize multi-agent outputs into a cohesive final report. Be concise and actionable.',
    temperature: 0.3,
    stream: !!params.onChunk,
    onChunk: params.onChunk,
  }).then((r) => r.content)

  // Update session context
  const sessionCtx = getOrCreateSession(params.userAddress as Address, params.sessionId)
  const agentsUsed = params.subTaskOutputs.map((o) => o.agentName)

  updateSessionWithTask(sessionCtx, {
    taskId: params.taskId,
    userMessage: params.userMessage,
    result: result.slice(0, 500),
    agentsUsed,
    privacyScore: params.privacyClassification?.score ?? 0,
    createdAt: Date.now(),
  }, params.privacyClassification ?? { score: 0, categories: ['none'], requiresTEE: false, requiresUncensored: false, reason: '' })

  // Extract and save learnable facts (skip if private)
  await extractAndSaveMemory(
    params.userAddress,
    params.userMessage,
    result,
    params.privacyClassification?.requiresTEE ?? false
  )

  return result
}

export { classifyPrivacy, getPrivacyNotice }
