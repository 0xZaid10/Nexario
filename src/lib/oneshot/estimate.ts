import { ONESHOT_RELAYER_URL, ONESHOT_METHODS, ONESHOT_CONFIG, ONESHOT_ERROR_CODES } from '../../config/oneshot.js'
import { childLogger } from '../logger.js'
import { OneShotError, QuoteExpiredError, SimulationFailedError } from '../errors.js'
import type { AuthorizationTuple, Delegation } from '../../types/index.js'

const log = childLogger('oneshot:estimate')

export interface RelayTransaction {
  to: `0x${string}`
  data: `0x${string}`
  value: `0x${string}`
}

// Per the 1Shot OpenRPC spec:
// permissionContext is an array of delegation structs inside each transaction object
export interface Relay7710Transaction {
  permissionContext: Delegation[]   // array of delegation chain structs
  executionCallData?: `0x${string}` // encoded execution data
}

export interface EstimateParams {
  chainId: number
  permissionContext: `0x${string}`   // hex string — matches relay.ts
  transactions: RelayTransaction[]    // simple {to, data, value}
  authorizationList?: AuthorizationTuple[]
  context?: string
}

export interface RelayTransaction {
  to: `0x${string}`
  data: `0x${string}`
  value: `0x${string}`
}

export interface EstimateResult {
  success: boolean
  requiredPaymentAmount: string
  gasUsed: Record<string, string>
  context: string  // price-lock quote for send
  error?: string
}

export interface MultichainEstimateParams {
  fee: EstimateParams
  work: EstimateParams
}

export interface MultichainEstimateResult {
  success: boolean
  requiredPaymentAmount: string
  gasUsed: Record<string, string>
  contextByChainId: Record<string, string>
  error?: string
}

export async function estimate7710Transaction(
  params: EstimateParams
): Promise<EstimateResult> {
  log.debug({ chainId: params.chainId }, 'estimating 7710 transaction')

  const body: Record<string, unknown> = {
    chainId: String(params.chainId),
    permissionContext: params.permissionContext,
    transactions: params.transactions,
  }

  if (params.context) {
    body['context'] = params.context
  }

  if (params.authorizationList && params.authorizationList.length > 0) {
    if (params.authorizationList.length > ONESHOT_CONFIG.MAX_AUTH_LIST_ENTRIES) {
      throw new OneShotError(
        `authorizationList max ${ONESHOT_CONFIG.MAX_AUTH_LIST_ENTRIES} entry`,
        ONESHOT_ERROR_CODES.INVALID_AUTH_LIST
      )
    }
    body['authorizationList'] = params.authorizationList
  }

  const response = await fetch(ONESHOT_RELAYER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: ONESHOT_METHODS.ESTIMATE_7710,
      params: body,
    }),
  })

  if (!response.ok) {
    throw new OneShotError(`estimate HTTP ${response.status}`)
  }

  const json = await response.json() as {
    result?: EstimateResult
    error?: { code?: number; message: string }
  }

  if (json.error) {
    handleOneShotError(json.error.code, json.error.message)
  }

  if (!json.result) {
    throw new OneShotError('Empty estimate response')
  }

  log.debug(
    { requiredPaymentAmount: json.result.requiredPaymentAmount, success: json.result.success },
    'estimate complete'
  )

  return json.result
}

export async function estimate7710TransactionMultichain(
  params: MultichainEstimateParams
): Promise<MultichainEstimateResult> {
  log.debug(
    { feeChain: params.fee.chainId, workChain: params.work.chainId },
    'estimating multichain 7710 transaction'
  )

  const response = await fetch(ONESHOT_RELAYER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: ONESHOT_METHODS.ESTIMATE_7710_MULTICHAIN,
      params: [
        {
          chainId: String(params.fee.chainId),
          transactions: params.fee.transactions,
          ...(params.fee.context && { context: params.fee.context }),
          ...(params.fee.authorizationList && { authorizationList: params.fee.authorizationList }),
        },
        {
          chainId: String(params.work.chainId),
          transactions: params.work.transactions,
          ...(params.work.context && { context: params.work.context }),
        },
      ],
    }),
  })

  if (!response.ok) {
    throw new OneShotError(`multichain estimate HTTP ${response.status}`)
  }

  const json = await response.json() as {
    result?: MultichainEstimateResult
    error?: { code?: number; message: string }
  }

  if (json.error) {
    handleOneShotError(json.error.code, json.error.message)
  }

  if (!json.result) {
    throw new OneShotError('Empty multichain estimate response')
  }

  return json.result
}

export function applyFeeBuffer(requiredAmount: string): bigint {
  const base = BigInt(requiredAmount)
  const buffer = (base * BigInt(ONESHOT_CONFIG.FEE_BUFFER_PERCENT)) / 100n
  return base + buffer
}

function handleOneShotError(code: number | undefined, message: string): never {
  if (code === ONESHOT_ERROR_CODES.QUOTE_EXPIRED) throw new QuoteExpiredError()
  if (code === ONESHOT_ERROR_CODES.SIMULATION_FAILED) {
    throw new SimulationFailedError(message)
  }
  throw new OneShotError(message, code)
}
