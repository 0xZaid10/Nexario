import { randomBytes } from 'crypto'
import {
  createWalletClient,
  createPublicClient,
  http,
  type Hex,
  type Address,
  type WalletClient,
  type PublicClient,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { env } from '../config/env.js'
import { getViemChain } from '../config/chains.js'
import {
  EIP712_DELEGATION_TYPES,
  METAMASK_CONTRACTS,
} from '../config/contracts.js'
import type { Delegation } from '../types/index.js'

// ─── ID generators ────────────────────────────────────────────────────────────

export function generateSalt(): bigint {
  const bytes = randomBytes(32)
  return BigInt('0x' + bytes.toString('hex'))
}

export function generateTaskId(): string {
  const bytes = randomBytes(16)
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function generateStepId(): string {
  return `step_${randomBytes(8).toString('hex')}`
}

export function generateSubTaskId(): string {
  return `sub_${randomBytes(8).toString('hex')}`
}

// ─── Per-chain client cache (multi-user safe) ─────────────────────────────────
// Keyed by chainId so user A on Sepolia and user B on Base Sepolia
// each get the correct chain client. Backend signer is shared infrastructure —
// it signs agent sub-delegations, never user delegations (those happen in browser).

const walletClientCache = new Map<number, WalletClient>()
const publicClientCache = new Map<number, PublicClient>()

export function getBackendWalletClient(chainId: number): WalletClient {
  const cached = walletClientCache.get(chainId)
  if (cached) return cached

  const account = privateKeyToAccount(env.PRIVATE_KEY as Hex)
  const chain = getViemChain(chainId)

  const client = createWalletClient({
    account,
    chain,
    transport: http(),
  })

  walletClientCache.set(chainId, client)
  return client
}

export function getPublicClient(chainId: number, rpcUrl?: string): PublicClient {
  const cacheKey = rpcUrl ? chainId * 1000 + rpcUrl.length : chainId
  const cached = publicClientCache.get(cacheKey)
  if (cached) return cached

  const chain = getViemChain(chainId)

  const client = createPublicClient({
    chain,
    transport: http(rpcUrl),
  })

  publicClientCache.set(cacheKey, client)
  return client
}

export function getBackendAddress(): Address {
  return privateKeyToAccount(env.PRIVATE_KEY as Hex).address
}

// ─── EIP-712 delegation signing ───────────────────────────────────────────────
// Signs agent-to-agent sub-delegations with the backend key.
// User delegations (user → coordinator) are signed by MetaMask in the browser.
// The permissionsContext returned by wallet_requestExecutionPermissions
// already contains the user's signature — we never touch the user's key.

export async function signDelegation(
  delegation: Omit<Delegation, 'signature'>,
  chainId: number
): Promise<Hex> {
  const walletClient = getBackendWalletClient(chainId)
  const account = privateKeyToAccount(env.PRIVATE_KEY as Hex)

  const signature = await walletClient.signTypedData({
    account,
    domain: {
      name: 'DelegationManager',
      version: '1',
      chainId,
      verifyingContract: METAMASK_CONTRACTS.DELEGATION_MANAGER,
    },
    types: EIP712_DELEGATION_TYPES,
    primaryType: 'Delegation',
    message: {
      delegate: delegation.delegate,
      delegator: delegation.delegator,
      authority: delegation.authority,
      caveats: delegation.caveats,
      salt: delegation.salt,
    },
  })

  return signature
}

// ─── Ed25519 webhook verification ─────────────────────────────────────────────

export async function verifyEd25519Signature(
  payload: string,
  signatureB64: string,
  publicKeyB64: string
): Promise<boolean> {
  try {
    const { webcrypto } = await import('crypto')

    const publicKey = await webcrypto.subtle.importKey(
      'raw',
      Buffer.from(publicKeyB64, 'base64'),
      { name: 'Ed25519' },
      false,
      ['verify']
    )

    const payloadBytes = Buffer.from(payload, 'utf8')
    const signatureBytes = Buffer.from(signatureB64, 'base64')

    return webcrypto.subtle.verify(
      'Ed25519',
      publicKey,
      signatureBytes,
      payloadBytes
    )
  } catch {
    return false
  }
}
