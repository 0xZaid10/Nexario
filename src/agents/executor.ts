/**
 * Executor Agent — Pure On-Chain Execution
 *
 * No Venice AI calls. Receives structured executionParams from coordinator
 * and builds on-chain calldata for 1Shot relay.
 *
 * Supported actions:
 *   - transfer: send USDC/tokens to any address
 *   - swap: DEX swap (future)
 *   - call: arbitrary contract call (future)
 */

import { childLogger } from '../lib/logger.js'
import { encodeFunctionData, erc20Abi, parseUnits, isAddress } from 'viem'
import type { Address } from 'viem'

const log = childLogger('agent:executor')

// Known token addresses on Base
const BASE_TOKENS: Record<string, Address> = {
  USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  USDT: '0xfde4c96c8593536e31f229ea8f37b2ada2699bb2',
  WETH: '0x4200000000000000000000000000000000000006',
  ETH:  '0x4200000000000000000000000000000000000006', // WETH on Base
}

export interface ExecutionParams {
  action: 'transfer' | 'swap' | 'call'
  sellToken?: string
  token?: string
  amount?: string
  to?: string
  contractAddress?: string
  calldata?: string
}

export interface ExecutorInput {
  instruction: string
  userAddress: Address
  permissionsContext: string
  availableBudgetUsdc: number
  executionParams?: ExecutionParams  // structured params from coordinator
}

export interface ExecutorOutput {
  type: 'transfer' | 'swap' | 'call' | 'analysis'
  content: string
  requiresRelay: boolean
  estimatedFeeUsdc: number
  // On-chain execution to add to 1Shot bundle
  execution?: {
    target: Address
    value: string
    data: `0x${string}`
  }
  approvalExecution?: {
    target: Address
    value: string
    data: `0x${string}`
  } | null
  parsed?: {
    action: string
    token: string
    amount: string
    amountAtoms: bigint
    recipient: Address
    tokenAddress: Address
  }
}

export async function runExecutor(input: ExecutorInput): Promise<ExecutorOutput> {
  log.info({
    instruction: input.instruction.slice(0, 80),
    hasExecutionParams: !!input.executionParams,
  }, 'executor agent running')

  const params = input.executionParams

  // If structured params provided by coordinator — execute directly
  if (params?.action === 'transfer' && params.to && params.amount && params.token) {
    return buildTransferExecution(params, input.userAddress, input.availableBudgetUsdc)
  }

  // Fallback: parse from instruction text
  return parseAndBuildExecution(input.instruction, input.userAddress, input.availableBudgetUsdc)
}

async function buildTransferExecution(
  params: ExecutionParams,
  userAddress: Address,
  availableBudgetUsdc: number
): Promise<ExecutorOutput> {
  const token = (params.token ?? 'USDC').toUpperCase()
  const tokenAddress = BASE_TOKENS[token]

  if (!tokenAddress) {
    return {
      type: 'analysis',
      content: `Unsupported token: ${params.token}. Supported: USDC, USDT, WETH`,
      requiresRelay: false,
      estimatedFeeUsdc: 0,
    }
  }

  if (!params.to || !isAddress(params.to)) {
    return {
      type: 'analysis',
      content: `Invalid recipient address: ${params.to}`,
      requiresRelay: false,
      estimatedFeeUsdc: 0,
    }
  }

  const decimals = token === 'USDC' || token === 'USDT' ? 6 : 18
  const amountNum = parseFloat(params.amount ?? '0')
  const amountAtoms = parseUnits((params.amount ?? '0'), decimals)

  if (amountNum > availableBudgetUsdc) {
    return {
      type: 'analysis',
      content: `Insufficient budget. Transfer amount $${amountNum} exceeds remaining budget $${availableBudgetUsdc}.`,
      requiresRelay: false,
      estimatedFeeUsdc: 0,
    }
  }

  // Build ERC20 transfer calldata
  const calldata = encodeFunctionData({
    abi: erc20Abi,
    functionName: 'transfer',
    args: [params.to as Address, amountAtoms],
  })

  log.info({
    token,
    amount: params.amount,
    amountAtoms: amountAtoms.toString(),
    to: params.to,
    tokenAddress,
  }, 'executor built transfer calldata')

  return {
    type: 'transfer',
    content: `✅ Executing on-chain transfer: ${params.amount} USD Coin to ${params.to.slice(0, 6)}...${params.to.slice(-4)} via 1Shot relay on Base. Zero ETH needed. Tx hash will appear in transaction details.`,
    requiresRelay: true,
    estimatedFeeUsdc: 0.01,
    execution: {
      target: tokenAddress,
      value: '0x0',
      data: calldata,
    },
    parsed: {
      action: 'transfer',
      token,
      amount: params.amount ?? '0',
      amountAtoms,
      recipient: params.to as Address,
      tokenAddress,
    },
  }
}

