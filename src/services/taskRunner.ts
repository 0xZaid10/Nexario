import { eq } from 'drizzle-orm'
import { db, schema } from '../db/client.js'
import { emit } from './sse.js'
import { persistDelegationStep, markStepSubmitted, getDelegationTree } from './delegationTracker.js'
import { writeAllAgentTags } from './reputationWriter.js'
import { planTask, createSubDelegations, synthesizeResults } from '../agents/coordinator.js'
import { runResearch } from '../agents/research.js'
import { runAudit } from '../agents/audit.js'
import { runReport } from '../agents/report.js'
import { DEMO_AGENTS } from '../agents/registry.js'
import { getActiveSession, deductFromSession } from '../lib/delegation/authorize.js'
import { getCapabilities, getPreferredToken } from '../lib/oneshot/capabilities.js'
// relay imported dynamically inside runTask
import { buildSubDelegation } from '../lib/delegation/build.js'
import { buildAuthorizationList, getAccountNonce } from '../lib/oneshot/upgrade.js'
import { usdcToAtoms, atomsToUsdc } from '../lib/encoding.js'
import { generateStepId, generateTaskId } from '../lib/signature.js'
import { childLogger } from '../lib/logger.js'
import { getBackendAddress } from '../lib/signature.js'
import { TARGET_CHAIN, FEE_CHAIN, REGISTRY_CHAIN } from '../config/chains.js'
import { METAMASK_CONTRACTS, METAMASK_IMPLEMENTATIONS, NEXARIO_CONTRACTS } from '../config/contracts.js'
import { createOnChainLease, consumeOnChainLease, redelegateOnChain } from './leaseRegistry.js'
import type { Address, Hex } from 'viem'
import type {
  TaskRequest,
  Task,
  SubTaskOutput,
  TaskResult,
} from '../types/index.js'
import type { DemoAgentName } from '../types/index.js'

const log = childLogger('services:task-runner')

export async function createTask(request: TaskRequest): Promise<Task> {
  const taskId = generateTaskId()

  await db.insert(schema.tasks).values({
    taskId,
    userMessage: request.userMessage,
    userAddress: request.userAddress,
    chainId: request.chainId,
    source: request.source,
    telegramChatId: request.telegramChatId,
    status: 'queued',
    permissionsContext: request.permissionsContext,
    delegationManager: request.delegationManager,
  })

  log.info({ taskId, userAddress: request.userAddress }, 'task created')

  // Save user message to DB for persistence
  try {
    const { saveMessage } = await import('./chatMessages.js')
    await saveMessage({
      userAddress: request.userAddress,
      sessionId: request.chatId ?? taskId,
      type: 'user',
      content: request.userMessage,
      taskId,
    })
  } catch { /* non-critical */ }


  // Run async — don't await
  runTask(taskId, request).catch((err) =>
    log.error({ taskId, err }, 'task runner crashed')
  )

  return getTask(taskId) as Promise<Task>
}

