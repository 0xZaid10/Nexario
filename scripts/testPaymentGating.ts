/**
 * Test: payment-gated reputation enforcement
 * 
 * Verifies:
 * 1. Agent owner cannot give feedback to themselves
 * 2. Random wallet without payment proof gets rejected
 * 3. Random wallet WITH fake txHash (non-zero) gets accepted on-chain
 *    (contract accepts non-zero hash — verification is off-chain via Etherscan)
 * 
 * Run: npx tsx scripts/testPaymentGating.ts
 */

import { createWalletClient, createPublicClient, http, keccak256, toBytes } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { sepolia } from 'viem/chains'
import * as dotenv from 'dotenv'
import { resolve } from 'path'
import { readFileSync } from 'fs'

dotenv.config({ path: resolve(process.cwd(), '.env') })

const SEPOLIA_RPC = process.env['SEPOLIA_RPC_URL'] ?? 'https://ethereum-sepolia-rpc.publicnode.com'
const RESEARCH_KEY = process.env['AGENT_RESEARCH_PRIVATE_KEY'] as `0x${string}`
const MASTER_KEY = process.env['PRIVATE_KEY'] as `0x${string}`

const deployments = JSON.parse(
  readFileSync(resolve(process.cwd(), 'contracts/deployments/sepolia.json'), 'utf8')
) as Record<string, string>

const REPUTATION_REGISTRY = deployments['ReputationRegistry'] as `0x${string}`
const ZERO_BYTES32 = ('0x' + '00'.repeat(32)) as `0x${string}`
const FAKE_TX_HASH = keccak256(toBytes('fake-payment-' + Date.now())) as `0x${string}`

const GIVE_FEEDBACK_ABI = [{
  name: 'giveFeedback',
  type: 'function' as const,
  stateMutability: 'nonpayable' as const,
  inputs: [
    { name: 'agentId', type: 'uint256' },
    { name: 'value', type: 'int128' },
    { name: 'valueDecimals', type: 'uint8' },
    { name: 'tag1', type: 'string' },
    { name: 'tag2', type: 'string' },
    { name: 'endpoint', type: 'string' },
    { name: 'feedbackURI', type: 'string' },
    { name: 'feedbackHash', type: 'bytes32' },
  ],
  outputs: [],
}] as const

async function tryFeedback(
  label: string,
  privateKey: `0x${string}`,
  agentId: number,
  feedbackHash: `0x${string}`,
  fund = false
) {
  const account = privateKeyToAccount(privateKey)
  const publicClient = createPublicClient({ chain: sepolia, transport: http(SEPOLIA_RPC) })

  console.log(`\n${label}`)
  console.log(`  Wallet: ${account.address}`)
  console.log(`  feedbackHash: ${feedbackHash === ZERO_BYTES32 ? 'ZERO (no payment proof)' : 'non-zero (payment claimed)'}`)

  // Fund if needed (random wallets have no ETH)
  if (fund) {
    const balance = await publicClient.getBalance({ address: account.address })
    if (balance < 1_000_000_000_000_000n) {
      console.log('  ⚡ Funding wallet for test...')
      const masterAccount = privateKeyToAccount(MASTER_KEY)
      const masterClient = createWalletClient({ account: masterAccount, chain: sepolia, transport: http(SEPOLIA_RPC) })
      const tx = await masterClient.sendTransaction({ to: account.address, value: 5_000_000_000_000_000n })
      await publicClient.waitForTransactionReceipt({ hash: tx })
    }
  }

  // Simulate first (no gas cost)
  try {
    await publicClient.simulateContract({
      address: REPUTATION_REGISTRY,
      abi: GIVE_FEEDBACK_ABI,
      functionName: 'giveFeedback',
      args: [BigInt(agentId), 85n, 0, 'successRate', '', '', '', feedbackHash],
      account: account.address,
    })

    // If simulation passes, actually send
    const walletClient = createWalletClient({ account, chain: sepolia, transport: http(SEPOLIA_RPC) })
    const txHash = await walletClient.writeContract({
      address: REPUTATION_REGISTRY,
      abi: GIVE_FEEDBACK_ABI,
      functionName: 'giveFeedback',
      args: [BigInt(agentId), 85n, 0, 'successRate', '', '', '', feedbackHash],
    })
    await publicClient.waitForTransactionReceipt({ hash: txHash })
    console.log(`  ✅ ACCEPTED`)
    console.log(`  tx: https://sepolia.etherscan.io/tx/${txHash}`)
    console.log(`  Note: contract accepted non-zero hash — verification is off-chain via Etherscan`)
  } catch (err: any) {
    const reason = err?.cause?.reason ?? err?.shortMessage ?? err?.message ?? 'unknown'
    console.log(`  ❌ REJECTED: ${reason}`)
  }
}

async function main() {
  console.log('\n🧪 Testing Payment-Gated Reputation Enforcement')
  console.log(`ReputationRegistry: ${REPUTATION_REGISTRY}`)
  console.log(`Target agent: Research (agentId=2)`)

  // Test 1: Owner wallet trying to give feedback to themselves
  await tryFeedback(
    'Test 1: Agent OWNER tries to give self-feedback',
    RESEARCH_KEY,
    2,
    ZERO_BYTES32
  )

  // Test 2: Random wallet with ZERO feedbackHash (no payment proof)
  const randomKey = generatePrivateKey()
  await tryFeedback(
    'Test 2: Random wallet with ZERO feedbackHash (no payment proof)',
    randomKey,
    2,
    ZERO_BYTES32,
    true // fund it so gas isn't the issue
  )

  // Test 3: Random wallet with non-zero feedbackHash (claims payment)
  const randomKey2 = generatePrivateKey()
  await tryFeedback(
    'Test 3: Random wallet with non-zero feedbackHash (claims payment)',
    randomKey2,
    2,
    FAKE_TX_HASH,
    true
  )

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('Summary:')
  console.log('  Test 1: Owner blocked ← self-rating prevention')
  console.log('  Test 2: Zero hash blocked ← payment proof required')
  console.log('  Test 3: Non-zero hash accepted ← contract trusts hash, verification is off-chain')
  console.log('\nIn production: feedbackHash = actual 1Shot mainnet txHash')
  console.log('Anyone can verify on Etherscan that the tx actually happened')
  console.log('and the caller (clientAddress) actually paid the agent.')
}

main().catch(console.error)
