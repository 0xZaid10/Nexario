import { registerAgent } from '../lib/erc8004/registry.js'
import { childLogger } from '../lib/logger.js'
import type { AgentRegistrationFile, AgentCapability } from '../types/index.js'
import { TARGET_CHAIN } from '../config/chains.js'

const log = childLogger('sdk:publish')

export interface PublishParams {
  name: string
  description: string
  capabilities: AgentCapability[]
  endpoint: string          // HTTPS endpoint for A2A/direct calls
  pricePerCallUsdc?: number // e.g. 0.05
  imageUrl?: string
  chainId?: number
}

export interface PublishResult {
  agentId: number
  txHash: `0x${string}`
  registryAddress: string
  explorerUrl: string
  x402Endpoint: string
}

// One call to make a capability discoverable, payable, and reputation-building.
// Wraps: ERC-8004 register() + agentURI construction + DB indexing
export async function publish(params: PublishParams): Promise<PublishResult> {
  const chainId = params.chainId ?? TARGET_CHAIN.id

  const registration: AgentRegistrationFile = {
    type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
    name: params.name,
    description: params.description,
    image: params.imageUrl,
    services: [
      {
        name: 'A2A',
        endpoint: `${params.endpoint}/.well-known/agent-card.json`,
        version: '0.3.0',
      },
      {
        name: 'web',
        endpoint: params.endpoint,
      },
    ],
    x402Support: true,
    active: true,
    registrations: [], // filled after on-chain registration
    supportedTrust: ['reputation'],
    pricing: params.pricePerCallUsdc
      ? { perCall: params.pricePerCallUsdc.toString(), currency: 'USDC' }
      : undefined,
  }

  // Encode as data URI for fully on-chain metadata (no IPFS dependency)
  const agentURI = `data:application/json;base64,${Buffer.from(
    JSON.stringify(registration)
  ).toString('base64')}`

  log.info({ name: params.name, endpoint: params.endpoint }, 'publishing capability')

  const { agentId, txHash } = await registerAgent({
    agentURI,
    registration,
    chainId,
  })

  const { getChain } = await import('../config/chains.js')
  const chain = getChain(chainId)

  return {
    agentId,
    txHash,
    registryAddress: (await import('../config/contracts.js')).NEXARIO_CONTRACTS.AGENT_REGISTRY,
    explorerUrl: chain.explorerTxUrl(txHash),
    x402Endpoint: `${params.endpoint}/x402`,
  }
}
