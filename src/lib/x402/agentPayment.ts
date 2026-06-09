/**
 * x402 Payment System for Nexario Agents
 *
 * Two flows:
 *
 * 1. SYSTEM AGENTS charging users:
 *    Each task execution pulls fee from user's ERC-7715 delegation via 1Shot.
 *    Fee goes to agent wallet on Base.
 *
 * 2. USER-REGISTERED AGENTS calling Venice:
 *    Agent pays Venice via x402 per inference.
 *    Agent charges callers via x402 HTTP 402 protocol.
 */

import { childLogger } from '../logger.js'
import type { Address } from 'viem'

const log = childLogger('x402:agent-payment')

// Agent fee schedule in USDC
export const AGENT_FEES_USDC: Record<string, number> = {
  coordinator:  0.05,
  research:     0.10,
  audit:        0.15,
  report:       0.05,
  counsel:      0.20,
  intelligence: 0.15,
  reflection:   0.10,
  reputation:   0.08,
  monitor:      0.05,
  executor:     0.05,
}

export function getAgentFeeAtoms(agentName: string): bigint {
  const feeUsdc = AGENT_FEES_USDC[agentName] ?? 0.05
  return BigInt(Math.round(feeUsdc * 1_000_000))
}

// Build USDC transfer calldata for agent fee
// Included in 1Shot relay bundle — charges user, pays agent wallet
export function buildAgentFeeExecution(params: {
  agentName: string
  agentWallet: Address
  usdcAddress: Address
}): {
  target: Address
  value: string
  data: `0x${string}`
  feeUsdc: number
  feeAtoms: bigint
} {
  const feeAtoms = getAgentFeeAtoms(params.agentName)
  const feeUsdc = AGENT_FEES_USDC[params.agentName] ?? 0.05

  // ERC20.transfer(agentWallet, feeAtoms) calldata
  const selector = '0xa9059cbb'
  const recipient = params.agentWallet.slice(2).padStart(64, '0')
  const amount = feeAtoms.toString(16).padStart(64, '0')
  const data = `${selector}${recipient}${amount}` as `0x${string}`

  return { target: params.usdcAddress, value: '0x0', data, feeUsdc, feeAtoms }
}

// Build agent fee + work executions for 1Shot bundle
// Total bundle: [fee_to_1shot, agent_charge_to_agent_wallet, work_execution]
export function buildFullExecutionBundle(params: {
  agentName: string
  agentWallet: Address
  feeCollector: Address    // 1Shot fee collector
  relayFeeAtoms: bigint    // 1Shot relay fee
  usdcAddress: Address
  workExecution?: {        // optional work tx (send, swap, etc.)
    target: Address
    value: string
    data: `0x${string}`
  }
}): Array<{ target: Address; value: string; data: `0x${string}` }> {
  const agentFee = buildAgentFeeExecution({
    agentName: params.agentName,
    agentWallet: params.agentWallet,
    usdcAddress: params.usdcAddress,
  })

  const executions = [
    // 1. Pay 1Shot relay fee
    {
      target: params.usdcAddress,
      value: '0x0',
      data: buildTransferCalldata(params.feeCollector, params.relayFeeAtoms),
    },
    // 2. Pay agent fee to agent wallet
    {
      target: agentFee.target,
      value: agentFee.value,
      data: agentFee.data,
    },
  ]

  // 3. Optional work execution (send USDC, call contract, etc.)
  if (params.workExecution) {
    executions.push(params.workExecution)
  }

  return executions
}

function buildTransferCalldata(to: Address, amount: bigint): `0x${string}` {
  const selector = '0xa9059cbb'
  const recipient = to.slice(2).padStart(64, '0')
  const amt = amount.toString(16).padStart(64, '0')
  return `${selector}${recipient}${amt}` as `0x${string}`
}

// x402 response for user-registered agent endpoints
export function buildX402Response(params: {
  agentAddress: Address
  chargeAtoms: bigint
  endpoint: string
}): { status: 402; headers: Record<string, string>; body: object } {
  return {
    status: 402,
    headers: {
      'X-Payment-Required': 'true',
      'X-Payment-Amount': params.chargeAtoms.toString(),
      'X-Payment-Token': '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      'X-Payment-Recipient': params.agentAddress,
      'X-Payment-Chain': '8453',
      'X-Payment-Method': 'x402+1shot',
    },
    body: {
      error: 'Payment Required',
      paymentRequired: {
        amount: params.chargeAtoms.toString(),
        amountUsdc: Number(params.chargeAtoms) / 1_000_000,
        token: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        recipient: params.agentAddress,
        chainId: 8453,
        method: 'x402',
        endpoint: params.endpoint,
        instructions: 'Send payment via 1Shot relay on Base mainnet, then retry with X-Payment-Proof header',
      },
    },
  }
}
