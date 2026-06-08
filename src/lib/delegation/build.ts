import type { Address, Hex } from 'viem'
import { encodeAbiParameters, parseAbiParameters, keccak256, toHex } from 'viem'
import {
  CAVEAT_ENFORCERS,
  METAMASK_CAVEAT_ENFORCERS,
  ROOT_AUTHORITY,
} from '../../config/contracts.js'
import { generateSalt, signDelegation } from '../signature.js'
import {
  encodeBudgetCaveatTerms,
  encodeTimestampCaveatTerms,
  encodePermissionContext,
} from '../encoding.js'
import type { Delegation, Caveat, SubLeaseParams } from '../../types/index.js'
import { BudgetExceededError } from '../errors.js'
import { childLogger } from '../logger.js'

const log = childLogger('delegation:build')

export interface BuiltDelegation {
  delegation: Delegation
  permissionContext: Hex
}

export interface BuiltSubDelegation extends BuiltDelegation {
  budgetUsdc: bigint
  expiresAt: number
}

export interface SubDelegationParams extends SubLeaseParams {
  chainId: number
  // If set, adds ReputationGatedCaveat requiring min successRate
  minReputation?: number
  // Registry + agentId for reputation gating
  reputationRegistry?: Address
  agentId?: number
  // Trusted clients whose feedback counts
  trustedClients?: Address[]
}

export async function buildSubDelegation(
  params: SubDelegationParams
): Promise<BuiltSubDelegation> {
  const {
    delegate,
    budgetUsdc,
    actions,
    durationSeconds,
    parentDelegation,
    chainId,
  } = params

  // Enforce budget ceiling
  const parentBudget = extractBudgetFromCaveats(parentDelegation.caveats)
  if (parentBudget !== null && budgetUsdc > parentBudget) {
    throw new BudgetExceededError(parentBudget.toString(), budgetUsdc.toString())
  }

  const now = Math.floor(Date.now() / 1000)
  const expiresAt = now + durationSeconds

  const caveats: Caveat[] = [
    // Use MetaMask's official ERC20TransferAmountEnforcer for budget
    {
      enforcer: METAMASK_CAVEAT_ENFORCERS.ERC20TransferAmountEnforcer,
      terms: encodeBudgetCaveatTerms(budgetUsdc),
    },
    // Use MetaMask's official TimestampEnforcer for expiry
    {
      enforcer: METAMASK_CAVEAT_ENFORCERS.TimestampEnforcer,
      terms: encodeTimestampCaveatTerms(now, expiresAt),
    },
  ]

  // Add ReputationGatedCaveat if minReputation is set
  // This is the demo-visible caveat — execution blocked if agent rep too low
  if (
    params.minReputation &&
    params.minReputation > 0 &&
    params.reputationRegistry &&
    params.reputationRegistry !== '0x0' &&
    params.agentId !== undefined &&
    params.trustedClients?.length
  ) {
    const repCaveatTerms = encodeReputationGatedTerms({
      reputationRegistry: params.reputationRegistry,
      agentId: params.agentId,
      trustedClients: params.trustedClients,
      tag1: 'successRate',
      minValue: params.minReputation,
      minCount: 1,
    })

    caveats.push({
      enforcer: CAVEAT_ENFORCERS.REPUTATION_GATED,
      terms: repCaveatTerms,
    })

    log.info(
      {
        agentId: params.agentId,
        minReputation: params.minReputation,
        enforcer: CAVEAT_ENFORCERS.REPUTATION_GATED,
      },
      'ReputationGatedCaveat added to delegation'
    )
  }

  // Authority = hash of parent delegation (chains the delegation tree)
  const parentHash = keccak256(
    encodeAbiParameters(
      parseAbiParameters(
        '(address delegate, address delegator, bytes32 authority, (address enforcer, bytes terms)[] caveats, uint256 salt)'
      ),
      [{
        delegate: parentDelegation.delegate,
        delegator: parentDelegation.delegator,
        authority: parentDelegation.authority,
        caveats: parentDelegation.caveats,
        salt: parentDelegation.salt,
      }]
    )
  )

  const delegation: Omit<Delegation, 'signature'> = {
    delegate,
    delegator: parentDelegation.delegate,
    authority: parentHash,
    caveats,
    salt: generateSalt(),
  }

  log.debug(
    { delegate, budgetUsdc: budgetUsdc.toString(), expiresAt, caveatCount: caveats.length },
    'signing sub-delegation'
  )

  const signature = await signDelegation(delegation, chainId)
  const fullDelegation: Delegation = { ...delegation, signature }

  // permissionContext = full chain [subDelegation, parentDelegation]
  const permissionContext = encodePermissionContext([fullDelegation, parentDelegation])

  return {
    delegation: fullDelegation,
    permissionContext,
    budgetUsdc,
    expiresAt,
  }
}

// Build fee transfer + work call transactions for 1Shot bundle
export function buildDelegationBundle(params: {
  permissionContext: Hex
  feeCollector: Address
  feeAmount: bigint
  usdcAddress: Address
  workTarget: Address
  workCalldata: Hex
  workValue?: bigint
}): {
  permissionContext: Hex
  transactions: { to: Address; data: Hex; value: Hex }[]
} {
  const { buildUsdcTransferCalldata } = require('../encoding.js')

  return {
    permissionContext: params.permissionContext,
    transactions: [
      // 1. Fee payment to 1Shot feeCollector
      {
        to: params.usdcAddress,
        data: buildUsdcTransferCalldata(params.feeCollector, params.feeAmount),
        value: '0x0' as Hex,
      },
      // 2. Actual work call
      {
        to: params.workTarget,
        data: params.workCalldata,
        value: params.workValue
          ? (`0x${params.workValue.toString(16)}` as Hex)
          : ('0x0' as Hex),
      },
    ],
  }
}

function extractBudgetFromCaveats(caveats: Caveat[]): bigint | null {
  const budgetCaveat = caveats.find(
    (c) =>
      c.enforcer.toLowerCase() ===
        METAMASK_CAVEAT_ENFORCERS.ERC20TransferAmountEnforcer.toLowerCase() ||
      c.enforcer.toLowerCase() === CAVEAT_ENFORCERS.BUDGET.toLowerCase()
  )
  if (!budgetCaveat) return null
  try {
    return BigInt(budgetCaveat.terms)
  } catch {
    return null
  }
}

export function encodeReputationGatedTerms(params: {
  reputationRegistry: Address
  agentId: number
  trustedClients: Address[]
  tag1: string
  minValue: number
  minCount: number
}): Hex {
  return encodeAbiParameters(
    parseAbiParameters(
      'address reputationRegistry, uint256 agentId, address[] trustedClients, string tag1, int128 minValue, uint64 minCount'
    ),
    [
      params.reputationRegistry,
      BigInt(params.agentId),
      params.trustedClients,
      params.tag1,
      BigInt(params.minValue),
      BigInt(params.minCount),
    ]
  ) as Hex
}
