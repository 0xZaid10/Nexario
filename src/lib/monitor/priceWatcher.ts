/**
 * Binance WebSocket Price Watcher
 * 
 * Subscribes to real-time price feeds for any token pair.
 * Fires callbacks immediately when conditions are met.
 * No polling — event-driven.
 */
import { childLogger } from '../logger.js'
import WebSocket from 'ws'

const log = childLogger('monitor:price-watcher')

export type PriceCondition = 'above' | 'below'

export interface PriceWatch {
  id: string
  symbol: string        // e.g. "ETHUSDT"
  condition: PriceCondition
  threshold: number
  onTrigger: (price: number, symbol: string) => void | Promise<void>
  triggered?: boolean
  createdAt: number
}

// Active WebSocket connections per symbol
const _connections = new Map<string, WebSocket>()
// Active watches per symbol
const _watches = new Map<string, PriceWatch[]>()

/**
 * Map token symbol to Binance pair
 */
export function toBinancePair(token: string): string {
  const t = token.toUpperCase().replace('$', '')
  // Already a pair
  if (t.endsWith('USDT') || t.endsWith('USDC') || t.endsWith('BTC')) return t.toLowerCase()
  // Common tokens
  const pairs: Record<string, string> = {
    ETH: 'ethusdt', BTC: 'btcusdt', SOL: 'solusdt',
    BNB: 'bnbusdt', MATIC: 'maticusdt', ARB: 'arbusdt',
    OP: 'opusdt', AVAX: 'avaxusdt', LINK: 'linkusdt',
    UNI: 'uniusdt', AAVE: 'aaveusdt', MKR: 'mkrusdt',
    SNX: 'snxusdt', CRV: 'crvusdt', COMP: 'compusdt',
  }
  return pairs[t] ?? `${t.toLowerCase()}usdt`
}

/**
 * Subscribe to Binance WebSocket for a symbol
 */
function ensureConnection(binancePair: string): void {
  if (_connections.has(binancePair)) return

  const wsUrl = `wss://stream.binance.com:9443/ws/${binancePair}@trade`
  log.info({ pair: binancePair }, 'opening Binance WS connection')

  const ws = new WebSocket(wsUrl)

  ws.on('message', async (data: Buffer) => {
    try {
      const trade = JSON.parse(data.toString()) as { p: string; s: string }
      const price = parseFloat(trade.p)
      const symbol = trade.s

      const watches = _watches.get(binancePair) ?? []
      for (const watch of watches) {
        if (watch.triggered) continue
        const met = watch.condition === 'above'
          ? price >= watch.threshold
          : price <= watch.threshold

        if (met) {
          watch.triggered = true
          log.info({ symbol, price, condition: watch.condition, threshold: watch.threshold }, '⚡ price condition triggered')
          try {
            await watch.onTrigger(price, symbol)
          } catch (err) {
            log.error({ err, watchId: watch.id }, 'trigger callback failed')
          }
          // Remove watch after trigger
          removeWatch(watch.id, binancePair)
        }
      }
    } catch { /* ignore parse errors */ }
  })

  ws.on('error', (err) => {
    log.warn({ pair: binancePair, err: err.message }, 'Binance WS error — reconnecting in 5s')
    _connections.delete(binancePair)
    setTimeout(() => ensureConnection(binancePair), 5000)
  })

  ws.on('close', () => {
    log.info({ pair: binancePair }, 'Binance WS closed')
    _connections.delete(binancePair)
    // Reconnect if still have watches
    if ((_watches.get(binancePair) ?? []).length > 0) {
      setTimeout(() => ensureConnection(binancePair), 3000)
    }
  })

  _connections.set(binancePair, ws)
}

/**
 * Add a price watch
 */
export function addPriceWatch(watch: PriceWatch): void {
  const pair = toBinancePair(watch.symbol)
  const existing = _watches.get(pair) ?? []
  _watches.set(pair, [...existing, watch])
  ensureConnection(pair)
  log.info({ id: watch.id, symbol: watch.symbol, pair, condition: watch.condition, threshold: watch.threshold }, 'price watch added')
}

/**
 * Remove a watch by ID
 */
export function removeWatch(id: string, pair?: string): void {
  if (pair) {
    const watches = (_watches.get(pair) ?? []).filter(w => w.id !== id)
    _watches.set(pair, watches)
    if (watches.length === 0) {
      _connections.get(pair)?.close()
      _connections.delete(pair)
      _watches.delete(pair)
    }
  } else {
    for (const [p, watches] of _watches.entries()) {
      const filtered = watches.filter(w => w.id !== id)
      _watches.set(p, filtered)
      if (filtered.length === 0) {
        _connections.get(p)?.close()
        _connections.delete(p)
      }
    }
  }
}

/**
 * List all active watches
 */
export function listWatches(): PriceWatch[] {
  return Array.from(_watches.values()).flat()
}

/**
 * Get current price via REST (one-time check)
 */
export async function getCurrentPrice(token: string): Promise<number> {
  const pair = toBinancePair(token).toUpperCase()
  const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${pair}`)
  if (!res.ok) throw new Error(`Binance price fetch failed: ${res.status}`)
  const data = await res.json() as { price: string }
  return parseFloat(data.price)
}