async function parseAndBuildExecution(
  instruction: string,
  userAddress: Address,
  availableBudgetUsdc: number
): Promise<ExecutorOutput> {
  // Simple regex parsing for "send X TOKEN to 0x..."
  const transferMatch = instruction.match(
    /send\s+([\d.]+)\s+(\w+)\s+(?:to\s+)?(0x[a-fA-F0-9]{40})/i
  )

  if (transferMatch) {
    const [, amount, token, to] = transferMatch
    return buildTransferExecution(
      { action: 'transfer', token, amount, to },
      userAddress,
      availableBudgetUsdc
    )
  }

  // Swap parsing: "swap X USDC to ETH", "buy X ETH with USDC"
  const swapMatch = instruction.match(
    /(?:swap|buy|purchase|exchange|get)\s+([\d.]+)\s+(\w+)\s+(?:to|for|with|into|of|worth of)?\s*(\w+)/i
  )
  if (swapMatch) {
    const [, amount, fromToken, toToken] = swapMatch
    return buildSwapExecution(
      { action: 'swap', token: toToken, amount, sellToken: fromToken },
      userAddress,
      availableBudgetUsdc
    )
  }

  // Monitor trigger swap: "swap 1 USDC to ETH"
  const monitorSwapMatch = instruction.match(
    /swap\s+([\d.]+)\s+(\w+)\s+to\s+(\w+)/i
  )
  if (monitorSwapMatch) {
    const [, amount, fromToken, toToken] = monitorSwapMatch
    return buildSwapExecution(
      { action: 'swap', token: toToken, amount, sellToken: fromToken },
      userAddress,
      availableBudgetUsdc
    )
  }

  // "1 USDC worth of ETH" or "buy 1 USDC of ETH"
  const worthMatch = instruction.match(
    /(?:buy|purchase|get|swap)\s+([\d.]+)\s+(\w+)\s+(?:worth of|of)\s+(\w+)/i
  )
  if (worthMatch) {
    const [, amount, fromToken, toToken] = worthMatch
    return buildSwapExecution(
      { action: 'swap', token: toToken, amount, sellToken: fromToken },
      userAddress,
      availableBudgetUsdc
    )
  }

  return {
    type: 'analysis',
    content: `I can execute: "send 0.1 USDC to 0x742d..." or "swap 1 USDC to ETH"`,
    requiresRelay: false,
    estimatedFeeUsdc: 0,
  }
}

