/**
 * 0x Swap API — get swap quotes + calldata for any ERC-20 pair on Base
 * Docs: https://0x.org/docs/api#tag/Swap/operation/swap::base::getQuote
 */
import { childLogger } from '../logger.js'
import { env } from '../../config/env.js'

const log = childLogger('dex:0x')

const ZERO_EX_BASE_URL = 'https://api.0x.org/swap/permit2/quote'
const ZERO_EX_PRICE_URL = 'https://api.0x.org/swap/permit2/price'

// Base mainnet token addresses
export const BASE_TOKENS: Record<string, `0x${string}`> = {
  USDC:  '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  WETH:  '0x4200000000000000000000000000000000000006',
  ETH:   '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
  USDT:  '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2',
  DAI:   '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb',
  CBETH: '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22',
  WBTC:  '0x0555E30da8f98308EdB960aa94C0Db47230d2B9',
}

export interface SwapQuote {
  sellToken: string
  buyToken: string
  sellAmount: string      // in base units
  buyAmount: string       // in base units
  price: string           // buy/sell ratio
  guaranteedPrice: string
  to: string              // router address to call
  data: `0x${string}`    // calldata
  value: string           // ETH value (0 for ERC20->ERC20)
  gas: string
  estimatedGas: string
  gasPrice: string
  buyTokenAddress: `0x${string}`
  sellTokenAddress: `0x${string}`
  allowanceTarget: `0x${string}`
  priceImpact: string
}

export interface SwapPrice {
  sellToken: string
  buyToken: string
  sellAmount: string
  buyAmount: string
  price: string
  estimatedGas: string
}

/**
 * Get a swap price (no calldata — for display/checking only)
 */
export async function getSwapPrice(params: {
  sellToken: string   // symbol or address
  buyToken: string    // symbol or address
  sellAmountUsdc?: number  // amount in USD
  sellAmountAtoms?: string // amount in base units
  takerAddress?: string
}): Promise<SwapPrice> {
  const sellAddr = BASE_TOKENS[params.sellToken.toUpperCase()] ?? params.sellToken
  const buyAddr = BASE_TOKENS[params.buyToken.toUpperCase()] ?? params.buyToken

  // Calculate sell amount
  let sellAmount: string
  if (params.sellAmountAtoms) {
    sellAmount = params.sellAmountAtoms
  } else {
    const usd = params.sellAmountUsdc ?? 1
    const decimals = params.sellToken.toUpperCase() === 'USDC' ? 6 : 18
    sellAmount = String(Math.round(usd * 10 ** decimals))
  }

  const url = new URL(ZERO_EX_PRICE_URL)
  url.searchParams.set('chainId', '8453')
  url.searchParams.set('sellToken', sellAddr)
  url.searchParams.set('buyToken', buyAddr)
  url.searchParams.set('sellAmount', sellAmount)
  if (params.takerAddress) url.searchParams.set('taker', params.takerAddress)

  const res = await fetch(url.toString(), {
    headers: {
      '0x-api-key': env.ZERO_EX_API_KEY ?? '',
      '0x-version': 'v2',
    },
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`0x price failed: ${res.status} ${err}`)
  }

  const data = await res.json() as any
  log.info({ sellToken: params.sellToken, buyToken: params.buyToken, price: data.price }, '0x price fetched')
  return data
}

/**
 * Get a full swap quote with calldata ready for execution
 */
export async function getSwapQuote(params: {
  sellToken: string
  buyToken: string
  sellAmountUsdc?: number
  sellAmountAtoms?: string
  takerAddress: string   // user's wallet (for permit2)
  slippageBps?: number   // default 50 = 0.5%
}): Promise<SwapQuote> {
  const sellAddr = BASE_TOKENS[params.sellToken.toUpperCase()] ?? params.sellToken
  const buyAddr = BASE_TOKENS[params.buyToken.toUpperCase()] ?? params.buyToken

  let sellAmount: string
  if (params.sellAmountAtoms) {
    sellAmount = params.sellAmountAtoms
  } else {
    const usd = params.sellAmountUsdc ?? 1
    const decimals = params.sellToken.toUpperCase() === 'USDC' ? 6 : 18
    sellAmount = String(Math.round(usd * 10 ** decimals))
  }

  const url = new URL(ZERO_EX_BASE_URL)
  url.searchParams.set('chainId', '8453')
  url.searchParams.set('sellToken', sellAddr)
  url.searchParams.set('buyToken', buyAddr)
  url.searchParams.set('sellAmount', sellAmount)
  url.searchParams.set('taker', params.takerAddress)
  url.searchParams.set('slippageBps', String(params.slippageBps ?? 50))

  const res = await fetch(url.toString(), {
    headers: {
      '0x-api-key': env.ZERO_EX_API_KEY ?? '',
      '0x-version': 'v2',
    },
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`0x quote failed: ${res.status} ${err}`)
  }

  const data = await res.json() as any
  log.info({
    sellToken: params.sellToken,
    buyToken: params.buyToken,
    sellAmount,
    buyAmount: data.buyAmount,
    price: data.price,
  }, '0x quote fetched')

  // permit2 quotes nest calldata inside transaction object
  const tx = data.transaction ?? data
  return {
    ...data,
    to: tx.to ?? data.to,
    data: tx.data ?? data.data,
    value: tx.value ?? data.value ?? '0',
    sellTokenAddress: sellAddr,
    buyTokenAddress: buyAddr,
  }
}

/**
 * Build executor-compatible execution from swap quote
 * Returns the calldata to include in 1Shot bundle
 */
export function buildSwapExecution(quote: SwapQuote): {
  target: `0x${string}`
  value: string
  data: `0x${string}`
} {
  return {
    target: quote.to as `0x${string}`,
    value: quote.value ? `0x${parseInt(quote.value).toString(16)}` : '0x0',
    data: quote.data as `0x${string}`,
  }
}
