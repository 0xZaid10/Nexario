export class NexarioError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly context?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'NexarioError'
  }
}

export class DelegationError extends NexarioError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'DELEGATION_ERROR', context)
    this.name = 'DelegationError'
  }
}

export class PermissionDeniedError extends NexarioError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'PERMISSION_DENIED', context)
    this.name = 'PermissionDeniedError'
  }
}

export class OneShotError extends NexarioError {
  constructor(
    message: string,
    public readonly oneShotCode?: number,
    context?: Record<string, unknown>
  ) {
    super(message, 'ONESHOT_ERROR', context)
    this.name = 'OneShotError'
  }
}

export class QuoteExpiredError extends OneShotError {
  constructor() {
    super('1Shot quote expired — re-estimate required', 4204)
    this.name = 'QuoteExpiredError'
  }
}

export class InsufficientPaymentError extends OneShotError {
  constructor(required: string, provided: string) {
    super('Insufficient fee payment in delegation bundle', 4200, {
      required,
      provided,
    })
    this.name = 'InsufficientPaymentError'
  }
}

export class SimulationFailedError extends OneShotError {
  constructor(reason: string) {
    super(`Transaction simulation failed: ${reason}`, 4211, { reason })
    this.name = 'SimulationFailedError'
  }
}

export class VeniceError extends NexarioError {
  constructor(
    message: string,
    public readonly httpStatus?: number,
    context?: Record<string, unknown>
  ) {
    super(message, 'VENICE_ERROR', context)
    this.name = 'VeniceError'
  }
}

export class VeniceBalanceError extends VeniceError {
  constructor(walletAddress: string) {
    super('Venice x402 wallet has insufficient balance', 402, { walletAddress })
    this.name = 'VeniceBalanceError'
  }
}

export class RegistryError extends NexarioError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'REGISTRY_ERROR', context)
    this.name = 'RegistryError'
  }
}

export class TaskNotFoundError extends NexarioError {
  constructor(taskId: string) {
    super(`Task not found: ${taskId}`, 'TASK_NOT_FOUND', { taskId })
    this.name = 'TaskNotFoundError'
  }
}

export class AgentNotFoundError extends NexarioError {
  constructor(agentId: number | string) {
    super(`Agent not found: ${agentId}`, 'AGENT_NOT_FOUND', { agentId })
    this.name = 'AgentNotFoundError'
  }
}

export class BudgetExceededError extends NexarioError {
  constructor(allocated: string, attempted: string) {
    super('Sub-delegation budget exceeds parent allocation', 'BUDGET_EXCEEDED', {
      allocated,
      attempted,
    })
    this.name = 'BudgetExceededError'
  }
}

export class WebhookVerificationError extends NexarioError {
  constructor() {
    super(
      'Webhook Ed25519 signature verification failed',
      'WEBHOOK_VERIFY_FAILED'
    )
    this.name = 'WebhookVerificationError'
  }
}

export function isNexarioError(err: unknown): err is NexarioError {
  return err instanceof NexarioError
}

export function toHttpStatus(err: unknown): number {
  if (err instanceof TaskNotFoundError) return 404
  if (err instanceof AgentNotFoundError) return 404
  if (err instanceof PermissionDeniedError) return 403
  if (err instanceof WebhookVerificationError) return 401
  if (err instanceof BudgetExceededError) return 400
  if (err instanceof NexarioError) return 500
  return 500
}
