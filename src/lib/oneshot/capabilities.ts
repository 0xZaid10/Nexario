import { ONESHOT_RELAYER_URL, ONESHOT_METHODS, ONESHOT_CONFIG } from '../../config/oneshot.js'
import { childLogger } from '../logger.js'
import { OneShotError } from '../errors.js'

const log = childLogger('oneshot:capabilities')

export interface OneShotToken {
  address: `0x${string}`
  symbol: string
  decimals: number
  minFee: string
  chainId: string
}

export interface OneShotCapabilities {
  targetAddress: `0x${string}`
  feeCollector: `0x${string}`
  acceptedTokens: OneShotToken[]
  supportedChains: string[]
  fetchedAt: number
}

// Per-chain cache — multi-user safe, shared read-only data
const capabilitiesCache = new Map<string, OneShotCapabilities>()

export async function getCapabilities(chainId: number): Promise<OneShotCapabilities> {
  const key = String(chainId)
  const cached = capabilitiesCache.get(key)

  if (cached && Date.now() - cached.fetchedAt < ONESHOT_CONFIG.CAPABILITIES_CACHE_TTL_MS) {
    return cached
  }

  log.debug({ chainId }, 'fetching relayer capabilities')

  const response = await fetch(ONESHOT_RELAYER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: ONESHOT_METHODS.GET_CAPABILITIES,
      params: [String(chainId)],
    }),
  })

  if (!response.ok) {
    throw new OneShotError(
      `relayer_getCapabilities HTTP ${response.status}`,
      undefined,
      { chainId }
    )
  }

  const json = await response.json() as {
    result?: Record<string, {
      feeCollector: `0x${string}`
      targetAddress: `0x${string}`
      tokens: { address: `0x${string}`; symbol: string; decimals: string }[]
    }> | OneShotCapabilities
    error?: { message: string }
  }

  // Handle nested format: result["8453"] or flat result
  const rawResult = json.result
  const chainResult = rawResult && typeof rawResult === 'object'
    ? (rawResult as any)[String(chainId)] ?? rawResult
    : null

  if (json.error || !chainResult?.targetAddress || !chainResult?.feeCollector) {
    // Fall back to getFeeData which we know works
    log.warn({ chainId, error: json.error?.message }, 'getCapabilities failed — falling back to getFeeData')

    const feeRes = await fetch(ONESHOT_RELAYER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: ONESHOT_METHODS.GET_FEE_DATA,
        params: {
          chainId: String(chainId),
          token: chainId === 8453
            ? '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'  // Base USDC
            : '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // ETH USDC
        },
      }),
    })

    const feeJson = await feeRes.json() as {
      result?: {
        targetAddress: `0x${string}`
        feeCollector: `0x${string}`
        token: { address: `0x${string}`; symbol: string; decimals: number; minFee: string }
        chainId: string
      }
      error?: { message: string }
    }

    if (feeJson.error || !feeJson.result?.targetAddress) {
      throw new OneShotError('Both getCapabilities and getFeeData failed', undefined, { chainId })
    }

    const capabilities: OneShotCapabilities = {
      targetAddress: feeJson.result.targetAddress,
      feeCollector: feeJson.result.feeCollector,
      acceptedTokens: [{
        address: feeJson.result.token.address,
        symbol: feeJson.result.token.symbol,
        decimals: feeJson.result.token.decimals,
        minFee: feeJson.result.token.minFee,
        chainId: feeJson.result.chainId,
      }],
      supportedChains: [feeJson.result.chainId],
      fetchedAt: Date.now(),
    }

    capabilitiesCache.set(key, capabilities)
    log.info({ chainId, targetAddress: capabilities.targetAddress }, 'capabilities cached via getFeeData fallback')
    return capabilities
  }

  const capabilities: OneShotCapabilities = {
    targetAddress: chainResult.targetAddress,
    feeCollector: chainResult.feeCollector,
    acceptedTokens: (chainResult.tokens ?? chainResult.acceptedTokens ?? []).map((t: any) => ({
      address: t.address,
      symbol: t.symbol,
      decimals: typeof t.decimals === 'string' ? parseInt(t.decimals) : t.decimals,
      minFee: t.minFee ?? '0.01',
      chainId: String(chainId),
    })),
    supportedChains: [String(chainId)],
    fetchedAt: Date.now(),
  }

  capabilitiesCache.set(key, capabilities)
  log.info({ chainId, targetAddress: capabilities.targetAddress }, 'capabilities cached')

  return capabilities
}

export function getPreferredToken(
  capabilities: OneShotCapabilities,
  preferSymbol = 'USDC'
): OneShotToken {
  const preferred = capabilities.acceptedTokens.find(
    (t) => t.symbol === preferSymbol
  )
  if (preferred) return preferred

  const first = capabilities.acceptedTokens[0]
  if (!first) throw new OneShotError('No accepted tokens returned by relayer')
  return first
}

export function clearCapabilitiesCache(chainId?: number): void {
  if (chainId) {
    capabilitiesCache.delete(String(chainId))
  } else {
    capabilitiesCache.clear()
  }
}
