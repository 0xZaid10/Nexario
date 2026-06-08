import { createWalletClient, createPublicClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import type { Hex, Address } from 'viem'
import { env } from '../../config/env.js'
import { NEXARIO_CONTRACTS } from '../../config/contracts.js'
import { REGISTRY_CHAIN, getViemChain } from '../../config/chains.js'
import { db, schema } from '../../db/client.js'
import { childLogger } from '../logger.js'
import type { TagWriteParams, FeedbackTag } from '../../types/index.js'
import { getBackendAddress } from '../signature.js'

const log = childLogger('erc8004:reputation')

// Global oracle nonce — shared across all writeTagsOnChain calls
// Prevents nonce collisions when writing tags for multiple agents sequentially
let _globalOracleNonce: number | null = null
let _globalNonceAddress: string | null = null

async function acquireNextNonce(pub: any, address: string): Promise<number> {
  // Reset if different address (shouldn't happen but safety)
  if (_globalNonceAddress !== address.toLowerCase()) {
    _globalOracleNonce = null
    _globalNonceAddress = address.toLowerCase()
  }
  if (_globalOracleNonce === null) {
    _globalOracleNonce = await pub.getTransactionCount({ address, blockTag: 'pending' })
  }
  return _globalOracleNonce++
}

const REPUTATION_ABI = [
  {
    name: 'giveFeedback',
    type: 'function' as const,
    stateMutability: 'nonpayable' as const,
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'value', type: 'int128' },
      { name: 'valueDecimals', type: 'uint8' },
      { name: 'tag1', type: 'string' },
      { name: 'tag2', type: 'string' },
      { name: 'endpoint', type: 'string' },
      { name: 'feedbackURI', type: 'string' },
      { name: 'feedbackHash', type: 'bytes32' },
    ],
    outputs: [],
  },
] as const

const ZERO_BYTES32 = ('0x' + '00'.repeat(32)) as Hex

export function deriveTagsFromExecution(params: TagWriteParams): FeedbackTag[] {
  const tags: FeedbackTag[] = []

  // revenues — use agentFeeAtoms (what agent earned) not spentUsdc (total budget)
  const earnedAtoms = params.agentFeeAtoms ?? params.spentUsdc
  const revenueUsd = Number(earnedAtoms) / 1_000_000
  tags.push({
    tag1: 'revenues',
    tag2: 'task',
    value: BigInt(Math.round(revenueUsd * 100)),
    valueDecimals: 2,
  })

  // successRate
  tags.push({
    tag1: 'successRate',
    value: BigInt(params.success ? 100 : 0),
    valueDecimals: 0,
  })

  // responseTime
  tags.push({
    tag1: 'responseTime',
    value: BigInt(params.executionTimeMs),
    valueDecimals: 0,
  })

  // inferenceTokens
  if (params.veniceTokensUsed > 0) {
    tags.push({
      tag1: 'inferenceTokens',
      tag2: params.veniceModelId.startsWith('tts')
        ? 'venice-audio'
        : params.veniceModelId.startsWith('flux')
        ? 'venice-image'
        : 'venice-chat',
      value: BigInt(params.veniceTokensUsed),
      valueDecimals: 0,
    })
  }

  if (params.teeUsed) {
    tags.push({ tag1: 'teeVerified', value: 1n, valueDecimals: 0 })
  }

  if (params.e2eeUsed) {
    tags.push({ tag1: 'e2eeVerified', value: 1n, valueDecimals: 0 })
  }

  tags.push({
    tag1: 'delegationDepth',
    value: BigInt(params.delegationDepth),
    valueDecimals: 0,
  })

  if (params.crossChain) {
    tags.push({ tag1: 'crossChainOps', value: 1n, valueDecimals: 0 })
  }

  if (params.success) {
    tags.push({ tag1: 'caveatCompliance', value: 1n, valueDecimals: 0 })
  }

  if (params.refunded) {
    tags.push({ tag1: 'refundRate', value: 1n, valueDecimals: 0 })
  }

  return tags
}

