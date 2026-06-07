import type { Address, Hex } from 'viem'
import type { AgentCapability } from './agent.js'

export interface Caveat {
  enforcer: Address
  terms: Hex
}

export interface Delegation {
  delegate: Address
  delegator: Address
  authority: Hex
  caveats: Caveat[]
  salt: bigint
  signature: Hex
}

export interface AuthorizationTuple {
  chainId: number
  address: Address
  nonce: bigint
  yParity: number
  r: Hex
  s: Hex
}

// Per-agent requirements set by the user at delegation signing time
export interface AgentRequirement {
  minReputation?: number    // 0-100 successRate threshold. Default: 0 (no gate)
  minRevenue?: number       // USD total earned. Default: 0 (no gate)
  maxBudget?: number        // USDC per-agent budget cap override
  requiredTrust?: string[]  // e.g. ['reputation', 'tee-attestation']
}

export interface LeaseParams {
  budget: string
  actions: AgentCapability[]
  durationSeconds: number
  allowedTargets?: Address[]
  // User-defined requirements per agent name (e.g. 'research', 'audit')
  agentRequirements?: Record<string, AgentRequirement>
  // If true, Venice evaluates output quality and writes reputation after each task
  veniceQualityOracle?: boolean
}

export interface LeaseResponse {
  leaseId: string
  permissionsContext: Hex
  delegationManager: Address
  delegation: Delegation
  chainId: number
  expiresAt: number
  budgetUsdc: bigint
  remainingUsdc: bigint
  agentRequirements?: Record<string, AgentRequirement>
  veniceQualityOracle?: boolean
}

export interface SubLeaseParams {
  delegate: Address
  budgetUsdc: bigint
  actions: AgentCapability[]
  durationSeconds: number
  parentDelegation: Delegation
}

export interface SubLeaseResponse {
  permissionsContext: Hex
  delegation: Delegation
  taskId?: string
}

export interface ExecutionBundle {
  permissionContext: Hex
  transactions: {
    to: Address
    data: Hex
    value: Hex
  }[]
  authorizationList?: AuthorizationTuple[]
}

export interface DelegationStep {
  stepId: string
  taskId: string
  agentName: string
  agentAddress: Address
  parentStepId?: string
  delegation: Delegation
  permissionContext: Hex
  oneShotTaskId?: string
  txHash?: Hex
  blockNumber?: bigint
  status: DelegationStatus
  budgetAllocated: bigint
  budgetUsed: bigint
  createdAt: number
  confirmedAt?: number
}

export type DelegationStatus =
  | 'pending'
  | 'submitted'
  | 'confirmed'
  | 'rejected'
  | 'reverted'

export interface DelegationTree {
  taskId: string
  root: DelegationTreeNode
}

export interface DelegationTreeNode {
  step: DelegationStep
  children: DelegationTreeNode[]
}

export interface Delegation {
  delegate: Address
  delegator: Address
  authority: Hex
  caveats: Caveat[]
  salt: bigint
  signature: Hex
}

export interface AuthorizationTuple {
  chainId: number
  address: Address
  nonce: bigint
  yParity: number
  r: Hex
  s: Hex
}

export interface LeaseParams {
  budget: string
  actions: AgentCapability[]
  durationSeconds: number
  allowedTargets?: Address[]
}

export interface LeaseResponse {
  leaseId: string
  permissionsContext: Hex
  delegationManager: Address
  delegation: Delegation
  chainId: number
  expiresAt: number
  budgetUsdc: bigint
  remainingUsdc: bigint
}

export interface SubLeaseParams {
  delegate: Address
  budgetUsdc: bigint
  actions: AgentCapability[]
  durationSeconds: number
  parentDelegation: Delegation
}

export interface SubLeaseResponse {
  permissionsContext: Hex
  delegation: Delegation
  taskId?: string
}

export interface ExecutionBundle {
  permissionContext: Hex
  transactions: {
    to: Address
    data: Hex
    value: Hex
  }[]
  authorizationList?: AuthorizationTuple[]
}

export interface DelegationStep {
  stepId: string
  taskId: string
  agentName: string
  agentAddress: Address
  parentStepId?: string
  delegation: Delegation
  permissionContext: Hex
  oneShotTaskId?: string
  txHash?: Hex
  blockNumber?: bigint
  status: DelegationStatus
  budgetAllocated: bigint
  budgetUsed: bigint
  createdAt: number
  confirmedAt?: number
}

export type DelegationStatus =
  | 'pending'
  | 'submitted'
  | 'confirmed'
  | 'rejected'
  | 'reverted'

export interface DelegationTree {
  taskId: string
  root: DelegationTreeNode
}

export interface DelegationTreeNode {
  step: DelegationStep
  children: DelegationTreeNode[]
}
