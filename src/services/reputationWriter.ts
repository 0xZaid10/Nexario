import { deriveTagsFromExecution, writeTags } from '../lib/erc8004/reputation.js'
import { updateAgentStats } from '../lib/erc8004/registry.js'
import { childLogger } from '../lib/logger.js'
import { DEMO_AGENTS } from '../agents/registry.js'
import type { TagWriteParams } from '../types/index.js'
import type { DemoAgentName } from '../types/index.js'

const log = childLogger('services:reputation-writer')

export interface ExecutionResult {
  taskId: string
  agentName: DemoAgentName
  success: boolean
  spentUsdc: bigint
  agentFeeAtoms?: bigint        // what agent earned in USDC atoms
  oneShotTaskId?: string        // 1Shot task ID = payment proof
  oneShotTxHash?: `0x${string}` // on-chain tx hash when confirmed
  executionStartMs: number
  veniceTokensUsed: number
  veniceModelId: string
  teeUsed: boolean
  e2eeUsed: boolean
  delegationDepth: number
  crossChain: boolean
  refunded: boolean
  chainId?: number
  userAddress?: string
}

export async function writeExecutionTags(result: ExecutionResult): Promise<void> {
  const agent = DEMO_AGENTS[result.agentName]
  if (!agent || agent.agentId === 0) {
    log.warn({ agentName: result.agentName }, 'agent not registered — skipping reputation write')
    return
  }

  const executionTimeMs = Date.now() - result.executionStartMs

  const params: TagWriteParams = {
    agentId: agent.agentId,
    taskId: result.taskId,
    executionTimeMs,
    spentUsdc: result.spentUsdc,
    agentFeeAtoms: result.agentFeeAtoms,  // actual agent earnings
    veniceTokensUsed: result.veniceTokensUsed,
    veniceModelId: result.veniceModelId,
    teeUsed: result.teeUsed,
    e2eeUsed: result.e2eeUsed,
    delegationDepth: result.delegationDepth,
    crossChain: result.crossChain,
    success: result.success,
    refunded: result.refunded,
  }

  const tags = deriveTagsFromExecution(params)

  log.debug(
    { agentName: result.agentName, agentId: agent.agentId, tagCount: tags.length },
    'writing reputation tags'
  )

  // Use 1Shot taskId as feedbackHash — proves payment on-chain
  // keccak256 of the 1Shot taskId gives a unique bytes32 per relay
  let feedbackHash: `0x${string}` | undefined
  if (result.oneShotTaskId) {
    const { keccak256, toBytes } = await import('viem')
    feedbackHash = keccak256(toBytes(result.oneShotTaskId))
  }

  // Write tags (DB immediately, on-chain async with payment proof)
  await writeTags(agent.agentId, tags, result.taskId, result.chainId, feedbackHash)

  // Update local agent stats
  await updateAgentStats(agent.agentId, {
    taskCount: 1,
    revenueUsdc: Number(result.spentUsdc) / 1_000_000,
    success: result.success,
  })

  log.info(
    { agentName: result.agentName, tagCount: tags.length, success: result.success },
    'reputation tags written'
  )
}

export async function writeAllAgentTags(
  taskId: string,
  results: ExecutionResult[]
): Promise<void> {
  // Write sequentially to avoid oracle wallet nonce collisions
  for (const r of results) {
    try {
      await writeExecutionTags(r)
    } catch (err) {
      log.error({ agentName: r.agentName, err }, 'reputation write failed')
    }
  }
}
