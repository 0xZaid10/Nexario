import { readFileSync } from 'fs'
import { resolve } from 'path'
import { env } from './env.js'
import type { Address } from 'viem'

export const METAMASK_CONTRACTS = {
  // DelegationManager deployed on mainnet AND Base at same address
  DELEGATION_MANAGER: (env.DELEGATION_MANAGER_ADDRESS as Address) ??
    '0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3' as Address,
  HYBRID_DELEGATOR_IMPL: '0x48dBe696A4D990079e039489bA2053B36E8FFEC4' as Address,
  // Chain IDs where DelegationManager is deployed
  SUPPORTED_CHAIN_IDS: [1, 8453] as const,
} as const

export const NEXARIO_CONTRACTS = {
  AGENT_REGISTRY: (env.AGENT_REGISTRY_ADDRESS ?? '0x0') as Address,
  REPUTATION_REGISTRY: (env.REPUTATION_REGISTRY_ADDRESS ?? '0x0') as Address,
  AUTHORITY_LEASE_REGISTRY: (process.env['AUTHORITY_LEASE_REGISTRY_ADDRESS'] ?? '0x0') as Address,
} as const

export const CAVEAT_ENFORCERS = {
  // Official MetaMask caveat enforcers on Sepolia
  BUDGET: '0xf100b0819427117EcF76Ed94B358B1A5b5C6D2Fc' as Address,
  ACTION_SCOPE: '0x2c21fD0Cb9DC8445CB3fb0DC5E7Bb0Aca01842B5' as Address,
  TIMESTAMP: '0x1046bb45C8d673d4ea75321280DB34899413c069' as Address,
  REPUTATION_GATED: '0x0' as Address, // set after deploy
} as const

export const METAMASK_CAVEAT_ENFORCERS = {
  AllowedCalldataEnforcer: '0xc2b0d624c1c4319760C96503BA27C347F3260f55' as Address,
  AllowedMethodsEnforcer: '0x2c21fD0Cb9DC8445CB3fb0DC5E7Bb0Aca01842B5' as Address,
  AllowedTargetsEnforcer: '0x7F20f61b1f09b08D970938F6fa563634d65c4EeB' as Address,
  ERC20TransferAmountEnforcer: '0xf100b0819427117EcF76Ed94B358B1A5b5C6D2Fc' as Address,
  NativeTokenTransferAmountEnforcer: '0xF71af580b9c3078fbc2BBF16FbB8EEd82b330320' as Address,
  TimestampEnforcer: '0x1046bb45C8d673d4ea75321280DB34899413c069' as Address,
  NonceEnforcer: '0xDE4f2FAC4B3D87A1d9953Ca5FC09FCa7F366254f' as Address,
  LimitedCallsEnforcer: '0x04658B29F6b82ed55274221a06Fc97D318E25416' as Address,
  RedeemerEnforcer: '0xE144b0b2618071B4E56f746313528a669c7E65c5' as Address,
} as const

export const METAMASK_IMPLEMENTATIONS = {
  HybridDeleGatorImpl: '0x48dBe696A4D990079e039489bA2053B36E8FFEC4' as Address,
  MultiSigDeleGatorImpl: '0x56a9EdB16a0105eb5a4C54f4C062e2868844f3A7' as Address,
  EIP7702StatelessDeleGatorImpl: '0x63c0c19a282a1B52b07dD5a65b58948A07DAE32B' as Address,
  SimpleFactory: '0x69Aa2f9fe1572F1B640E1bbc512f5c3a734fc77c' as Address,
} as const

export function loadDeployedAddresses() {
  try {
    const deploymentsPath = resolve(process.cwd(), 'contracts/deployments/base.json')
    const raw = readFileSync(deploymentsPath, 'utf8')
    const addresses = JSON.parse(raw) as Record<string, string>

    if (addresses['AuthorityLeaseRegistry']) {
      ;(NEXARIO_CONTRACTS as Record<string, Address>)['AUTHORITY_LEASE_REGISTRY'] =
        addresses['AuthorityLeaseRegistry'] as Address
    }
    if (addresses['AgentRegistry']) {
      ;(NEXARIO_CONTRACTS as Record<string, Address>)['AGENT_REGISTRY'] =
        addresses['AgentRegistry'] as Address
    }
    if (addresses['ReputationRegistry']) {
      ;(NEXARIO_CONTRACTS as Record<string, Address>)['REPUTATION_REGISTRY'] =
        addresses['ReputationRegistry'] as Address
    }
    if (addresses['BudgetCaveat']) {
      ;(CAVEAT_ENFORCERS as Record<string, Address>)['BUDGET'] =
        addresses['BudgetCaveat'] as Address
    }
    if (addresses['ActionScopeCaveat']) {
      ;(CAVEAT_ENFORCERS as Record<string, Address>)['ACTION_SCOPE'] =
        addresses['ActionScopeCaveat'] as Address
    }
    if (addresses['TimestampCaveat']) {
      ;(CAVEAT_ENFORCERS as Record<string, Address>)['TIMESTAMP'] =
        addresses['TimestampCaveat'] as Address
    }
    if (addresses['ReputationGatedCaveat']) {
      ;(CAVEAT_ENFORCERS as Record<string, Address>)['REPUTATION_GATED'] =
        addresses['ReputationGatedCaveat'] as Address
    }
    if (addresses['DelegationManager']) {
      ;(METAMASK_CONTRACTS as Record<string, Address>)['DELEGATION_MANAGER'] =
        addresses['DelegationManager'] as Address
    }

    console.log('✅ Contract addresses loaded from deployments/base.json')
  } catch {
    console.warn('⚠  contracts/deployments/base.json not found — run deploy:sepolia first')
  }
}

export const DELEGATION_MANAGER_ABI = [
  {
    name: 'redeemDelegations',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_permissionContexts', type: 'bytes[]' },
      { name: '_modes', type: 'bytes32[]' },
      { name: '_executionCallDatas', type: 'bytes[]' },
    ],
    outputs: [],
  },
  {
    name: 'disableDelegation',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: '_delegation',
        type: 'tuple',
        components: [
          { name: 'delegate', type: 'address' },
          { name: 'delegator', type: 'address' },
          { name: 'authority', type: 'bytes32' },
          {
            name: 'caveats',
            type: 'tuple[]',
            components: [
              { name: 'enforcer', type: 'address' },
              { name: 'terms', type: 'bytes' },
            ],
          },
          { name: 'salt', type: 'uint256' },
          { name: 'signature', type: 'bytes' },
        ],
      },
    ],
    outputs: [],
  },
] as const

export const EXECUTION_MODES = {
  SINGLE_DEFAULT:
    '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`,
  BATCH_DEFAULT:
    '0x0100000000000000000000000000000000000000000000000000000000000000' as `0x${string}`,
} as const

export const EIP712_DELEGATION_TYPES = {
  Delegation: [
    { name: 'delegate', type: 'address' },
    { name: 'delegator', type: 'address' },
    { name: 'authority', type: 'bytes32' },
    { name: 'caveats', type: 'Caveat[]' },
    { name: 'salt', type: 'uint256' },
  ],
  Caveat: [
    { name: 'enforcer', type: 'address' },
    { name: 'terms', type: 'bytes' },
  ],
} as const

export const ROOT_AUTHORITY =
  '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`
