/**
 * Reputation Agent
 *
 * Builds comprehensive on-chain identity scores for wallet addresses.
 * Combines on-chain data with Venice AI analysis to produce
 * human-readable reputation profiles.
 *
 * Scoring dimensions:
 *   - Transaction history (volume, frequency, age)
 *   - Protocol interactions (DeFi, NFTs, DAOs)
 *   - Governance participation
 *   - Rug pull / scam exposure
 *   - Smart contract deployments
 *   - Token holdings quality
 */

import { chat } from '../lib/venice/chat.js'
import { createPublicClient, http, formatEther, isAddress } from 'viem'
import { mainnet } from 'viem/chains'
import { childLogger } from '../lib/logger.js'
import type { SubTaskOutput } from '../types/index.js'

const log = childLogger('agent:reputation')

export interface ReputationInput {
  subject: string
  targetAddress?: string
  includeTokens?: boolean
  includeProtocols?: boolean
}

export interface ReputationScore {
  overall: number      // 0-100
  dimensions: {
    activity: number
    diversity: number
    governance: number
    safety: number
    longevity: number
  }
  tier: 'unknown' | 'new' | 'established' | 'trusted' | 'whale' | 'suspicious'
  flags: string[]
  highlights: string[]
}

async function fetchWalletData(address: string): Promise<{
  balance: string
  txCount: number
  firstSeen?: number
  lastSeen?: number
  isContract: boolean
}> {
  try {
    const client = createPublicClient({
      chain: mainnet,
      transport: http('https://ethereum-rpc.publicnode.com'),
    })

    const [balance, txCount, code] = await Promise.all([
      client.getBalance({ address: address as `0x${string}` }),
      client.getTransactionCount({ address: address as `0x${string}` }),
      client.getCode({ address: address as `0x${string}` }),
    ])

    return {
      balance: formatEther(balance),
      txCount,
      isContract: !!(code && code !== '0x'),
    }
  } catch (err) {
    log.warn({ err, address }, 'failed to fetch wallet data')
    return { balance: '0', txCount: 0, isContract: false }
  }
}

function extractAddress(subject: string): string | null {
  const match = subject.match(/(0x[a-fA-F0-9]{40})/)
  return match?.[1] ?? null
}

function scoreDimensions(walletData: {
  txCount: number
  balance: string
  isContract: boolean
}): ReputationScore['dimensions'] {
  const { txCount, balance } = walletData
  const balanceNum = parseFloat(balance)

  return {
    activity: Math.min(100, (txCount / 1000) * 100),
    diversity: txCount > 100 ? 70 : txCount > 10 ? 40 : 10,
    governance: 0, // would need Snapshot/on-chain governance data
    safety: walletData.isContract ? 50 : 75, // contracts need more scrutiny
    longevity: txCount > 500 ? 90 : txCount > 100 ? 60 : txCount > 10 ? 30 : 10,
  }
}

function computeOverall(dimensions: ReputationScore['dimensions']): number {
  const weights = { activity: 0.25, diversity: 0.2, governance: 0.1, safety: 0.25, longevity: 0.2 }
  return Math.round(
    Object.entries(dimensions).reduce((sum, [key, val]) =>
      sum + (val * (weights[key as keyof typeof weights] ?? 0)), 0)
  )
}

function getTier(overall: number, txCount: number): ReputationScore['tier'] {
  if (txCount < 5) return 'new'
  if (overall < 20) return 'suspicious'
  if (overall < 40) return 'unknown'
  if (overall < 60) return 'established'
  if (overall < 80) return 'trusted'
  return 'whale'
}

export async function runReputation(
  input: ReputationInput,
  onChunk?: (delta: string) => void
): Promise<SubTaskOutput> {
  log.info({ subject: input.subject }, 'reputation agent running')

  // Extract address from subject
  const targetAddress = input.targetAddress ?? extractAddress(input.subject)

  let walletData = { balance: '0', txCount: 0, isContract: false, firstSeen: undefined as number | undefined, lastSeen: undefined as number | undefined }
  let score: ReputationScore | null = null

  if (targetAddress && isAddress(targetAddress)) {
    walletData = await fetchWalletData(targetAddress)
    const dimensions = scoreDimensions(walletData)
    const overall = computeOverall(dimensions)
    const tier = getTier(overall, walletData.txCount)
    const flags: string[] = []
    const highlights: string[] = []

    if (walletData.isContract) flags.push('Smart contract address')
    if (walletData.txCount === 0) flags.push('Never transacted')
    if (parseFloat(walletData.balance) > 100) highlights.push(`Holds ${parseFloat(walletData.balance).toFixed(2)} ETH`)
    if (walletData.txCount > 1000) highlights.push(`${walletData.txCount}+ transactions`)

    score = { overall, dimensions, tier, flags, highlights }
  }

  // Venice analysis
  const analysisContent = [
    targetAddress
      ? `Analyze reputation for wallet: ${targetAddress}`
      : `Analyze reputation context: ${input.subject}`,
    walletData.txCount > 0 ? `\nOn-chain data:
- ETH balance: ${walletData.balance}
- Transaction count: ${walletData.txCount}
- Is contract: ${walletData.isContract}` : '',
    score ? `\nCalculated scores:
- Overall: ${score.overall}/100
- Tier: ${score.tier}
- Flags: ${score.flags.join(', ') || 'none'}
- Highlights: ${score.highlights.join(', ') || 'none'}` : '',
    '\n\nProvide a reputation assessment with trust level, key indicators, and recommendation.',
  ].filter(Boolean).join('')

  const response = await chat({
    model: 'research', // kimi-k2 for web search on address
    messages: [{ role: 'user', content: analysisContent }],
    systemPrompt: `You are a blockchain reputation analyst. Assess wallet addresses based on on-chain behavior.
Be objective. Note both positive signals (active DeFi user, governance participation) and negative signals (rug exposure, suspicious patterns).
Provide actionable trust assessment. Always note data limitations.`,
    temperature: 0.2,
    maxTokens: 800,
    stream: !!onChunk,
    onChunk,
  })

  return {
    type: 'reputation',
    content: response.content,
    metadata: {
      targetAddress,
      score,
      walletData,
      model: response.model,
      tokensUsed: response.usage.totalTokens,
    },
  }
}
