import { env } from '../../config/env.js'
import { VENICE_ENDPOINTS, VENICE_CRYPTO_RPC_NETWORKS, chainIdToVeniceNetwork } from '../../config/venice.js'
import { childLogger } from '../logger.js'
import { VeniceError } from '../errors.js'
import type { VeniceNetwork } from '../../config/venice.js'
import { randomBytes } from 'crypto'

const log = childLogger('venice:rpc')

export interface RPCRequest {
  method: string
  params: unknown[]
  id?: number
}

export interface RPCResponse<T = unknown> {
  jsonrpc: '2.0'
  id: number | string
  result?: T
  error?: { code: number; message: string }
}

export async function rpcCall<T = unknown>(
  network: VeniceNetwork,
  method: string,
  params: unknown[],
  idempotencyKey?: string
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${env.VENICE_API_KEY}`,
  }

  if (idempotencyKey) {
    headers['Idempotency-Key'] = idempotencyKey
  }

  const res = await fetch(VENICE_ENDPOINTS.rpc(network), {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
  })

  if (!res.ok) {
    throw new VeniceError(`RPC ${res.status} on ${network}`, res.status)
  }

  const json = await res.json() as RPCResponse<T>

  if (json.error) {
    throw new VeniceError(
      `RPC error ${json.error.code}: ${json.error.message}`,
      undefined,
      { network, method, code: json.error.code }
    )
  }

  return json.result as T
}

export async function rpcBatch<T = unknown>(
  network: VeniceNetwork,
  requests: RPCRequest[]
): Promise<RPCResponse<T>[]> {
  if (requests.length > 100) {
    throw new VeniceError('Batch size exceeds Venice limit of 100')
  }

  const body = requests.map((r, i) => ({
    jsonrpc: '2.0',
    method: r.method,
    params: r.params,
    id: r.id ?? i + 1,
  }))

  const res = await fetch(VENICE_ENDPOINTS.rpc(network), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.VENICE_API_KEY}`,
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    throw new VeniceError(`Batch RPC ${res.status} on ${network}`, res.status)
  }

  return res.json() as Promise<RPCResponse<T>[]>
}

// ─── High-level helpers ───────────────────────────────────────────────────────

export async function getEthBalance(
  address: string,
  network: VeniceNetwork = 'ethereum-sepolia'
): Promise<bigint> {
  const hex = await rpcCall<string>(network, 'eth_getBalance', [address, 'latest'])
  return BigInt(hex)
}

export async function getTokenBalance(
  tokenAddress: string,
  walletAddress: string,
  network: VeniceNetwork = 'ethereum-sepolia'
): Promise<bigint> {
  // ERC-20 balanceOf(address) selector: 0x70a08231
  const data = `0x70a08231${walletAddress.slice(2).padStart(64, '0')}`
  const hex = await rpcCall<string>(network, 'eth_call', [
    { to: tokenAddress, data },
    'latest',
  ])
  return BigInt(hex)
}

export async function getBlockNumber(
  network: VeniceNetwork = 'ethereum-sepolia'
): Promise<number> {
  const hex = await rpcCall<string>(network, 'eth_blockNumber', [])
  return parseInt(hex, 16)
}

export async function getGasPrice(
  network: VeniceNetwork = 'ethereum-sepolia'
): Promise<bigint> {
  const hex = await rpcCall<string>(network, 'eth_gasPrice', [])
  return BigInt(hex)
}

export async function getTransactionReceipt(
  txHash: string,
  network: VeniceNetwork = 'ethereum-sepolia'
): Promise<{ status: string; blockNumber: string; gasUsed: string } | null> {
  return rpcCall(network, 'eth_getTransactionReceipt', [txHash])
}

export async function getTokenMetadata(
  tokenAddress: string,
  network: VeniceNetwork = 'ethereum-mainnet'
): Promise<{ name: string; symbol: string; decimals: number; totalSupply: bigint }> {
  const idempotencyKey = randomBytes(8).toString('hex')

  const [nameRes, symbolRes, decimalsRes, supplyRes] = await rpcBatch<string>(
    network,
    [
      { method: 'eth_call', params: [{ to: tokenAddress, data: '0x06fdde03' }, 'latest'] }, // name()
      { method: 'eth_call', params: [{ to: tokenAddress, data: '0x95d89b41' }, 'latest'] }, // symbol()
      { method: 'eth_call', params: [{ to: tokenAddress, data: '0x313ce567' }, 'latest'] }, // decimals()
      { method: 'eth_call', params: [{ to: tokenAddress, data: '0x18160ddd' }, 'latest'] }, // totalSupply()
    ]
  )

  const decodeString = (hex: string): string => {
    try {
      const bytes = Buffer.from(hex.slice(2), 'hex')
      const offset = parseInt(hex.slice(2, 66), 16)
      const length = parseInt(hex.slice(66, 130), 16)
      return bytes.slice(64 + offset, 64 + offset + length).toString('utf8').replace(/\0/g, '')
    } catch { return 'UNKNOWN' }
  }

  return {
    name: decodeString(nameRes.result ?? '0x'),
    symbol: decodeString(symbolRes.result ?? '0x'),
    decimals: parseInt(decimalsRes.result ?? '0x12', 16),
    totalSupply: BigInt(supplyRes.result ?? '0x0'),
  }
}

export function chainIdToNetwork(chainId: number): VeniceNetwork {
  const network = chainIdToVeniceNetwork(chainId)
  if (!network) throw new VeniceError(`No Venice RPC network for chainId ${chainId}`)
  return network
}
