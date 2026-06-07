import type { Address } from 'viem'
import type { AgentCapability, DemoAgentName } from './agent.js'
import type { DelegationStep } from './delegation.js'

export type TaskStatus =
  | 'queued'
  | 'planning'
  | 'executing'
  | 'synthesizing'
  | 'completed'
  | 'failed'

export type TaskSource = 'web' | 'telegram' | 'api'

export interface TaskRequest {
  userMessage: string
  userAddress: Address
  permissionsContext: `0x${string}`
  delegationManager: Address
  chainId: number
  chatId?: string          // which chat this task belongs to
  source: TaskSource
  telegramChatId?: number
  preferredAgentIds?: number[]
  agentPreference?: 'user' | 'system' | 'mix'
  isAutonomous?: boolean
  scheduledTaskId?: string
}

export interface SubTask {
  subTaskId: string
  taskId: string
  agentName: DemoAgentName
  capability: AgentCapability
  input: Record<string, unknown>
  output?: SubTaskOutput
  status: TaskStatus
  budgetUsdc: bigint
  delegationStep?: DelegationStep
  startedAt?: number
  completedAt?: number
  error?: string
}

export interface SubTaskOutput {
  type: 'text' | 'json' | 'image' | 'audio' | 'combined'
  content: string
  imageUrl?: string
  audioUrl?: string
  metadata?: Record<string, unknown>
  // For executor agent — on-chain calldata to include in 1Shot bundle
  execution?: {
    target: `0x${string}`
    value: string
    data: `0x${string}`
  }
}

export interface ExecutionPlan {
  taskId: string
  reasoning: string
  subTasks: {
    agentName: DemoAgentName
    capability: AgentCapability
    budgetUsdc: string
    durationSeconds: number
    description: string
  }[]
  totalBudgetUsdc: string
}

export interface Task {
  taskId: string
  userMessage: string
  userAddress: Address
  chainId: number
  source: TaskSource
  telegramChatId?: number
  status: TaskStatus
  plan?: ExecutionPlan
  subTasks: SubTask[]
  delegationSteps: DelegationStep[]
  result?: TaskResult
  error?: string
  createdAt: number
  updatedAt: number
  completedAt?: number
}

export interface TaskResult {
  summary: string
  sections: {
    title: string
    content: string
    agentName: DemoAgentName
  }[]
  imageUrl?: string
  audioUrl?: string
  totalSpentUsdc: string
  delegationCount: number
  executionTimeMs: number
}

export interface TaskEvent {
  taskId: string
  type:
    | 'status_change'
    | 'plan_ready'
    | 'subtask_started'
    | 'subtask_completed'
    | 'delegation_confirmed'
    | 'result_ready'
    | 'error'
  data: Record<string, unknown>
  timestamp: number
}