/**
 * Write reputation tags after execution.
 *
 * feedbackHash = 1Shot mainnet txHash (payment proof)
 * callerAddress = user who paid (replaces oracle for payment-gated feedback)
 *
 * If no txHash (e.g. relay not confirmed yet) — falls back to oracle wallet.
 */
export async function writeTags(
  agentId: number,
  tags: FeedbackTag[],
  taskId: string,
  chainId = REGISTRY_CHAIN.id,
  feedbackHash?: Hex,
  callerPrivateKey?: Hex
): Promise<void> {
  if (
    !NEXARIO_CONTRACTS.REPUTATION_REGISTRY ||
    NEXARIO_CONTRACTS.REPUTATION_REGISTRY === '0x0'
  ) {
    await writeTagsToDb(agentId, tags, taskId, false, feedbackHash)
    log.warn({ agentId }, 'reputation registry not deployed — tags written to DB only')
    return
  }

  // Write to DB immediately
  await writeTagsToDb(agentId, tags, taskId, false, feedbackHash)

  // Write on-chain async
  // Sequential await — prevents oracle nonce collisions
  try {
    await writeTagsOnChain(agentId, tags, taskId, chainId, feedbackHash, callerPrivateKey)
  } catch (err) {
    log.error({ agentId, taskId, err }, 'failed to write tags on-chain')
  }
}

async function writeTagsOnChain(
  agentId: number,
  tags: FeedbackTag[],
  taskId: string,
  chainId: number,
  feedbackHash?: Hex,
  callerPrivateKey?: Hex
): Promise<void> {
  const chain = getViemChain(chainId)

  // Use caller's key (user who paid) if provided, else oracle/backend key
  const signingKey = callerPrivateKey ?? (env.ORACLE_PRIVATE_KEY ?? env.PRIVATE_KEY) as Hex
  const account = privateKeyToAccount(signingKey)
  const rpcUrl = process.env['BASE_RPC_URL'] ?? undefined
  const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) })
  const pub = createPublicClient({ chain, transport: http(rpcUrl) })

  // Each tag needs its own feedbackHash if payment-gated
  // Use the provided txHash for first tag, derive unique hashes for subsequent tags
  // (contract requires unique hash per feedback entry)
  for (let i = 0; i < tags.length; i++) {
    const tag = tags[i]!
    try {
      // Always generate a unique hash — zero hash causes "already used" revert
      let tagHash: Hex
      if (feedbackHash && feedbackHash !== '0x' && feedbackHash !== ZERO_BYTES32) {
        // XOR with tag index to make each hash unique per tag
        const hashBytes = Buffer.from(feedbackHash.slice(2), 'hex')
        hashBytes[31] = (hashBytes[31]! ^ i) & 0xff
        tagHash = ('0x' + hashBytes.toString('hex')) as Hex
      } else {
        // Generate unique hash from agentId + tag + timestamp + index
        const { keccak256, encodePacked } = await import('viem')
        tagHash = keccak256(encodePacked(
          ['uint256', 'string', 'uint256', 'uint256'],
          [BigInt(agentId), tag.tag1, BigInt(Date.now()), BigInt(i)]
        ))
      }

      log.info({ agentId, tag1: tag.tag1, tagHash, value: tag.value.toString(), valueDecimals: tag.valueDecimals }, 'writing tag on-chain')
      log.info({ agentId, tag1: tag.tag1, value: tag.value.toString(), valueDecimals: tag.valueDecimals, tagHash }, 'writing tag on-chain')
      const nonce = await acquireNextNonce(pub, account.address)
      const txHash = await walletClient.writeContract({
        nonce,
        address: NEXARIO_CONTRACTS.REPUTATION_REGISTRY,
        abi: REPUTATION_ABI,
        functionName: 'giveFeedback',
        args: [
          BigInt(agentId),
          tag.value,
          tag.valueDecimals,
          tag.tag1,
          tag.tag2 ?? '',
          '',
          '',
          tagHash,
        ],
      })

      log.debug({ agentId, tag1: tag.tag1, txHash }, 'tag written on-chain')
    } catch (err) {
      const msg = String(err)
      log.error({ agentId, tag1: tag.tag1, rawError: msg.slice(0, 300) }, 'RAW reputation write error')
    }
  }
}

