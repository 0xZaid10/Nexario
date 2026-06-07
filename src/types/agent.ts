import type { Address } from 'viem'

export type AgentId = number

export type AgentCapability =
  | 'research'
  | 'audit'
  | 'report'
  | 'coordinate'
  | 'wallet-analysis'
  | 'contract-audit'
  | 'market-research'
  | 'custom'

export type TrustModel = 'reputation' | 'crypto-economic' | 'tee-attestation'

export interface AgentService {
  name: string
  endpoint: string
  version?: string
}

export interface AgentRegistrationFile {
  type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1'
  name: string
  description: string
  image?: string
  services: AgentService[]
  x402Support: boolean
  active: boolean
  registrations: {
    agentId: number
    agentRegistry: string
  }[]
  supportedTrust: TrustModel[]
  pricing?: {
    perCall?: string
    perSession?: string
    currency: 'USDC'
  }
}

export interface Agent {
  agentId: AgentId
  owner: Address
  wallet: Address
  agentURI: string
  registration: AgentRegistrationFile
  chainId: number
  registeredAt: number
  isActive: boolean
}

export interface IndexedAgent extends Agent {
  capabilities: AgentCapability[]
  reputationScore: number
  totalRevenue: number
  successRate: number
  taskCount: number
  lastSeen: number
}

export type DemoAgentName =
  | 'coordinator'
  | 'research'
  | 'audit'
  | 'report'

export interface DemoAgent {
  name: DemoAgentName
  agentId: AgentId
  address: Address
  wallet: Address
  privateKey: string      // for EIP-7702 signing
  capabilities: AgentCapability[]
  veniceModel: string
  isPrivate?: boolean
  teeVerified?: boolean
}
