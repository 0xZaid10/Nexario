import { eq, and } from 'drizzle-orm'
import { db, schema } from '../db/client.js'
import { emit } from './sse.js'
import { childLogger } from '../lib/logger.js'
import { getExplorerTxUrl } from '../config/chains.js'
import type { DelegationStep, DelegationTree, DelegationTreeNode } from '../types/index.js'
import type { Hex } from 'viem'

const log = childLogger('services:delegation-tracker')

export async function persistDelegationStep(
  step: Omit<DelegationStep, 'budgetUsed'> & { userAddress: string }
): Promise<void> {
  await db.insert(schema.delegationSteps).values({
    stepId: step.stepId,
    taskId: step.taskId,
    subTaskId: step.subTaskId,
    agentName: step.agentName,
    agentAddress: step.agentAddress,
    parentStepId: step.parentStepId,
    delegation: JSON.parse(JSON.stringify(step.delegation, (_k, v) =>
      typeof v === 'bigint' ? v.toString() : v
    )) as Record<string, unknown>,
    permissionContext: step.permissionContext,
    status: step.status,
    budgetAllocated: step.budgetAllocated.toString(),
    budgetUsed: '0',
    chainId: step.chainId,
  })

  await emit(step.taskId, step.userAddress, 'subtask_started', {
    stepId: step.stepId,
    agentName: step.agentName,
    budgetAllocated: step.budgetAllocated.toString(),
    status: 'pending',
  })

  log.debug({ stepId: step.stepId, agentName: step.agentName }, 'delegation step persisted')
}

export async function markStepSubmitted(
  stepId: string,
  oneShotTaskId: string,
  userAddress: string
): Promise<void> {
  const step = await db.query.delegationSteps.findFirst({
    where: eq(schema.delegationSteps.stepId, stepId),
  })
  if (!step) return

  await db
    .update(schema.delegationSteps)
    .set({ status: 'submitted', oneShotTaskId })
    .where(eq(schema.delegationSteps.stepId, stepId))

  // Track in oneShotTasks table
  await db.insert(schema.oneShotTasks).values({
    oneShotTaskId,
    delegationStepId: stepId,
    taskId: step.taskId,
    userAddress,
    chainId: step.chainId,
    status: 'Pending',
    memo: `nexario:${oneShotTaskId}:${step.taskId}`,
  })

  await emit(step.taskId, userAddress, 'subtask_started', {
    stepId,
    agentName: step.agentName,
    oneShotTaskId,
    status: 'submitted',
  })

  log.debug({ stepId, oneShotTaskId }, 'step marked submitted')
}

export async function markStepConfirmed(
  oneShotTaskId: string,
  txHash: Hex,
  blockNumber: number,
  chainId: number,
  gasUsed?: string
): Promise<void> {
  // Find step via oneShotTaskId
  const oneShotTask = await db.query.oneShotTasks.findFirst({
    where: eq(schema.oneShotTasks.oneShotTaskId, oneShotTaskId),
  })
  if (!oneShotTask) {
    log.warn({ oneShotTaskId }, 'no matching oneShotTask for webhook')
    return
  }

  const explorerUrl = getExplorerTxUrl(txHash, chainId)
  const now = Math.floor(Date.now() / 1000)

  await db
    .update(schema.delegationSteps)
    .set({
      status: 'confirmed',
      txHash,
      blockNumber: blockNumber.toString(),
      explorerUrl,
      confirmedAt: now,
    })
    .where(eq(schema.delegationSteps.stepId, oneShotTask.delegationStepId))

  await db
    .update(schema.oneShotTasks)
    .set({
      status: 'Confirmed',
      txHash,
      blockNumber: blockNumber.toString(),
      webhookReceived: true,
      confirmedAt: now,
    })
    .where(eq(schema.oneShotTasks.oneShotTaskId, oneShotTaskId))

  // Get the step for the emit
  const step = await db.query.delegationSteps.findFirst({
    where: eq(schema.delegationSteps.stepId, oneShotTask.delegationStepId),
  })

  if (step) {
    await emit(step.taskId, oneShotTask.userAddress, 'delegation_confirmed', {
      stepId: step.stepId,
      agentName: step.agentName,
      txHash,
      blockNumber,
      explorerUrl,
      gasUsed,
      status: 'confirmed',
    })

    log.info(
      { stepId: step.stepId, txHash, explorerUrl },
      'delegation step confirmed on-chain'
    )
  }
}

export async function markStepFailed(
  oneShotTaskId: string,
  status: 'rejected' | 'reverted'
): Promise<void> {
  const oneShotTask = await db.query.oneShotTasks.findFirst({
    where: eq(schema.oneShotTasks.oneShotTaskId, oneShotTaskId),
  })
  if (!oneShotTask) return

  await db
    .update(schema.delegationSteps)
    .set({ status })
    .where(eq(schema.delegationSteps.stepId, oneShotTask.delegationStepId))

  await db
    .update(schema.oneShotTasks)
    .set({ status: status === 'rejected' ? 'Rejected' : 'Reverted', webhookReceived: true })
    .where(eq(schema.oneShotTasks.oneShotTaskId, oneShotTaskId))

  const step = await db.query.delegationSteps.findFirst({
    where: eq(schema.delegationSteps.stepId, oneShotTask.delegationStepId),
  })

  if (step) {
    await emit(step.taskId, oneShotTask.userAddress, 'error', {
      stepId: step.stepId,
      agentName: step.agentName,
      status,
      oneShotTaskId,
    })
  }

  log.warn({ oneShotTaskId, status }, 'delegation step failed')
}

export async function getDelegationTree(taskId: string): Promise<DelegationTree> {
  const steps = await db.query.delegationSteps.findMany({
    where: eq(schema.delegationSteps.taskId, taskId),
    orderBy: (t, { asc }) => [asc(t.createdAt)],
  })

  const root = steps.find((s) => !s.parentStepId)
  if (!root) {
    return { taskId, root: { step: {} as DelegationStep, children: [] } }
  }

  function buildNode(step: typeof steps[0]): DelegationTreeNode {
    const children = steps
      .filter((s) => s.parentStepId === step.stepId)
      .map(buildNode)

    return {
      step: {
        ...step,
        budgetAllocated: BigInt(step.budgetAllocated),
        budgetUsed: BigInt(step.budgetUsed ?? '0'),
        delegation: step.delegation as DelegationStep['delegation'],
        permissionContext: step.permissionContext as `0x${string}`,
        txHash: step.txHash as `0x${string}` | undefined,
        blockNumber: step.blockNumber ? BigInt(step.blockNumber) : undefined,
        agentAddress: step.agentAddress as `0x${string}`,
      },
      children,
    }
  }

  return { taskId, root: buildNode(root) }
}