async function writeTagsToDb(
  agentId: number,
  tags: FeedbackTag[],
  taskId: string,
  onChain: boolean,
  feedbackHash?: Hex
): Promise<void> {
  const clientAddress = getBackendAddress()

  const rows = tags.map((tag) => ({
    agentId,
    taskId,
    clientAddress,
    tag1: tag.tag1,
    tag2: tag.tag2,
    value: tag.value.toString(),
    valueDecimals: tag.valueDecimals,
    onChain,
    txHash: feedbackHash,
  }))

  await db.insert(schema.reputationTags).values(rows)
}

const SUMMARY_ABI = [
  {
    name: 'getSummary',
    type: 'function' as const,
    stateMutability: 'view' as const,
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'clientAddresses', type: 'address[]' },
      { name: 'tag1Filter', type: 'string' },
      { name: 'tag2Filter', type: 'string' },
    ],
    outputs: [
      { name: 'count', type: 'uint64' },
      { name: 'summaryValue', type: 'int128' },
      { name: 'summaryValueDecimals', type: 'uint8' },
    ],
  },
] as const

// Oracle address — whose feedback to count in summary
// Hardcoded to Nexario oracle — derived from ORACLE_PRIVATE_KEY at deploy time
function getOracleAddress(): `0x${string}` {
  const explicit = process.env['ORACLE_ADDRESS']
  if (explicit && explicit.startsWith('0x') && explicit !== '0x0000000000000000000000000000000000000000') {
    return explicit as `0x${string}`
  }
  // Hardcoded Nexario oracle — set ORACLE_ADDRESS in .env to override
  return '0x1C280993F1423dc3DC050aFE5bfe5FbBDb7b05c3'
}

async function readTagOnChain(
  publicClient: ReturnType<typeof createPublicClient>,
  agentId: number,
  tag1: string,
  tag2 = ''
): Promise<{ count: number; avg: number }> {
  if (
    !NEXARIO_CONTRACTS.REPUTATION_REGISTRY ||
    NEXARIO_CONTRACTS.REPUTATION_REGISTRY === '0x0'
  ) {
    return { count: 0, avg: 0 }
  }

  const oracle = getOracleAddress()
  if (oracle === '0x0000000000000000000000000000000000000000') {
    return { count: 0, avg: 0 }
  }

  // Retry up to 3 times with backoff
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const [count, sum] = await publicClient.readContract({
        address: NEXARIO_CONTRACTS.REPUTATION_REGISTRY,
        abi: SUMMARY_ABI,
        functionName: 'getSummary',
        args: [BigInt(agentId), [oracle], tag1, tag2],
      })

      const avg = count > 0n ? Number(sum) / Number(count) : 0
      return { count: Number(count), avg }
    } catch (err: any) {
      if (attempt < 2) {
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)))
        continue
      }
      return { count: 0, avg: 0 }
    }
  }
  return { count: 0, avg: 0 }
}

/**
 * Batch read reputation for multiple agents in ONE multicall RPC request.
 * Much faster and avoids rate limiting vs individual reads.
 */
