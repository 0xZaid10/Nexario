import { createPublicClient, createWalletClient, http, parseAbi } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import type { Address, Hex } from 'viem'
import { env } from '../config/env.js'
import { NEXARIO_CONTRACTS } from '../config/contracts.js'
import { TARGET_CHAIN, REGISTRY_CHAIN, getViemChain } from '../config/chains.js'
import { childLogger } from '../lib/logger.js'
import { usdcToAtoms } from '../lib/encoding.js'
import type { AgentCapability } from '../types/index.js'

const log = childLogger('services:lease-registry')

const LEASE_REGISTRY_ABI = parseAbi([
  'function createLease(address delegate, uint256 budgetUsdc, uint64 expiresAt, uint8 maxDepth, uint16 minReputation, string capability, bytes32 delegationHash, address delegationManager) returns (bytes32 leaseId)',
  'function consumeLease(bytes32 leaseId, uint256 amountUsdc) external',
  'function redelegate(bytes32 parentLeaseId, address subDelegate, uint256 childBudgetUsdc, uint64 childExpiresAt, string capability, bytes32 childDelegationHash) returns (bytes32 childLeaseId)',
  'function revokeLease(bytes32 leaseId) external',
  'function isLeaseActive(bytes32 leaseId) view returns (bool)',
  'function getRemainingBudget(bytes32 leaseId) view returns (uint256)',
  'function getLeaseChain(bytes32 leaseId) view returns (bytes32[])',
  'function getDelegatorLeases(address delegator) view returns (bytes32[])',
])

function isRegistryDeployed(): boolean {
  return (
    !!NEXARIO_CONTRACTS.AUTHORITY_LEASE_REGISTRY &&
    NEXARIO_CONTRACTS.AUTHORITY_LEASE_REGISTRY !== '0x0'
  )
}

export async function createOnChainLease(params: {
  delegate: Address
  budgetUsdc: number
  expiresAt: number
  maxDepth?: number
  minReputation?: number
  capability: AgentCapability | string
  delegationHash: Hex
  delegationManager: Address
  chainId?: number
}): Promise<{ leaseId: Hex; txHash: Hex } | null> {
  if (!isRegistryDeployed()) {
    log.warn('AuthorityLeaseRegistry not deployed — skipping on-chain lease creation')
    return null
  }

  const chainId = params.chainId ?? REGISTRY_CHAIN.id
  const chain = getViemChain(chainId)
  const account = privateKeyToAccount(env.PRIVATE_KEY as Hex)
  const walletClient = createWalletClient({ account, chain, transport: http() })
  const publicClient = createPublicClient({ chain, transport: http() })

  log.info(
    { delegate: params.delegate, budgetUsdc: params.budgetUsdc },
    'creating on-chain authority lease'
  )

  const txHash = await walletClient.writeContract({
    address: NEXARIO_CONTRACTS.AUTHORITY_LEASE_REGISTRY,
    abi: LEASE_REGISTRY_ABI,
    functionName: 'createLease',
    args: [
      params.delegate,
      usdcToAtoms(params.budgetUsdc),
      BigInt(params.expiresAt),
      params.maxDepth ?? 3,
      params.minReputation ?? 0,
      params.capability,
      params.delegationHash,
      params.delegationManager,
    ],
  })

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })

  // Parse leaseId from LeaseCreated event (topic[1] = indexed leaseId)
  const log_ = receipt.logs.find((l) => l.topics.length >= 2)
  const leaseId = (log_?.topics[1] ?? '0x') as Hex

  log.info({ leaseId, txHash }, 'on-chain lease created')
  return { leaseId, txHash }
}

export async function consumeOnChainLease(
  leaseId: Hex,
  amountUsdc: bigint,
  chainId?: number
): Promise<Hex | null> {
  if (!isRegistryDeployed()) return null

  const chain = getViemChain(chainId ?? REGISTRY_CHAIN.id)
  const account = privateKeyToAccount(env.PRIVATE_KEY as Hex)
  const walletClient = createWalletClient({ account, chain, transport: http() })

  const txHash = await walletClient.writeContract({
    address: NEXARIO_CONTRACTS.AUTHORITY_LEASE_REGISTRY,
    abi: LEASE_REGISTRY_ABI,
    functionName: 'consumeLease',
    args: [leaseId, amountUsdc],
  })

  log.debug({ leaseId, amountUsdc: amountUsdc.toString(), txHash }, 'lease consumed on-chain')
  return txHash
}

export async function redelegateOnChain(params: {
  parentLeaseId: Hex
  subDelegate: Address
  childBudgetUsdc: bigint
  childExpiresAt: number
  capability: string
  childDelegationHash: Hex
  chainId?: number
}): Promise<{ childLeaseId: Hex; txHash: Hex } | null> {
  if (!isRegistryDeployed()) return null

  const chain = getViemChain(params.chainId ?? REGISTRY_CHAIN.id)
  const account = privateKeyToAccount(env.PRIVATE_KEY as Hex)
  const walletClient = createWalletClient({ account, chain, transport: http() })
  const publicClient = createPublicClient({ chain, transport: http() })

  const txHash = await walletClient.writeContract({
    address: NEXARIO_CONTRACTS.AUTHORITY_LEASE_REGISTRY,
    abi: LEASE_REGISTRY_ABI,
    functionName: 'redelegate',
    args: [
      params.parentLeaseId,
      params.subDelegate,
      params.childBudgetUsdc,
      BigInt(params.childExpiresAt),
      params.capability,
      params.childDelegationHash,
    ],
  })

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })
  const log_ = receipt.logs.find((l) => l.topics.length >= 3)
  const childLeaseId = (log_?.topics[2] ?? '0x') as Hex

  log.info(
    { parentLeaseId: params.parentLeaseId, childLeaseId, txHash },
    'sub-delegation created on-chain'
  )

  return { childLeaseId, txHash }
}

export async function revokeOnChainLease(
  leaseId: Hex,
  chainId?: number
): Promise<Hex | null> {
  if (!isRegistryDeployed()) return null

  const chain = getViemChain(chainId ?? REGISTRY_CHAIN.id)
  const account = privateKeyToAccount(env.PRIVATE_KEY as Hex)
  const walletClient = createWalletClient({ account, chain, transport: http() })

  const txHash = await walletClient.writeContract({
    address: NEXARIO_CONTRACTS.AUTHORITY_LEASE_REGISTRY,
    abi: LEASE_REGISTRY_ABI,
    functionName: 'revokeLease',
    args: [leaseId],
  })

  log.info({ leaseId, txHash }, 'lease revoked on-chain')
  return txHash
}

export async function getOnChainLeaseChain(
  leaseId: Hex,
  chainId?: number
): Promise<Hex[]> {
  if (!isRegistryDeployed()) return []

  const chain = getViemChain(chainId ?? REGISTRY_CHAIN.id)
  const publicClient = createPublicClient({ chain, transport: http() })

  return publicClient.readContract({
    address: NEXARIO_CONTRACTS.AUTHORITY_LEASE_REGISTRY,
    abi: LEASE_REGISTRY_ABI,
    functionName: 'getLeaseChain',
    args: [leaseId],
  }) as Promise<Hex[]>
}
