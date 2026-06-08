import type { Address, Hex } from 'viem'
import { createSession, getActiveSession } from '../lib/delegation/authorize.js'
import { childLogger } from '../lib/logger.js'
import type { LeaseParams, LeaseResponse, AgentCapability } from '../types/index.js'

const log = childLogger('sdk:authorize')

export interface AuthorizeParams {
  userAddress: Address
  chainId: number
  chatId?: string          // which chat this session belongs to
  chatName?: string        // user-defined chat name
  permissionsContext: Hex
  delegationManager: Address
  budget: string
  actions: AgentCapability[]
  durationHours?: number
  agentRequirements?: Record<string, {
    minReputation?: number
    minRevenue?: number
    maxBudget?: number
    requiredTrust?: string[]
  }>
  veniceQualityOracle?: boolean
}

export interface AuthorizeResult {
  leaseId: string
  sessionId?: string
  sessionActive: boolean
  budgetUsdc: number
  remainingUsdc: number
  expiresAt: number
  permissionsContext: Hex
  delegationManager: Address
  chatId?: string
  agentRequirements?: Record<string, unknown>
  veniceQualityOracle?: boolean
}

export async function authorize(params: AuthorizeParams): Promise<AuthorizeResult> {
  const budgetUsdc = parseUsdcAmount(params.budget)
  const durationSeconds = (params.durationHours ?? 24) * 3600

  // Check for existing active session for this chat
  const existing = await getActiveSession(params.userAddress, params.chainId, params.chatId)
  if (existing && existing.chatId === (params.chatId ?? null)) {
    log.info(
      { userAddress: params.userAddress, sessionId: existing.sessionId, chatId: params.chatId },
      'reusing existing active session'
    )
    const budget = Number(existing.budgetUsdc) / 1_000_000
    const spent = Number(existing.spentUsdc) / 1_000_000
    return {
      leaseId: existing.sessionId,
      sessionId: existing.sessionId,
      sessionActive: true,
      budgetUsdc: budget,
      remainingUsdc: budget - spent,
      expiresAt: existing.expiresAt,
      permissionsContext: existing.permissionsContext as Hex,
      delegationManager: existing.delegationManager as Address,
      chatId: existing.chatId ?? undefined,
      agentRequirements: existing.agentRequirements as any,
      veniceQualityOracle: existing.veniceQualityOracle ?? false,
    }
  }

  const lease = await createSession({
    userAddress: params.userAddress,
    chainId: params.chainId,
    chatId: params.chatId,
    chatName: params.chatName,
    permissionsContext: params.permissionsContext,
    delegationManager: params.delegationManager,
    budgetUsdc,
    actions: params.actions,
    durationSeconds,
    agentRequirements: params.agentRequirements,
    veniceQualityOracle: params.veniceQualityOracle,
  })

  log.info(
    { userAddress: params.userAddress, leaseId: lease.leaseId, budgetUsdc, chatId: params.chatId },
    'new session authorized'
  )

  return {
    leaseId: lease.leaseId,
    sessionId: lease.leaseId,
    sessionActive: true,
    budgetUsdc,
    remainingUsdc: budgetUsdc,
    expiresAt: lease.expiresAt,
    permissionsContext: params.permissionsContext,
    delegationManager: params.delegationManager,
    chatId: params.chatId,
    agentRequirements: params.agentRequirements,
    veniceQualityOracle: params.veniceQualityOracle ?? false,
  }
}

function parseUsdcAmount(budget: string): number {
  const cleaned = budget.replace(/[^0-9.]/g, '')
  const amount = parseFloat(cleaned)
  if (isNaN(amount) || amount <= 0) throw new Error(`Invalid budget: ${budget}`)
  return amount
}
