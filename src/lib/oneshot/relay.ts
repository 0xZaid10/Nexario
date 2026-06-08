/**
 * 1Shot ERC-7710 Relay
 *
 * Based on official OpenRPC spec: https://1shotapi.com/openrpc/openrpc.json
 *
 * Correct flow:
 *   1. relayer_getFeeData → get fee quote + context
 *   2. Build delegation bundle with correct permissionContext (array of Delegation7710)
 *   3. relayer_send7710Transaction → submit bundle
 *   4. relayer_getStatus → poll for result (or use webhook)
 */

import { ONESHOT_RELAYER_URL, ONESHOT_METHODS, ONESHOT_CONFIG } from '../../config/oneshot.js'
import { childLogger } from '../logger.js'
import { OneShotError } from '../errors.js'
import type { Address, Hex } from 'viem'
import type { AuthorizationTuple } from '../../types/index.js'

const log = childLogger('oneshot:relay')

// ── Types from OpenRPC spec ───────────────────────────────────────────────────

export interface Caveat7710 {
  enforcer: Address
  terms: string
  args: string
}

export interface Delegation7710 {
  delegate: Address
  delegator: Address
  authority: string
  caveats: Caveat7710[]
  salt: string
  signature: string
}

export interface Execution7710 {
  target: Address
  value: string
  data: Hex
}

// One transaction bundle — permissionContext is array of delegation structs
export interface DelegatedTransaction7710 {
  permissionContext: Delegation7710[]
  executions: Execution7710[]
}

export interface Send7710Params {
  chainId: string
  transactions: DelegatedTransaction7710[]
  authorizationList?: AuthorizationTuple[]
  context?: string       // price-lock from getFeeData
  taskId?: string
  destinationUrl?: string
  memo?: string
}

export interface RelayResult {
  taskId: string
}

export interface FeeData {
  chainId: string
  rate: number
  minFee: string          // in token atoms (string)
  expiry: number
  gasPrice: string
  feeCollector: Address
  targetAddress?: Address
  context: string         // price-lock quote — pass to send
  token: {
    address: Address
    decimals: number
    symbol: string
  }
}

// ── Generic JSON-RPC helper ───────────────────────────────────────────────────

export async function rpc7710<T>(method: string, params: unknown): Promise<T> {
  const res = await fetch(ONESHOT_RELAYER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  const json = await res.json() as { result?: T; error?: { code?: number; message: string } }
  if (json.error) throw new OneShotError(json.error.message, json.error.code)
  if (!json.result && json.result !== false) throw new OneShotError(`Empty response from ${method}`)
  return json.result as T
}

// ── getFeeData ────────────────────────────────────────────────────────────────

export async function getFeeData(chainId: number, tokenAddress: Address): Promise<FeeData> {
  const res = await fetch(ONESHOT_RELAYER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: ONESHOT_METHODS.GET_FEE_DATA,
      params: { chainId: String(chainId), token: tokenAddress },
    }),
  })

  if (!res.ok) throw new OneShotError(`getFeeData HTTP ${res.status}`, undefined, { chainId })

  const json = await res.json() as { result?: FeeData; error?: { message: string } }
  if (json.error) throw new OneShotError(json.error.message, undefined, { chainId })
  if (!json.result) throw new OneShotError('Empty getFeeData response', undefined, { chainId })

  return json.result
}

// ── send7710Transaction ───────────────────────────────────────────────────────

export async function send7710Transaction(params: Send7710Params): Promise<RelayResult> {
  log.info({
    chainId: params.chainId,
    txCount: params.transactions.length,
    hasAuth: !!params.authorizationList?.length,
  }, 'submitting 7710 bundle')

  const body: Record<string, unknown> = {
    chainId: params.chainId,
    transactions: params.transactions,
  }

  if (params.authorizationList?.length) body['authorizationList'] = params.authorizationList
  if (params.context) body['context'] = params.context
  if (params.taskId) body['taskId'] = params.taskId
  if (params.destinationUrl) body['destinationUrl'] = params.destinationUrl

  const res = await fetch(ONESHOT_RELAYER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: ONESHOT_METHODS.SEND_7710,
      params: body,
    }),
  })

  if (!res.ok) throw new OneShotError(`send7710Transaction HTTP ${res.status}`, undefined, { chainId: params.chainId })

  const json = await res.json() as { result?: string; error?: { code?: number; message: string } }

  if (json.error) {
    log.error({ error: json.error }, '1Shot relay error')
    throw new OneShotError(json.error.message, json.error.code, { chainId: params.chainId })
  }

  if (!json.result) throw new OneShotError('Empty send7710 response', undefined, { chainId: params.chainId })

  log.info({ taskId: json.result }, '7710 bundle submitted')
  return { taskId: json.result }
}

// ── getStatus ─────────────────────────────────────────────────────────────────

export interface TaskStatus {
  id: string
  chainId: string
  createdAt: number
  status: 100 | 110 | 200 | 400 | 500
  hash?: string
  receipt?: {
    blockHash: string
    blockNumber: string
    gasUsed: string
    transactionHash: string
  }
  message?: string
}

export async function getTaskStatus(taskId: string): Promise<TaskStatus> {
  const res = await fetch(ONESHOT_RELAYER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: ONESHOT_METHODS.GET_STATUS,
      params: { id: taskId, logs: false },
    }),
  })

  const json = await res.json() as { result?: TaskStatus; error?: { message: string } }
  if (json.error) throw new OneShotError(json.error.message)
  if (!json.result) throw new OneShotError('Empty getStatus response')

  return json.result
}

// ── Poll until terminal ───────────────────────────────────────────────────────

export async function pollTaskStatus(
  taskId: string,
  opts?: { intervalMs?: number; maxWaitMs?: number }
): Promise<TaskStatus> {
  const interval = opts?.intervalMs ?? 3000
  const maxWait = opts?.maxWaitMs ?? 60_000
  const start = Date.now()

  while (Date.now() - start < maxWait) {
    const status = await getTaskStatus(taskId)
    // 200=Confirmed, 400=Rejected, 500=Reverted are terminal
    if (status.status >= 200) return status
    await new Promise(r => setTimeout(r, interval))
  }

  throw new OneShotError(`Task ${taskId} timed out after ${maxWait}ms`)
}