async function buildSwapExecution(
  params: { action: 'swap'; token: string; amount: string; sellToken?: string },
  userAddress: Address,
  availableBudgetUsdc: number
): Promise<ExecutorOutput> {
  const { getSwapQuote, BASE_TOKENS } = await import('../lib/dex/zeroex.js')

  const sellToken = params.sellToken ?? 'USDC'
  const buyToken = params.token

  // Validate tokens
  const sellAddr = BASE_TOKENS[sellToken.toUpperCase()]
  const buyAddr = BASE_TOKENS[buyToken.toUpperCase()]
  if (!sellAddr) return { type: 'analysis', content: `Unsupported sell token: ${sellToken}. Supported: ${Object.keys(BASE_TOKENS).join(', ')}`, requiresRelay: false, estimatedFeeUsdc: 0 }
  if (!buyAddr) return { type: 'analysis', content: `Unsupported buy token: ${buyToken}. Supported: ${Object.keys(BASE_TOKENS).join(', ')}`, requiresRelay: false, estimatedFeeUsdc: 0 }

  const amountNum = parseFloat(params.amount)
  if (isNaN(amountNum) || amountNum <= 0) return { type: 'analysis', content: `Invalid swap amount: ${params.amount}`, requiresRelay: false, estimatedFeeUsdc: 0 }
  if (amountNum > availableBudgetUsdc) return { type: 'analysis', content: `Insufficient budget. Swap amount $${amountNum} exceeds remaining budget $${availableBudgetUsdc}.`, requiresRelay: false, estimatedFeeUsdc: 0 }

  // Get 0x quote
  const quote = await getSwapQuote({
    sellToken,
    buyToken,
    sellAmountUsdc: amountNum,
    takerAddress: userAddress,
    slippageBps: 50,
  })

  const buyAmountFormatted = buyToken.toUpperCase() === 'ETH' || buyToken.toUpperCase() === 'WETH'
    ? (parseFloat(quote.buyAmount) / 1e18).toFixed(6)
    : (parseFloat(quote.buyAmount) / 1e6).toFixed(4)

  // Build permit2 approval + swap executions
  const { encodeFunctionData, erc20Abi, maxUint256 } = await import('viem')
  const PERMIT2 = '0x000000000022d473030f116ddee9f6b43ac78ba3' as Address

  // Check current allowance
  const { createPublicClient, http } = await import('viem')
  const { base } = await import('viem/chains')
  const { env } = await import('../config/env.js')
  const pub = createPublicClient({ chain: base, transport: http(env.BASE_RPC_URL) })
  const currentAllowance = await pub.readContract({
    address: (sellAddr as Address),
    abi: erc20Abi,
    functionName: 'allowance',
    args: [userAddress, PERMIT2],
  }).catch(() => 0n)

  const approvalExecution = currentAllowance < BigInt(Math.round(amountNum * 1_000_000))
    ? {
        target: sellAddr as Address,
        value: '0x0' as const,
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: 'approve',
          args: [PERMIT2, maxUint256],
        }),
      }
    : null

  // ⚠️ SAFETY NET: ERC-7715 erc20-token-periodic enforcer only allows transfer() calldata.
  // 0x swap calldata is rejected with ERC20PeriodTransferEnforcer:invalid-execution-length.
  // Swap via 1Shot is blocked until contract-call permission type is supported.
  // See README: DEX Swaps section for full technical details.
  return {
    type: 'analysis' as any,
    content: `⚠️ **Swap not yet supported via ERC-7715 delegation.** The ERC-7715 \`erc20-token-periodic\` permission only allows standard USDC transfers — the 0x swap router calldata is rejected by the \`ERC20PeriodTransferEnforcer\` on-chain. This will be enabled once \`contract-call\` permission type is supported by MetaMask Flask + 1Shot.

**What you CAN do right now:**
- Send USDC to any address: "send 0.5 USDC to 0x..."
- Run research on ${buyToken} price and market conditions
- Set up a price monitor for ${buyToken}

**Quote for reference:** ${params.amount} ${sellToken} → ~${buyAmountFormatted} ${buyToken} at current rates via 0x on Base.`,
    requiresRelay: false,
    estimatedFeeUsdc: 0,
  }

  // Dead code below — kept for when contract-call permission is available
  const { buildSwapExecution } = await import('../lib/dex/zeroex.js')
  const swapExec = buildSwapExecution(quote)

  return {
    type: 'swap' as any,
    content: `✅ Swap ready: ${params.amount} ${sellToken} → ~${buyAmountFormatted} ${buyToken} via 0x on Base. Price: ${parseFloat(quote.price).toFixed(6)} ${buyToken}/${sellToken}. Executing via 1Shot relay.`,
    requiresRelay: true,
    estimatedFeeUsdc: 0.01,
    execution: swapExec,
    approvalExecution,
    metadata: {
      swapType: `${sellToken}→${buyToken}`,
      sellAmount: params.amount,
      buyAmount: buyAmountFormatted,
      price: quote.price,
      router: quote.to,
    }
  }
}
