/**
 * EIP-7702 account upgrade for agent wallets.
 *
 * Based on official 1Shot examples:
 * https://raw.githubusercontent.com/1Shot-API/skills/main/public-relayer/references/examples.md
 *
 * Pattern: delegatorAccount.signAuthorization({ chainId, contractAddress, nonce })
 * Returns auth tuple reshaped for 1Shot authorizationList.
 */

import type { Address, Hex } from 'viem'
import { createPublicClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { db } from '../../db/client.js'
import { childLogger } from '../logger.js'
import { env } from '../../config/env.js'
import { getViemChain } from '../../config/chains.js'

const log = childLogger('oneshot:upgrade')

// Tracks which addresses have already been upgraded via EIP-7702
const upgradedAddresses = new Set<string>()
let _loaded = false

export async function loadUpgradedAddresses(): Promise<void> {
  if (_loaded) return
  try {
    const rows = await db.query.sessions.findMany({ columns: { userAddress: true } })
    rows.forEach((r) => upgradedAddresses.add(r.userAddress.toLowerCase()))
    _loaded = true
  } catch {
    _loaded = true
  }
}

export function isUpgraded(address: Address): boolean {
  return upgradedAddresses.has(address.toLowerCase())
}

export function markUpgraded(address: Address): void {
  upgradedAddresses.add(address.toLowerCase())
  log.info({ address }, 'address marked as EIP-7702 upgraded')
}

export interface AuthorizationEntry {
  address: Address
  chainId: number
  nonce: number
  r: Hex
  s: Hex
  yParity: number
}

/**
 * Build EIP-7702 authorization list for first relay.
 * Uses delegatorAccount.signAuthorization directly (not walletClient).
 * Returns [] if already upgraded.
 */
export async function buildAuthorizationList(
  delegatorAddress: Address,
  delegatorImplAddress: Address,
  chainId: number,
  nonce: bigint | number
): Promise<AuthorizationEntry[]> {
  if (isUpgraded(delegatorAddress)) {
    log.debug({ delegatorAddress }, 'already upgraded — omitting authorizationList')
    return []
  }

  log.info({ delegatorAddress, delegatorImplAddress, chainId }, 'building EIP-7702 authorization')

  // Use agent's private key to sign authorization
  // In production: user signs this via MetaMask — we sign for demo agents
  const account = privateKeyToAccount(env.PRIVATE_KEY as Hex)
  const nonceNum = Number(nonce)

  // Correct pattern from 1Shot official examples:
  // delegatorAccount.signAuthorization({ chainId, contractAddress, nonce })
  const auth = await account.signAuthorization({
    chainId,
    contractAddress: delegatorImplAddress,
    nonce: nonceNum,
  })

  markUpgraded(delegatorAddress)

  // Reshape to 1Shot authorizationList format
  return [{
    address: auth.address ?? delegatorImplAddress,
    chainId: typeof auth.chainId === 'string' ? parseInt(auth.chainId) : (auth.chainId ?? chainId),
    nonce: typeof auth.nonce === 'string' ? parseInt(auth.nonce) : (auth.nonce ?? nonceNum),
    r: auth.r,
    s: auth.s,
    yParity: auth.yParity ?? 0,
  }]
}

export async function getAccountNonce(
  address: Address,
  chainId: number
): Promise<bigint> {
  const chain = getViemChain(chainId)
  const rpcUrl = process.env['BASE_RPC_URL'] ?? undefined
  const client = createPublicClient({
    chain,
    transport: http(rpcUrl),
  })
  const count = await client.getTransactionCount({ address, blockTag: 'pending' })
  return BigInt(count)
}
