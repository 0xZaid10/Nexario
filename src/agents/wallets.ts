import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts'
import { createWalletClient, http } from 'viem'
import type { Address, Hex } from 'viem'
import { VeniceClient } from 'venice-x402-client'
import { childLogger } from '../lib/logger.js'
import { TARGET_CHAIN } from '../config/chains.js'
import { env } from '../config/env.js'

const log = childLogger('agents:wallets')

export type AgentWalletName = 'coordinator' | 'research' | 'audit' | 'report'

export interface AgentWallet {
  name: AgentWalletName
  address: Address
  privateKey: Hex
  veniceClient: VeniceClient
}

// Agent private keys — loaded from env or generated deterministically
// In production: store in KMS. For hackathon: env vars.
function getAgentPrivateKey(name: AgentWalletName): Hex {
  const envKey = process.env[`AGENT_${name.toUpperCase()}_PRIVATE_KEY`]
  if (envKey && envKey.startsWith('0x') && envKey.length === 66) {
    return envKey as Hex
  }

  // Derive deterministically from master key + agent name
  // This ensures same address across restarts without storing separately
  const { keccak256, encodePacked, toHex } = require('viem')
  const masterKey = env.PRIVATE_KEY as Hex
  const derived = keccak256(
    encodePacked(['bytes32', 'string'], [masterKey, name])
  )
  return derived as Hex
}

const _agentWallets = new Map<AgentWalletName, AgentWallet>()

export function getAgentWallet(name: AgentWalletName): AgentWallet {
  const cached = _agentWallets.get(name)
  if (cached) return cached

  const privateKey = getAgentPrivateKey(name)
  const account = privateKeyToAccount(privateKey)

  const veniceClient = new VeniceClient(privateKey)

  const wallet: AgentWallet = {
    name,
    address: account.address,
    privateKey,
    veniceClient,
  }

  _agentWallets.set(name, wallet)
  log.info({ name, address: account.address }, 'agent wallet initialized')

  return wallet
}

export function getAllAgentWallets(): AgentWallet[] {
  const names: AgentWalletName[] = ['coordinator', 'research', 'audit', 'report']
  return names.map(getAgentWallet)
}

export function getAgentAddress(name: AgentWalletName): Address {
  return getAgentWallet(name).address
}

export function getAgentVeniceClient(name: AgentWalletName): VeniceClient {
  return getAgentWallet(name).veniceClient
}

export async function ensureAgentVeniceBalance(
  name: AgentWalletName,
  minBalanceUsd = 2
): Promise<void> {
  const wallet = getAgentWallet(name)
  try {
    const balance = await wallet.veniceClient.getBalance()
    if (!balance.canConsume || balance.balanceUsd < minBalanceUsd) {
      log.info({ name, balance: balance.balanceUsd }, 'topping up Venice balance')
      await wallet.veniceClient.topUp(10)
    }
  } catch (err) {
    log.warn({ name, err }, 'Venice balance check failed — will use API key fallback')
  }
}

export function printAgentWallets(): void {
  const names: AgentWalletName[] = ['coordinator', 'research', 'audit', 'report']
  console.log('\n=== Agent Wallets ===')
  for (const name of names) {
    const wallet = getAgentWallet(name)
    console.log(`${name}: ${wallet.address}`)
  }
  console.log('====================\n')
}
