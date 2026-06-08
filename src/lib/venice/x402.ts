import { Wallet } from 'ethers'
import { SiweMessage, generateNonce } from 'siwe'
import { env } from '../../config/env.js'
import { VENICE_BASE_URL, VENICE_X402_MIN_BALANCE_USD, VENICE_X402_TOP_UP_AMOUNT_USD } from '../../config/venice.js'
import { childLogger } from '../logger.js'
import { VeniceError } from '../errors.js'

const log = childLogger('venice:x402')
let _wallet: Wallet | null = null
function getWallet(): Wallet {
  if (_wallet) return _wallet
  if (!env.VENICE_WALLET_PRIVATE_KEY) {
    throw new VeniceError('VENICE_WALLET_PRIVATE_KEY not set')
  }
  _wallet = new Wallet(env.VENICE_WALLET_PRIVATE_KEY)
  return _wallet
}
export function getX402WalletAddress(): string {
  return getWallet().address
}
export async function buildSIWXHeader(resourceUrl: string): Promise<string> {
  const wallet = getWallet()
  const now = new Date()
  const siwe = new SiweMessage({
    domain: 'api.venice.ai',
    address: wallet.address,
    statement: 'Sign in to Venice AI',
    uri: resourceUrl,
    version: '1',
    chainId: 8453, // Base
    nonce: generateNonce(),
    issuedAt: now.toISOString(),
    expirationTime: new Date(now.getTime() + 5 * 60 * 1000).toISOString(),
  })
  const message = siwe.prepareMessage()
  const signature = await wallet.signMessage(message)
  return Buffer.from(
    JSON.stringify({
      address: wallet.address,
      message,
      signature,
      timestamp: now.getTime(),
      chainId: 8453,
    }),
    'utf8'
  ).toString('base64')
}
export async function checkBalance(): Promise<{
  balanceUsd: number
  canConsume: boolean
}> {
  const header = await buildSIWXHeader(
    `${VENICE_BASE_URL}/x402/balance/${wallet.address}`
  )
  const res = await fetch(`${VENICE_BASE_URL}/x402/balance/${wallet.address}`, {
    headers: { 'X-Sign-In-With-X': header },
  })
  if (!res.ok) throw new VeniceError(`Balance check failed: ${res.status}`, res.status)
  const data = await res.json() as { data: { balanceUsd: number; canConsume: boolean } }
  return data.data
}
export async function ensureSufficientBalance(): Promise<void> {
  const { balanceUsd, canConsume } = await checkBalance()
  if (!canConsume || balanceUsd < VENICE_X402_MIN_BALANCE_USD) {
    log.info({ balanceUsd }, 'Venice x402 balance low — topping up')
    await topUp(VENICE_X402_TOP_UP_AMOUNT_USD)
  }
}
export async function topUp(amountUsd: number): Promise<void> {
  const header = await buildSIWXHeader(`${VENICE_BASE_URL}/x402/top-up`)
  // First call returns 402 with payment details
  const initRes = await fetch(`${VENICE_BASE_URL}/x402/top-up`, {
    method: 'POST',
  })
  if (initRes.status !== 402) {
    log.info('Venice x402 top-up: already has balance or unexpected response')
    return
  }
  const paymentRequired = initRes.headers.get('PAYMENT-REQUIRED')
  if (!paymentRequired) throw new VeniceError('No PAYMENT-REQUIRED header in 402 response')
  const { accepts } = JSON.parse(paymentRequired) as {
    accepts: { network: string; asset: string; payTo: string; amount: string }[]
  }
  const baseOption = accepts.find((a) => a.network === 'base')
  if (!baseOption) throw new VeniceError('No Base network payment option in Venice 402 response')
  const { createPaymentHeader } = await import('x402/client')
  const { privateKeyToAccount } = await import('viem/accounts')
  const signer = privateKeyToAccount(env.VENICE_WALLET_PRIVATE_KEY as `0x${string}`)
  const amountBaseUnits = String(Math.round(amountUsd * 1e6))
  const paymentHeader = await createPaymentHeader(signer, 2, {
    scheme: 'exact',
    network: 'base',
    maxAmountRequired: amountBaseUnits,
    resource: `${VENICE_BASE_URL}/x402/top-up`,
    description: 'Nexario Venice x402 top-up',
    mimeType: 'application/json',
    payTo: baseOption.payTo as `0x${string}`,
    maxTimeoutSeconds: 300,
    asset: baseOption.asset as `0x${string}`,
    extra: { name: 'USD Coin', version: '2' },
  })
  const retryHeader = await buildSIWXHeader(`${VENICE_BASE_URL}/x402/top-up`)
  const retryRes = await fetch(`${VENICE_BASE_URL}/x402/top-up`, {
    headers: {
      'X-Sign-In-With-X': retryHeader,
      'X-402-Payment': paymentHeader,
    },
  })
  if (!retryRes.ok) {
    throw new VeniceError(`x402 top-up failed: ${retryRes.status}`, retryRes.status)
  }
  log.info({ amountUsd }, 'Venice x402 top-up successful')
}
