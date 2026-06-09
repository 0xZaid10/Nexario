import { chat } from '../lib/venice/chat.js'
import { getTokenMetadata, getEthBalance, getBlockNumber, chainIdToNetwork } from '../lib/venice/rpc.js'
import { childLogger } from '../lib/logger.js'
import type { SubTaskOutput } from '../types/index.js'

const log = childLogger('agent:research')

export interface ResearchInput {
  query: string
  tokenAddress?: string
  walletAddress?: string
  chainId?: number
  focusAreas?: string[]
}

export async function runResearch(
  input: ResearchInput,
  onChunk?: (delta: string) => void
): Promise<SubTaskOutput> {
  log.info({ query: input.query }, 'research agent running')

  // Gather on-chain data if addresses provided
  const onChainData: Record<string, unknown> = {}

  if (input.tokenAddress && input.chainId) {
    try {
      const network = chainIdToNetwork(input.chainId)
      const metadata = await getTokenMetadata(input.tokenAddress, network)
      onChainData['tokenMetadata'] = metadata
      log.debug({ tokenAddress: input.tokenAddress }, 'token metadata fetched')
    } catch (err) {
      log.warn({ err }, 'failed to fetch token metadata')
    }
  }

  if (input.walletAddress && input.chainId) {
    try {
      const network = chainIdToNetwork(input.chainId)
      const balance = await getEthBalance(input.walletAddress, network)
      onChainData['walletBalance'] = balance.toString()
    } catch (err) {
      log.warn({ err }, 'failed to fetch wallet balance')
    }
  }

  const onChainContext = Object.keys(onChainData).length > 0
    ? `\n\nOn-chain data retrieved:\n${JSON.stringify(onChainData, (_k, v) =>
        typeof v === 'bigint' ? v.toString() : v, 2)}`
    : ''

  const focusContext = input.focusAreas?.length
    ? `\n\nFocus areas: ${input.focusAreas.join(', ')}`
    : ''

  const response = await chat({
    model: 'research',
    messages: [{
      role: 'user',
      content: `Research task: ${input.query}${onChainContext}${focusContext}`,
    }],
    systemPrompt: `You are a research agent with access to real-time web data and blockchain information. 
Gather comprehensive, factual information. Include sources when available. 
Be thorough but concise. Focus on actionable intelligence.`,
    enableWebSearch: true,
    enableWebScraping: true,
    temperature: 0.2,
    maxTokens: 3000,
    stream: !!onChunk,
    onChunk,
  })

  return {
    type: 'text',
    content: response.content,
    metadata: {
      tokensUsed: response.usage.totalTokens,
      model: response.model,
      onChainDataFetched: Object.keys(onChainData),
    },
  }
}
