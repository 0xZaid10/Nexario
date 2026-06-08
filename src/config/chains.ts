import { sepolia, baseSepolia, mainnet, base } from 'viem/chains'
import type { Chain } from 'viem'
import { env } from './env.js'

export const SUPPORTED_CHAINS = {
  sepolia: {
    ...sepolia,
    rpcUrl: env.SEPOLIA_RPC_URL,
    explorerUrl: 'https://sepolia.etherscan.io',
    explorerTxUrl: (hash: string) => `https://sepolia.etherscan.io/tx/${hash}`,
    explorerAddressUrl: (addr: string) =>
      `https://sepolia.etherscan.io/address/${addr}`,
    nativeCurrency: 'ETH',
    usdcAddress: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' as `0x${string}`,
    isTestnet: true,
  },
  baseSepolia: {
    ...baseSepolia,
    rpcUrl: env.BASE_SEPOLIA_RPC_URL ?? 'https://sepolia.base.org',
    explorerUrl: 'https://sepolia.basescan.org',
    explorerTxUrl: (hash: string) =>
      `https://sepolia.basescan.org/tx/${hash}`,
    explorerAddressUrl: (addr: string) =>
      `https://sepolia.basescan.org/address/${addr}`,
    nativeCurrency: 'ETH',
    usdcAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as `0x${string}`,
    isTestnet: true,
  },
  mainnet: {
    ...mainnet,
    rpcUrl: env.MAINNET_RPC_URL ?? 'https://eth.llamarpc.com',
    explorerUrl: 'https://etherscan.io',
    explorerTxUrl: (hash: string) => `https://etherscan.io/tx/${hash}`,
    explorerAddressUrl: (addr: string) =>
      `https://etherscan.io/address/${addr}`,
    nativeCurrency: 'ETH',
    usdcAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as `0x${string}`,
    isTestnet: false,
  },
  base: {
    ...base,
    rpcUrl: 'https://mainnet.base.org',
    explorerUrl: 'https://basescan.org',
    explorerTxUrl: (hash: string) => `https://basescan.org/tx/${hash}`,
    explorerAddressUrl: (addr: string) =>
      `https://basescan.org/address/${addr}`,
    nativeCurrency: 'ETH',
    usdcAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as `0x${string}`,
    isTestnet: false,
  },
} as const

export type SupportedChainName = keyof typeof SUPPORTED_CHAINS

// Our registry contracts live on Sepolia
export const REGISTRY_CHAIN = SUPPORTED_CHAINS.base

// 1Shot relay executes work on Ethereum mainnet
export const TARGET_CHAIN = SUPPORTED_CHAINS.base

// 1Shot fee payment on Base (cheap USDC) — user funds wallet here
export const FEE_CHAIN = SUPPORTED_CHAINS.base

// User only needs Base USDC — backend handles all Sepolia gas
export const USER_CHAIN = SUPPORTED_CHAINS.base
export const USER_USDC = SUPPORTED_CHAINS.base.usdcAddress

export function getChain(chainId: number) {
  const entry = Object.values(SUPPORTED_CHAINS).find(
    (c) => c.id === chainId
  )
  if (!entry) throw new Error(`Unsupported chain ID: ${chainId}`)
  return entry
}

export function getExplorerTxUrl(hash: string, chainId: number): string {
  return getChain(chainId).explorerTxUrl(hash)
}

export function getViemChain(chainId: number): Chain {
  const chains: Chain[] = [sepolia, baseSepolia, mainnet, base]
  const found = chains.find((c) => c.id === chainId)
  if (!found) throw new Error(`No viem chain for ID: ${chainId}`)
  return found
}

export const CHAIN_IDS = {
  SEPOLIA: 11155111,
  BASE_SEPOLIA: 84532,
  MAINNET: 1,
  BASE: 8453,
} as const
