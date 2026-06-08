export { authorize } from './authorize.js'
export type { AuthorizeParams, AuthorizeResult } from './authorize.js'

export { publish } from './publish.js'
export type { PublishParams, PublishResult } from './publish.js'

// Re-export key types developers need
export type {
  AgentCapability,
  LeaseParams,
  LeaseResponse,
  DelegationStep,
  DelegationTree,
  Task,
  TaskStatus,
  TaskResult,
  FeedbackTag,
  TagName,
} from '../types/index.js'