async function runTask(taskId: string, request: TaskRequest): Promise<void> {
  const startMs = Date.now()

  try {
    await setTaskStatus(taskId, 'planning')
    await emit(taskId, request.userAddress, 'status_change', { status: 'planning' })

    // Get active session for budget info
    const session = await getActiveSession(request.userAddress, REGISTRY_CHAIN.id, request.chatId)
    if (!session) throw new Error('No active session — user must authorize first')

    const remainingBudget = Number(session.budgetUsdc) / 1_000_000
      - Number(session.spentUsdc) / 1_000_000

    // Define coordinator address early — used in lease creation and delegation
    const coordinatorAddress = getBackendAddress()

    // Create on-chain authority lease (Sepolia — audit trail)
    let onChainLeaseId: `0x${string}` | null = null
    if (remainingBudget <= 0) {
      log.warn({ taskId }, 'session budget exhausted — skipping on-chain lease')
    } else
    try {
      // Hash the permissionsContext to get a bytes32 delegationHash
      const { keccak256, toBytes } = await import('viem')
      const ctxBytes = typeof request.permissionsContext === 'string' && request.permissionsContext.startsWith('0x')
        ? request.permissionsContext as `0x${string}`
        : keccak256(toBytes(request.permissionsContext))
      const delegationHash = request.permissionsContext.startsWith('0x') && request.permissionsContext.length === 66
        ? request.permissionsContext as `0x${string}`
        : keccak256(toBytes(request.permissionsContext))

      const leaseResult = await createOnChainLease({
        delegate: coordinatorAddress,
        budgetUsdc: remainingBudget,
        expiresAt: session.expiresAt,
        maxDepth: 3,
        capability: 'coordinate',
        delegationHash,
        delegationManager: METAMASK_CONTRACTS.DELEGATION_MANAGER,
        chainId: REGISTRY_CHAIN.id,
      })
      onChainLeaseId = leaseResult?.leaseId ?? null
      if (onChainLeaseId) {
        log.info({ leaseId: onChainLeaseId }, 'on-chain lease created')
        await emit(taskId, request.userAddress, 'status_change', {
          status: 'planning',
          leaseId: onChainLeaseId,
          leaseExplorerUrl: `https://sepolia.etherscan.io/address/${NEXARIO_CONTRACTS.AUTHORITY_LEASE_REGISTRY}`,
        })
      }
    } catch (err) {
      log.warn({ err }, 'on-chain lease creation failed — continuing without')
    }

    // 1. Plan the task — retry on Venice 429
    let plan: Awaited<ReturnType<typeof planTask>> | null = null
    for (let pi = 0; pi < 5; pi++) {
      try {
        plan = await planTask({
          taskId,
          userMessage: request.userMessage,
          userAddress: request.userAddress,
          chainId: REGISTRY_CHAIN.id,
          availableBudgetUsdc: remainingBudget,
          sessionId: session.sessionId,
          preferredAgentIds: request.preferredAgentIds,
          agentPreference: request.agentPreference,
        })
        break
      } catch (err: any) {
        if (err?.httpStatus === 429 && pi < 4) {
          const delay = (pi + 1) * 20_000
          log.warn({ attempt: pi + 1, delay }, 'Venice 429 on planning — retrying')
          await new Promise(r => setTimeout(r, delay))
        } else throw err
      }
    }
    if (!plan) throw new Error('Planning failed after retries')

    await db.update(schema.tasks)
      .set({ plan: plan as unknown as Record<string, unknown>, status: 'executing' })
      .where(eq(schema.tasks.taskId, taskId))

    await emit(taskId, request.userAddress, 'plan_ready', { plan })

    // Guard against malformed plan — Venice may return 'tasks' instead of 'subTasks'
    const rawPlan = plan as any
    if (!plan.subTasks || !Array.isArray(plan.subTasks)) {
      if (rawPlan.tasks && Array.isArray(rawPlan.tasks)) {
        // Normalize 'tasks' → 'subTasks' with correct field names
        plan.subTasks = rawPlan.tasks.map((t: any) => ({
          agentName: t.agent ?? t.agentName ?? 'research',
          capability: t.capability ?? t.agent ?? 'research',
          budgetUsdc: String(t.budget ?? t.budgetUsdc ?? '0.3'),
          durationSeconds: t.durationSeconds ?? 3600,
          description: t.input ?? t.description ?? request.userMessage,
          requiresPrivacy: t.requiresPrivacy ?? false,
        }))
        log.info({ taskId, count: plan.subTasks.length }, 'normalized tasks → subTasks')
      } else {
        log.warn({ taskId }, 'coordinator returned empty plan — using fallback')
        plan.subTasks = [{
          agentName: 'research',
          capability: 'research',
          budgetUsdc: '0.5',
          durationSeconds: 3600,
          description: request.userMessage,
          requiresPrivacy: false,
        }]
      }
    }

    log.info({ taskId }, 'plan ready')
    log.debug({ taskId, plan }, 'coordinator plan')

    // 2. Create root delegation step (coordinator level)
    const coordinatorStepId = generateStepId()

    await persistDelegationStep({
      stepId: coordinatorStepId,
      taskId,
      agentName: 'coordinator',
      agentAddress: coordinatorAddress,
      delegation: {} as any,
      permissionContext: request.permissionsContext,
      status: 'confirmed', // User already signed this
      budgetAllocated: usdcToAtoms(remainingBudget),
      budgetUsed: 0n,
      chainId: REGISTRY_CHAIN.id,
      userAddress: request.userAddress,
    })

    // 3. Execute sub-tasks
    await setTaskStatus(taskId, 'executing')

    const subTaskOutputs: { agentName: DemoAgentName; output: SubTaskOutput }[] = []
    const executionResults = []

    // 1Shot relay runs on mainnet, fees on Base — NOT on the user's registry chain
    const relayerCaps = await getCapabilities(TARGET_CHAIN.id)
    const usdcToken = getPreferredToken(relayerCaps)

    for (const subTaskPlan of plan.subTasks) {
      const agentName = subTaskPlan.agentName as DemoAgentName
      const demoAgent = DEMO_AGENTS[agentName]
      if (!demoAgent) continue

      const subStartMs = Date.now()
      const budgetUsdc = usdcToAtoms(parseFloat(subTaskPlan.budgetUsdc))
      const subStepId = generateStepId()

      log.info({ taskId, agentName, budgetUsdc: subTaskPlan.budgetUsdc }, 'executing sub-task')

      // Build sub-delegation
      const subDelegation = await buildSubDelegation({
        delegate: relayerCaps.targetAddress as Address,
        budgetUsdc,
        actions: [subTaskPlan.capability as any],
        durationSeconds: Number(subTaskPlan.durationSeconds) || 3600,  // default 1h
        parentDelegation: {
          delegate: request.delegationManager,
          delegator: request.userAddress,
          authority: '0x' + '00'.repeat(32) as Hex,
          caveats: [],
          salt: 0n,
          signature: '0x' as Hex,
        },
        chainId: TARGET_CHAIN.id,
      })

      await persistDelegationStep({
        stepId: subStepId,
        taskId,
        agentName,
        agentAddress: demoAgent.address,
        parentStepId: coordinatorStepId,
        delegation: subDelegation.delegation as any,
        permissionContext: subDelegation.permissionContext,
        status: 'pending',
        budgetAllocated: budgetUsdc,
        budgetUsed: 0n,
        chainId: REGISTRY_CHAIN.id,
        userAddress: request.userAddress,
      })

      // Run the actual agent work
      let output: SubTaskOutput
      try {
        output = await runSubAgent(agentName, {
          query: subTaskPlan.description,
          executionParams: (subTaskPlan as any).executionParams,
          userAddress: request.userAddress,
          availableBudgetUsdc: parseFloat(subTaskPlan.budgetUsdc),
          chainId: REGISTRY_CHAIN.id,
          chatId: request.chatId,
          sessionId: request.sessionId ?? request.chatId,
          permissionsContext: request.permissionsContext as string,
          delegationManager: request.delegationManager as string,
          onChunk: (delta) => {
            emit(taskId, request.userAddress, 'subtask_started', {
              agentName,
              delta,
            }).catch(() => {})
          },
        })
      } catch (err) {
        log.error({ agentName, err }, 'sub-agent failed')
        output = { type: 'text', content: `[${agentName} failed: ${String(err)}]` }
      }

      subTaskOutputs.push({ agentName, output })

      // Submit to 1Shot relay — user's ERC-7715 permissionsContext is the delegation
      // User's Flask wallet pays, agent wallets only RECEIVE fees
      try {
        const { getFeeData, send7710Transaction, rpc7710 } = await import('../lib/oneshot/relay.js')
        const { encodeFunctionData, erc20Abi, decodeAbiParameters, parseAbiParameters } = await import('viem')
        // 1. Get fee quote
        const feeData = await getFeeData(TARGET_CHAIN.id, usdcToken.address as Address)
        const minFeeStr = String(feeData.minFee)
        let feeAtoms: bigint
        if (minFeeStr.includes('.')) {
          const { parseUnits } = await import('viem')
          feeAtoms = parseUnits(minFeeStr, 6)
        } else {
          feeAtoms = BigInt(minFeeStr)
        }
        if (feeAtoms < 10000n) feeAtoms = 10000n
        log.info({ minFee: minFeeStr, feeAtoms: feeAtoms.toString() }, '1Shot fee')

        // 2. Agent fee
        const { getAgentFeeAtoms } = await import('../lib/x402/agentPayment.js')
        const agentFeeAtoms = getAgentFeeAtoms(agentName)

        // 3. Parse user's permissionsContext
        // Flask returns JSON array: [{chainId, from, to, permission: {type, data}}]
        // This is ERC-7715 format — pass directly to 1Shot
        let permissionContextForRelay: unknown[]
        const rawCtx = request.permissionsContext as string

        if (rawCtx.startsWith('[') || rawCtx.startsWith('{')) {
          // Flask ERC-7715 JSON format
          try {
            const flaskPermissions = JSON.parse(rawCtx)
            permissionContextForRelay = Array.isArray(flaskPermissions) ? flaskPermissions : [flaskPermissions]
            log.info({ count: permissionContextForRelay.length, type: (permissionContextForRelay[0] as any)?.permission?.type }, 'using Flask ERC-7715 permissions')
          } catch {
            permissionContextForRelay = [rawCtx]
          }
        } else if (rawCtx.startsWith('0x') && rawCtx.length > 10) {
          // ABI-encoded delegation
          try {
            const DELEGATION_ABI = parseAbiParameters(
              '(address delegate, address delegator, bytes32 authority, (address enforcer, bytes terms, bytes args)[] caveats, bytes32 salt, bytes signature)[]'
            )
            const decoded = decodeAbiParameters(DELEGATION_ABI, rawCtx as `0x${string}`)
            const delegations = decoded[0] as any[]
            const toHex = (v: any) => typeof v === 'bigint' ? `0x${v.toString(16).padStart(64, '0')}` : v
            permissionContextForRelay = delegations.map(d => ({
              delegate: d.delegate,
              delegator: d.delegator,
              authority: toHex(d.authority),
              caveats: d.caveats.map((c: any) => ({
                enforcer: c.enforcer,
                terms: c.terms ?? '0x',
                args: c.args ?? '0x',
              })),
              salt: toHex(d.salt),
              signature: d.signature,
            }))
            log.info({ count: permissionContextForRelay.length }, 'decoded ABI permissionsContext')
          } catch (decodeErr) {
            log.warn({ decodeErr, rawCtxType: typeof rawCtx, rawCtxStart: rawCtx?.slice(0,20) }, 'decode failed — using raw')
            permissionContextForRelay = [rawCtx]
          }
        } else {
          permissionContextForRelay = [rawCtx]
        }

        // 4. Build executions (charged from user's delegated USDC):
        //    a) Relay fee → 1Shot feeCollector
        //    b) Agent fee → agent wallet
        const relayFeeCalldata = encodeFunctionData({
          abi: erc20Abi,
          functionName: 'transfer',
          args: [relayerCaps.feeCollector as Address, feeAtoms],
        })
        const agentFeeCalldata = encodeFunctionData({
          abi: erc20Abi,
          functionName: 'transfer',
          args: [demoAgent.address, agentFeeAtoms],
        })

        const executions: { target: Address; value: string; data: `0x${string}` }[] = [
          { target: usdcToken.address as Address, value: '0x0', data: relayFeeCalldata },
          { target: usdcToken.address as Address, value: '0x0', data: agentFeeCalldata },
        ]

        // Add executor work execution if present (e.g. USDC transfer or swap)
        if ((output as any).approvalExecution) {
          executions.push((output as any).approvalExecution)
          log.info({ target: (output as any).approvalExecution.target }, 'executor: adding permit2 approval to 1Shot bundle')
        }
        if (output.execution) {
          executions.push(output.execution)
          log.info({ target: output.execution.target }, 'executor: adding work execution to 1Shot bundle')
        }

        const sendParams = {
          chainId: String(TARGET_CHAIN.id),
          transactions: [{
            permissionContext: permissionContextForRelay,
            executions,
          }],
          // No authorizationList — Flask handles EIP-7702 upgrade for user's wallet
          destinationUrl: `${process.env['API_BASE_URL'] ?? 'http://localhost:3000'}/api/webhook/oneshot`,
          memo: `nexario:${subStepId}:${taskId}`,
        }

        // 5. Estimate → get price-locked context
        let finalContext = feeData.context
        try {
          const estimate = await rpc7710<{
            success: boolean
            requiredPaymentAmount?: string
            context?: string
            error?: string
          }>('relayer_estimate7710Transaction', sendParams)

          if (estimate.success && estimate.context) {
            finalContext = estimate.context
            log.info({ requiredPaymentAmount: estimate.requiredPaymentAmount }, '1Shot estimate success')
          } else {
            log.warn({ error: estimate.error }, '1Shot estimate failed — using getFeeData context')
          }
        } catch (estimateErr) {
          log.warn({ err: estimateErr }, '1Shot estimate call failed')
        }

        // 6. Send
        const result = await send7710Transaction({ ...sendParams, context: finalContext })
        const oneShotTaskId = result.taskId

        await markStepSubmitted(subStepId, oneShotTaskId, request.userAddress)
        log.info({ subStepId, oneShotTaskId }, '1Shot relay submitted ✓')

        // Poll for real on-chain tx hash (async, non-blocking)
        ;(async () => {
          for (let attempt = 0; attempt < 10; attempt++) {
            await new Promise(r => setTimeout(r, 3000))
            try {
              const status = await rpc7710<{ status: number; receipt?: { transactionHash: string } }>(
                'relayer_getStatus', { id: oneShotTaskId, logs: false }
              )
              if (status.receipt?.transactionHash) {
                log.info({ oneShotTaskId, txHash: status.receipt.transactionHash }, '1Shot tx confirmed on-chain')
                break
              }
            } catch { break }
          }
        })()

        executionResults.push({
          taskId,
          agentName,
          success: true,
          spentUsdc: budgetUsdc,
          agentFeeAtoms,          // what agent earned
          oneShotTaskId,          // payment proof hash
          workExecution: output.execution ?? null,  // real transfer/swap if present
          executionStartMs: subStartMs,
          veniceTokensUsed: 0,
          veniceModelId: demoAgent.veniceModel,
          teeUsed: false,
          e2eeUsed: false,
          delegationDepth: 2,
          crossChain: false,
          refunded: false,
          chainId: TARGET_CHAIN.id,
        })

        // Deduct actual fees paid (relay fee + agent fee), not full sub-task budget
        const { getAgentFeeAtoms: _getFee } = await import('../lib/x402/agentPayment.js')
        const _agentFee = _getFee(agentName)
        const _relayFee = 10000n  // $0.01 relay fee
        await deductFromSession(session.sessionId, _agentFee + _relayFee)

      } catch (err) {
        log.error({ subStepId, err }, '1Shot relay failed')
        executionResults.push({
          taskId,
          agentName,
          success: false,
          spentUsdc: 0n,
          executionStartMs: subStartMs,
          veniceTokensUsed: 0,
          veniceModelId: demoAgent.veniceModel,
          teeUsed: false,
          e2eeUsed: false,
          delegationDepth: 2,
          crossChain: false,
          refunded: false,
          chainId: TARGET_CHAIN.id,
        })
      }

      await emit(taskId, request.userAddress, 'subtask_completed', {
        agentName,
        outputType: output.type,
        hasImage: !!output.imageUrl,
        hasAudio: !!output.audioUrl,
      })
    }

    // Resolve tx hashes BEFORE synthesis so report can reference confirmed hashes
    const { rpc7710: _rpc7710 } = await import('../lib/oneshot/relay.js')
    const txDetails = await Promise.all(
      executionResults
        .filter(r => r.oneShotTaskId)
        .map(async r => {
          let txHash = r.oneShotTaskId
          try {
            for (let i = 0; i < 10; i++) {
              const status = await _rpc7710<{ status: number; receipt?: { transactionHash: string } }>(
                'relayer_getStatus', { id: r.oneShotTaskId, logs: false }
              )
              if (status.receipt?.transactionHash) { txHash = status.receipt.transactionHash; break }
              await new Promise(res => setTimeout(res, 2000))
            }
          } catch { /* use taskId as fallback */ }
          return {
            agentName: r.agentName,
            oneShotTaskId: txHash,
            feeUsdc: r.agentFeeAtoms ? Number(r.agentFeeAtoms) / 1_000_000 : 0,
            hasTransfer: r.agentName === 'executor' && !!r.workExecution,
          }
        })
    )
    const executorTx = txDetails.find(t => t.agentName === 'executor')
    const executorNote = executorTx
      ? `\n\nON-CHAIN EXECUTION COMPLETE on Base Mainnet. The exact transaction hash is shown in the Transaction Details drawer below — do not modify or abbreviate it in your report.`
      : ''

    // 4. Synthesize
    await setTaskStatus(taskId, 'synthesizing')
    await emit(taskId, request.userAddress, 'status_change', { status: 'synthesizing' })

    let summary: string
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        summary = await synthesizeResults({
          taskId,
          userMessage: request.userMessage,
          subTaskOutputs: subTaskOutputs.map((s) => ({
            agentName: s.agentName,
            content: s.output.content + (s.agentName === 'executor' ? executorNote : ''),
          })),
          onChunk: (delta) => {
            emit(taskId, request.userAddress, 'subtask_started', { agentName: 'coordinator', delta }).catch(() => {})
          },
        })
        break
      } catch (err: any) {
        if (err?.httpStatus === 429 && attempt < 2) {
          const delay = (attempt + 1) * 20_000  // 20s, 40s
          log.warn({ attempt: attempt + 1, delayMs: delay }, 'Venice 429 on synthesis — retrying')
          await new Promise(r => setTimeout(r, delay))
          continue
        }
        throw err
      }
    }

    const imageOutput = subTaskOutputs.find((s) => s.output.imageUrl)

    // Generate audio from final synthesis (not report agent output)
    let audioUrl: string | undefined
    try {
      const { textToSpeech, audioToBase64DataUrl } = await import('../lib/venice/media.js')
      const audioText = (summary ?? '').slice(0, 800) // cap at 800 chars for TTS
      if (audioText.length > 50) {
        const audioResult = await textToSpeech({ text: audioText, voice: 'af_heart', format: 'mp3' })
        audioUrl = audioToBase64DataUrl(audioResult.audioBuffer, audioResult.format)
      }
    } catch { /* non-critical */ }

    const audioOutput = subTaskOutputs.find((s) => s.output.audioUrl)

    // totalSpent = actual fees paid (relay fee + agent fee per agent)
    // NOT the full sub-task budget allocation
    const totalSpent = executionResults.reduce(
      (sum, r) => sum + (r.agentFeeAtoms ?? 0n) + 10000n,  // agentFee + relayFee per agent
      0n
    )

    const result: TaskResult = {
      summary,
      sections: subTaskOutputs.map((s) => ({
        title: s.agentName.charAt(0).toUpperCase() + s.agentName.slice(1),
        content: s.output.content,
        agentName: s.agentName,
      })),
      imageUrl: imageOutput?.output.imageUrl,
      audioUrl: audioOutput?.output.audioUrl,
      totalSpentUsdc: atomsToUsdc(totalSpent).toFixed(4),
      delegationCount: executionResults.length,
      executionTimeMs: Date.now() - startMs,
    }

    await db.update(schema.tasks)
      .set({
        status: 'completed',
        result: result as unknown as Record<string, unknown>,
        totalSpentUsdc: totalSpent.toString(),
        completedAt: Math.floor(Date.now() / 1000),
      })
      .where(eq(schema.tasks.taskId, taskId))

    // Save agent response to DB
    try {
      const { saveMessage: _saveMsg } = await import('./chatMessages.js')
      await _saveMsg({
        userAddress: request.userAddress,
        sessionId: request.chatId,
        type: 'agent',
        content: summary ?? '',
        taskId,
        audioUrl: audioOutput?.output.audioUrl,
        metadata: { totalSpentUsdc: atomsToUsdc(totalSpent).toFixed(4), txDetails },
      })
    } catch { /* non-critical */ }

    await emit(taskId, request.userAddress, 'task_complete', {
      result: {
        content: summary!,
        audioUrl: audioUrl ?? audioOutput?.output.audioUrl,
        imageUrl: imageOutput?.output.imageUrl,
        txDetails,
        totalSpentUsdc: atomsToUsdc(totalSpent).toFixed(4),
      }
    })

    // 5. Write reputation tags async — only for results with 1Shot payment proof
    const resultsWithProof = executionResults.filter(r => r.oneShotTaskId)
    await writeAllAgentTags(taskId, resultsWithProof)

    log.info(
      { taskId, durationMs: Date.now() - startMs, totalSpent: totalSpent.toString() },
      'task completed'
    )

  } catch (err) {
    log.error({ taskId, err }, 'task failed')

    await db.update(schema.tasks)
      .set({ status: 'failed', error: String(err) })
      .where(eq(schema.tasks.taskId, taskId))

    await emit(taskId, request.userAddress, 'error', { error: String(err) })
  }
}
async function runSubAgent(
  name: DemoAgentName,
  params: {
    query: string
    chainId: number
    onChunk?: (d: string) => void
    executionParams?: any
    userAddress?: string
    availableBudgetUsdc?: number
    chatId?: string
    sessionId?: string
    permissionsContext?: string
    delegationManager?: string
  }
): Promise<SubTaskOutput> {
  switch (name) {
    case 'research':
      return runResearch({ query: params.query, chainId: params.chainId }, params.onChunk)
    case 'audit':
      return runAudit({ subject: params.query, auditType: 'general' }, params.onChunk)
    case 'report':
      return runReport({ subject: params.query, generateVisual: true, generateAudio: true }, params.onChunk)
    case 'executor': {
      const { runExecutor } = await import('../agents/executor.js')
      // Build instruction from executionParams if available
      const ep = params.executionParams
      const instruction = (ep?.action === 'swap' && ep?.token && ep?.amount)
        ? `swap ${ep.amount} ${ep.sellToken ?? 'USDC'} to ${ep.token === (ep.sellToken ?? 'USDC') ? 'ETH' : ep.token}`
        : (ep?.action === 'transfer' && ep?.token && ep?.amount && ep?.to)
        ? `send ${ep.amount} ${ep.token} to ${ep.to}`
        : params.query
      const result = await runExecutor({
        instruction,
        userAddress: (params.userAddress ?? '0x0') as Address,
        permissionsContext: '0x',
        availableBudgetUsdc: params.availableBudgetUsdc ?? 1,
        executionParams: params.executionParams,
      })
      return { type: 'text', content: result.content, execution: result.execution }
    }
    case 'counsel':
    case 'intelligence':
    case 'reflection': {
      const { chat } = await import('../lib/venice/chat.js')
      const TEE_MODELS: Record<string, string> = {
        counsel:      'e2ee-qwen3-6-35b-a3b',
        intelligence: 'e2ee-qwen3-6-35b-a3b',
        reflection:   'e2ee-gemma-4-26b-a4b-uncensored-p',
      }
      const response = await chat({
        model: (TEE_MODELS[name] ?? 'e2ee-qwen3-6-35b-a3b') as any,
        messages: [{ role: 'user', content: params.query }],
        systemPrompt: `You are the ${name} agent. Provide expert analysis.`,
        maxTokens: 2000,
        onChunk: params.onChunk,
      })
      return { type: 'text', content: response.content }
    }
    case 'reputation': {
      const { chat } = await import('../lib/venice/chat.js')
      const response = await chat({
        model: 'research' as any,
        messages: [{ role: 'user', content: params.query }],
        systemPrompt: 'You are the reputation agent. Analyze wallet reputation and on-chain identity.',
        maxTokens: 1500,
        enableWebSearch: true,
        onChunk: params.onChunk,
      })
      return { type: 'text', content: response.content }
    }
    case 'monitor': {
      const { runMonitor } = await import('../agents/monitor.js')
      return runMonitor({
        subject: params.query,
        userAddress: params.userAddress ?? '',
        chatId: params.chatId,
        sessionId: params.sessionId ?? params.chatId,
        permissionsContext: params.permissionsContext,
        delegationManager: params.delegationManager,
        onChunk: params.onChunk,
      })
    }
    default: {
      const { chat } = await import('../lib/venice/chat.js')
      const response = await chat({
        model: 'coordinator' as any,
        messages: [{ role: 'user', content: params.query }],
        systemPrompt: `You are the ${name} agent.`,
        maxTokens: 1000,
        onChunk: params.onChunk,
      })
      return { type: 'text', content: response.content }
    }
  }
}
async function setTaskStatus(taskId: string, status: string): Promise<void> {
  await db.update(schema.tasks)
    .set({ status: status as any, updatedAt: Math.floor(Date.now() / 1000) })
    .where(eq(schema.tasks.taskId, taskId))
}

export async function getTask(taskId: string): Promise<typeof schema.tasks.$inferSelect | null> {
  return db.query.tasks.findFirst({
    where: eq(schema.tasks.taskId, taskId),
  }) ?? null
}

export async function getUserTasks(
  userAddress: string,
  limit = 20
): Promise<typeof schema.tasks.$inferSelect[]> {
  return db.query.tasks.findMany({
    where: eq(schema.tasks.userAddress, userAddress),
    orderBy: (t, { desc }) => [desc(t.createdAt)],
    limit,
  })
}
