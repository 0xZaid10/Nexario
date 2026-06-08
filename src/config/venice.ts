import type { ModelTier } from '../types/index.js'

export const VENICE_BASE_URL = 'https://api.venice.ai/api/v1'

export const VENICE_MODELS = {
  coordinator: {
    id: 'qwen3-235b-a22b-instruct-2507',
    tier: 'mid' as ModelTier,
    contextWindow: 128000,
    supportsTee: false,
    supportsReasoning: true,
    description: 'Task planning and synthesis',
  },

  research: {
    id: 'kimi-k2-6',
    tier: 'mid' as ModelTier,
    contextWindow: 256000,
    supportsTee: false,
    supportsWebSearch: true,
    supportsWebScraping: true,
    description: 'Web research and on-chain data gathering',
  },

  audit: {
    id: 'qwen3-235b-a22b-thinking-2507',
    tier: 'mid' as ModelTier,
    contextWindow: 128000,
    supportsTee: false,
    supportsReasoning: true,
    supportsResponseSchema: true,
    description: 'Deep reasoning and structured analysis',
  },

  report: {
    id: 'kimi-k2-5',
    tier: 'mid' as ModelTier,
    contextWindow: 256000,
    supportsTee: false,
    description: 'Result synthesis and report generation',
  },

  tee: {
    id: 'e2ee-qwen3-5-122b-a10b',
    tier: 'open' as ModelTier,
    contextWindow: 32000,
    supportsTee: true,
    supportsE2EE: true,
    description: 'Private inference in hardware enclave',
  },
  'e2ee-qwen3-6-35b-a3b': {
    id: 'e2ee-qwen3-6-35b-a3b',
    tier: 'open' as ModelTier,
    contextWindow: 128000,
    supportsTee: true,
    supportsE2EE: true,
    description: 'TEE counsel/intelligence agent',
  },
  'e2ee-gemma-4-26b-a4b-uncensored-p': {
    id: 'e2ee-gemma-4-26b-a4b-uncensored-p',
    tier: 'open' as ModelTier,
    contextWindow: 128000,
    supportsTee: true,
    supportsE2EE: true,
    isUncensored: true,
    description: 'TEE reflection agent — uncensored',
  },

  image: {
    id: 'ideogram-v4',
    description: 'Chart and visual generation',
    pricePerImage: 0.04,
  },

  tts: {
    id: 'tts-kokoro',
    description: 'Audio summary generation',
    pricePerMillion: 3.5,
  },
} as const

export type VeniceAgentModel = keyof typeof VENICE_MODELS

export const VENICE_CRYPTO_RPC_NETWORKS = {
  'ethereum-mainnet': 1,
  'ethereum-sepolia': 11155111,
  'base-mainnet': 8453,
  'base-sepolia': 84532,
  'arbitrum-mainnet': 42161,
  'optimism-mainnet': 10,
  'polygon-mainnet': 137,
  'linea-mainnet': 59144,
  'avalanche-mainnet': 43114,
  'bsc-mainnet': 56,
  'zksync-mainnet': 324,
} as const

export type VeniceNetwork = keyof typeof VENICE_CRYPTO_RPC_NETWORKS

export function chainIdToVeniceNetwork(
  chainId: number
): VeniceNetwork | undefined {
  return (
    Object.entries(VENICE_CRYPTO_RPC_NETWORKS).find(
      ([, id]) => id === chainId
    )?.[0] as VeniceNetwork | undefined
  )
}

export const VENICE_ENDPOINTS = {
  chat: `${VENICE_BASE_URL}/chat/completions`,
  image: `${VENICE_BASE_URL}/image/generate`,
  tts: `${VENICE_BASE_URL}/audio/speech`,
  stt: `${VENICE_BASE_URL}/audio/transcriptions`,
  embeddings: `${VENICE_BASE_URL}/embeddings`,
  rpc: (network: VeniceNetwork) =>
    `${VENICE_BASE_URL}/crypto/rpc/${network}`,
  models: `${VENICE_BASE_URL}/models`,
  x402Balance: (address: string) =>
    `${VENICE_BASE_URL}/x402/balance/${address}`,
  x402TopUp: `${VENICE_BASE_URL}/x402/top-up`,
  x402Transactions: (address: string) =>
    `${VENICE_BASE_URL}/x402/transactions/${address}`,
  teeAttestation: (model: string, nonce: string) =>
    `${VENICE_BASE_URL}/tee/attestation?model=${model}&nonce=${nonce}`,
} as const

export const VENICE_RATE_LIMITS = {
  requestsPerMinute: 100,
  creditsPerDay: 10_000_000,
} as const

export const VENICE_X402_MIN_BALANCE_USD = 2
export const VENICE_X402_TOP_UP_AMOUNT_USD = 10
