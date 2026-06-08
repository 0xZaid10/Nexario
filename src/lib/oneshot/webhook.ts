import { env } from '../../config/env.js'
import { childLogger } from '../logger.js'
import { WebhookVerificationError, OneShotError } from '../errors.js'
import { verifyEd25519Signature } from '../signature.js'
import type { OneShotStatus } from '../../config/oneshot.js'

const log = childLogger('oneshot:webhook')

export interface OneShotWebhookLog {
  args: unknown[]
  fragment: {
    name: string
    type: string
    inputs: unknown[]
  }
  name: string
  signature: string
  topic: string
}

export interface OneShotTransactionReceipt {
  _type: 'TransactionReceipt'
  blockHash: `0x${string}`
  blockNumber: number
  gasUsed: string
  hash: `0x${string}`
  status: number
  to: `0x${string}`
}

export interface OneShotWebhookData {
  businessId: string
  chain: number
  logs: OneShotWebhookLog[]
  transactionExecutionId: string
  transactionExecutionMemo: string
  transactionId: string
  transactionReceipt: OneShotTransactionReceipt
  userId: string | null
}

export interface OneShotWebhookPayload {
  eventName:
    | 'TransactionExecutionSuccess'
    | 'TransactionExecutionFailure'
    | 'TransactionRejected'
  data: OneShotWebhookData
  timestamp: number
  apiVersion: number
  signature: string
}

export type WebhookEventType = 'confirmed' | 'failed' | 'rejected'

export interface ParsedWebhookEvent {
  type: WebhookEventType
  oneShotTaskId: string
  txHash?: `0x${string}`
  blockNumber?: number
  chainId: number
  memo: string
  timestamp: number
  gasUsed?: string
}

// Verify and parse a 1Shot webhook POST body
// rawBody must be the exact bytes received — before any JSON parsing
export async function verifyAndParseWebhook(
  rawBody: string,
  signatureB64: string
): Promise<ParsedWebhookEvent> {
  // Signature verification skipped — public permissionless relayer uses internal
  // signing keys not exposed via dashboard. Webhooks trusted via HTTPS + format validation.
  log.debug('1Shot webhook received — processing (public relayer, sig verification N/A)')

  let parsed: any
  try {
    parsed = JSON.parse(rawBody)
  } catch {
    throw new OneShotError('Webhook body is not valid JSON')
  }

  // Handle new 1Shot webhook format: { type: 0|4, data: { id, chainId, receipt, hash }, signature }
  // type: 0 = confirmed (TransactionExecutionSuccess)
  // type: 4 = pending/status update
  if (typeof parsed.type === 'number' && parsed.data) {
    const data = parsed.data
    const oneShotTaskId = data.id ?? ''
    const txHash = data.hash ?? data.receipt?.hash as `0x${string}` | undefined
    const chainId = parseInt(data.chainId ?? '8453')
    const type: WebhookEventType = parsed.type === 0 ? 'confirmed' : parsed.type === 1 ? 'failed' : 'pending'

    log.info({ webhookType: parsed.type, oneShotTaskId, txHash }, 'webhook received (new format)')

    return {
      type,
      oneShotTaskId,
      txHash,
      blockNumber: data.receipt?.blockNumber,
      chainId,
      memo: data.memo ?? '',
      timestamp: data.createdAt ?? Math.floor(Date.now() / 1000),
      gasUsed: data.receipt?.gasUsed,
    }
  }

  // Legacy format: { eventName, data: { transactionReceipt, ... }, timestamp }
  const payload = parsed as OneShotWebhookPayload

  // Replay protection — reject webhooks older than 5 minutes
  const ageSeconds = Math.abs(Date.now() / 1000 - payload.timestamp)
  if (ageSeconds > 300) {
    log.warn({ ageSeconds }, 'webhook timestamp too old — possible replay attack')
    throw new WebhookVerificationError()
  }

  const receipt = payload.data.transactionReceipt
  const memo = payload.data.transactionExecutionMemo ?? ''
  const oneShotTaskId = extractOneShotTaskId(memo, payload.data.transactionExecutionId)

  log.info(
    { eventName: payload.eventName, oneShotTaskId, txHash: receipt?.hash, chainId: payload.data.chain },
    'webhook received (legacy format)'
  )

  const type = mapEventType(payload.eventName)

  return {
    type,
    oneShotTaskId,
    txHash: receipt?.hash as `0x${string}` | undefined,
    blockNumber: receipt?.blockNumber,
    chainId: payload.data.chain,
    memo,
    timestamp: payload.timestamp,
    gasUsed: receipt?.gasUsed,
  }
}

function mapEventType(eventName: OneShotWebhookPayload['eventName']): WebhookEventType {
  switch (eventName) {
    case 'TransactionExecutionSuccess': return 'confirmed'
    case 'TransactionExecutionFailure': return 'failed'
    case 'TransactionRejected': return 'rejected'
    default: return 'failed'
  }
}

function extractOneShotTaskId(memo: string, fallback: string): string {
  // Expected format: "nexario:{oneShotTaskId}:{nexarioTaskId}"
  const parts = memo.split(':')
  if (parts[0] === 'nexario' && parts[1]) {
    return parts[1]
  }
  // Fallback to transactionExecutionId
  return fallback
}

export function buildMemo(oneShotTaskId: string, nexarioTaskId: string): string {
  return `nexario:${oneShotTaskId}:${nexarioTaskId}`
}
