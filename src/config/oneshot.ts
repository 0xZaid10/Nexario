import { env } from './env.js'

export const ONESHOT_RELAYER_URL = env.ONESHOT_RELAYER_URL

export const ONESHOT_METHODS = {
  GET_CAPABILITIES: 'relayer_getCapabilities',
  GET_FEE_DATA: 'relayer_getFeeData',
  ESTIMATE_7710: 'relayer_estimate7710Transaction',
  ESTIMATE_7710_MULTICHAIN: 'relayer_estimate7710TransactionMultichain',
  SEND_7710: 'relayer_send7710Transaction',
  SEND_7710_MULTICHAIN: 'relayer_send7710TransactionMultichain',
  GET_STATUS: 'relayer_getStatus',
} as const

export const ONESHOT_STATUS = {
  PENDING: 'Pending',
  SUBMITTED: 'Submitted',
  CONFIRMED: 'Confirmed',
  REJECTED: 'Rejected',
  REVERTED: 'Reverted',
} as const

export type OneShotStatus =
  (typeof ONESHOT_STATUS)[keyof typeof ONESHOT_STATUS]

export const ONESHOT_TERMINAL_STATUSES: OneShotStatus[] = [
  ONESHOT_STATUS.CONFIRMED,
  ONESHOT_STATUS.REJECTED,
  ONESHOT_STATUS.REVERTED,
]

export const ONESHOT_ERROR_CODES = {
  INSUFFICIENT_PAYMENT: 4200,
  UNSUPPORTED_TOKEN: 4202,
  QUOTE_EXPIRED: 4204,
  INVALID_AUTH_LIST: 4210,
  SIMULATION_FAILED: 4211,
} as const

export const ONESHOT_CONFIG = {
  POLL_INTERVAL_MS: 2500,
  MAX_POLL_ATTEMPTS: 60,
  QUOTE_LOCK_WINDOW_MS: 40_000,
  MAX_AUTH_LIST_ENTRIES: 1,
  FEE_BUFFER_PERCENT: 10,
  CAPABILITIES_CACHE_TTL_MS: 60_000,
} as const

export const ONESHOT_ACCEPTED_TOKENS = {
  USDC: 'USDC',
  USDT: 'USDT',
  USDG: 'USDG',
  MUSD: 'mUSD',
} as const

export type OneShotToken = keyof typeof ONESHOT_ACCEPTED_TOKENS

export const ONESHOT_WEBHOOK_PATH = '/api/webhook/oneshot'