export async function getBatchReputation(agentIds: number[]): Promise<Map<number, {
  totalRevenue: number
  successRate: number
  taskCount: number
  avgLatency: number
  teeVerifiedCount: number
  caveatComplianceCount: number
}>> {
  const results = new Map<number, ReturnType<typeof getBatchReputation> extends Promise<Map<number, infer V>> ? V : never>()

  if (
    !NEXARIO_CONTRACTS.REPUTATION_REGISTRY ||
    NEXARIO_CONTRACTS.REPUTATION_REGISTRY === '0x0' ||
    agentIds.length === 0
  ) {
    return results as any
  }

  const oracle = getOracleAddress()
  const chain = getViemChain(REGISTRY_CHAIN.id)
  const rpcUrl = process.env['BASE_RPC_URL'] ?? REGISTRY_CHAIN.rpcUrl
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) })

  // Build multicall contracts array — 2 calls per agent (successRate + revenues)
  const calls = agentIds.flatMap((agentId) => [
    {
      address: NEXARIO_CONTRACTS.REPUTATION_REGISTRY as `0x${string}`,
      abi: SUMMARY_ABI,
      functionName: 'getSummary' as const,
      args: [BigInt(agentId), [oracle], 'successRate', ''] as const,
    },
    {
      address: NEXARIO_CONTRACTS.REPUTATION_REGISTRY as `0x${string}`,
      abi: SUMMARY_ABI,
      functionName: 'getSummary' as const,
      args: [BigInt(agentId), [oracle], 'revenues', 'task'] as const,
    },
  ])

  try {
    const rawResults = await publicClient.multicall({
      contracts: calls,
      allowFailure: true,
    })

    agentIds.forEach((agentId, i) => {
      const repResult = rawResults[i * 2]
      const revResult = rawResults[i * 2 + 1]

      if (repResult?.status === 'failure') {
        log.warn({ agentId, error: (repResult as any).error?.message?.slice(0, 60) }, 'multicall rep failed for agent')
      }

      const successRate = repResult?.status === 'success' && repResult.result
        ? Number((repResult.result as any)[1])
        : 0

      const taskCount = repResult?.status === 'success' && repResult.result
        ? Number((repResult.result as any)[0])
        : 0

      const totalRevenue = revResult?.status === 'success' && revResult.result
        ? Number((revResult.result as any)[1]) / 100
        : 0

      log.debug({ agentId, successRate, taskCount, totalRevenue, repStatus: repResult?.status }, 'multicall result')

      results.set(agentId, {
        successRate,
        totalRevenue,
        taskCount,
        avgLatency: 0,
        teeVerifiedCount: 0,
        caveatComplianceCount: 0,
      })
    })
  } catch (err) {
    log.warn({ err }, 'multicall batch reputation failed')
  }

  return results as any
}

export async function getAgentReputation(agentId: number): Promise<{
  totalRevenue: number
  successRate: number
  taskCount: number
  avgLatency: number
  teeVerifiedCount: number
  caveatComplianceCount: number
}> {
  // Read directly from on-chain — no DB cache needed
  // This is always accurate and never stale
  if (
    !NEXARIO_CONTRACTS.REPUTATION_REGISTRY ||
    NEXARIO_CONTRACTS.REPUTATION_REGISTRY === '0x0'
  ) {
    return { totalRevenue: 0, successRate: 0, taskCount: 0, avgLatency: 0, teeVerifiedCount: 0, caveatComplianceCount: 0 }
  }

  const chain = getViemChain(REGISTRY_CHAIN.id)
  const rpcUrl = process.env['BASE_RPC_URL'] ?? REGISTRY_CHAIN.rpcUrl
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) })

  // Stagger reads to avoid rate limiting on public RPC
  const [successData, revenueData] = await Promise.all([
    readTagOnChain(publicClient, agentId, 'successRate'),
    readTagOnChain(publicClient, agentId, 'revenues', 'task'),
  ])

  // Minor fields — read sequentially with small delay
  await new Promise(r => setTimeout(r, 100))
  const [latencyData, teeData, complianceData] = await Promise.all([
    readTagOnChain(publicClient, agentId, 'responseTime'),
    readTagOnChain(publicClient, agentId, 'teeVerified'),
    readTagOnChain(publicClient, agentId, 'caveatCompliance'),
  ])

  return {
    totalRevenue: revenueData.avg / 100,  // stored in cents
    successRate: successData.avg,
    taskCount: successData.count,
    avgLatency: latencyData.avg,
    teeVerifiedCount: teeData.count,
    caveatComplianceCount: complianceData.count,
  }
}
