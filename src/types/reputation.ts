import type { Address } from 'viem'
import type { AgentId } from './agent.js'

export type TagName =
  | 'starred'
  | 'reachable'
  | 'ownerVerified'
  | 'uptime'
  | 'successRate'
  | 'responseTime'
  | 'revenues'
  | 'teeVerified'
  | 'e2eeVerified'
  | 'delegationDepth'
  | 'inferenceTokens'
  | 'modelTier'
  | 'crossChainOps'
  | 'caveatCompliance'
  | 'taskLatency'
  | 'refundRate'
  | 'subDelegatesActive'

export type TagCategory = 'spec' | 'novel'

export type ModelTier = 'frontier' | 'mid' | 'open'

export type RevenueWindow = 'day' | 'week' | 'month' | 'year'

export interface FeedbackTag {
  tag1: TagName
  tag2?: string
  value: bigint
  valueDecimals: number
}

export interface FeedbackRecord {
  agentId: AgentId
  clientAddress: Address
  feedbackIndex: bigint
  tag1: TagName
  tag2?: string
  value: bigint
  valueDecimals: number
  isRevoked: boolean
  endpoint?: string
  feedbackURI?: string
  feedbackHash?: `0x${string}`
  blockNumber: bigint
  txHash: `0x${string}`
  timestamp: number
}

export interface ReputationSummary {
  agentId: AgentId
  tag1: TagName
  tag2?: string
  count: bigint
  summaryValue: bigint
  summaryValueDecimals: number
}

export interface AgentReputationProfile {
  agentId: AgentId
  starred: number
  uptime: number
  successRate: number
  revenues: number
  responseTime: number
  caveatCompliance: number
  teeVerified: boolean
  inferenceTokens: number
  taskCount: number
  lastUpdated: number
}

export interface TagWriteParams {
  agentId: AgentId
  taskId: string
  executionTimeMs: number
  spentUsdc: bigint
  agentFeeAtoms?: bigint     // what agent actually earned (not total budget)
  veniceTokensUsed: number
  veniceModelId: string
  teeUsed: boolean
  e2eeUsed: boolean
  delegationDepth: number
  crossChain: boolean
  success: boolean
  refunded: boolean
}
