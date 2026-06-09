/**
 * Monitor Agent — Real-time Price + On-chain Condition Watcher
 *
 * Uses Binance WebSocket for instant price alerts (no polling lag).
 * Uses Alchemy RPC for on-chain events (wallet activity, contract events).
 * Fires full agent pipelines when conditions are met.
 */
import { chatJSON } from '../lib/venice/chat.js'
import { addPriceWatch, getCurrentPrice, toBinancePair } from '../lib/monitor/priceWatcher.js'
import { db } from '../db/client.js'
import { scheduledTasks } from '../db/schema.js'
import { childLogger } from '../lib/logger.js'
import { randomUUID } from 'crypto'
import { z } from 'zod'
import type { SubTaskOutput } from '../types/index.js'

const log = childLogger('agent:monitor')

export interface MonitorInput {
  subject: string
  userAddress: string
  chatId?: string
  sessionId?: string
  permissionsContext?: string
  delegationManager?: string
  onChunk?: (delta: string) => void
}

export interface MonitorOutput extends SubTaskOutput {
  monitorId?: string
  watchType?: string
  condition?: string
  currentPrice?: number
}

const MONITOR_SCHEMA = z.object({
  watchType: z.enum(['price', 'wallet', 'schedule', 'gas']),
  token: z.string().optional(),           // e.g. "ETH", "BTC"
  condition: z.enum(['above', 'below']).optional(),
  threshold: z.number().optional(),       // price threshold
  walletAddress: z.string().optional(),   // for wallet watches
  triggerPrompt: z.string(),              // full task to run when triggered
  summary: z.string(),
  executionParams: z.object({
    action: z.enum(["transfer", "swap", "alert"]),
    token: z.string().optional(),
    sellToken: z.string().optional(),
    amount: z.string().optional(),
    to: z.string().optional(),
  }).optional(),
})

export async function runMonitor(input: MonitorInput): Promise<MonitorOutput> {
  log.info({ subject: input.subject }, 'monitor agent running')

  // Venice parses the natural language request
  const parsed = await chatJSON<z.infer<typeof MONITOR_SCHEMA>>({
    model: 'coordinator',
    messages: [{ role: 'user', content: `Parse this monitoring request: "${input.subject}"` }],
    systemPrompt: `Parse the monitoring request and extract:
- watchType: "price" for token price alerts, "wallet" for address watching, "gas" for gas alerts, "schedule" for time-based
- token: token symbol (ETH, BTC, SOL, etc.) for price watches
- condition: "above" or "below" for price watches
- threshold: the price number (e.g. 1500 for "$1500")
- walletAddress: the 0x address for wallet watches
- triggerPrompt: the full task to run when condition is met (include any swap/transfer/research details)
- executionParams: for swap: {action:"swap", token:"ETH"(BUY), sellToken:"USDC"(SELL), amount:"1"}; for transfer: {action:"transfer", token:"USDC", amount:"0.1", to:"0x..."}; for alert only: {action:"alert"}
- summary: one sentence describing the monitor

Examples:
"Alert me when ETH drops below $1500" → watchType: "price", token: "ETH", condition: "below", threshold: 1500, triggerPrompt: "ETH has dropped below $1500. Run research on market conditions and send me a report."
"When ETH is below $1500 swap $1 USDC to ETH" → watchType: "price", token: "ETH", condition: "below", threshold: 1500, triggerPrompt: "ETH price alert: below $1500. Swap 1 USDC to ETH via executor.", executionParams: {action: "swap", token: "ETH", sellToken: "USDC", amount: "1"}
"Watch wallet 0x1234 for activity" → watchType: "wallet", walletAddress: "0x1234", triggerPrompt: "Wallet 0x1234 has new activity. Research recent transactions and report."`,
    schema: MONITOR_SCHEMA,
    temperature: 0,
  })

  const monitorId = randomUUID()
  const now = Math.floor(Date.now() / 1000)
  let currentPrice: number | undefined

  if (parsed.watchType === 'price' && parsed.token && parsed.condition && parsed.threshold) {
    // Get current price for context
    try {
      currentPrice = await getCurrentPrice(parsed.token)
      log.info({ token: parsed.token, currentPrice, threshold: parsed.threshold }, 'current price fetched')
    } catch { /* non-critical */ }

    // Register Binance WebSocket price watch
    addPriceWatch({
      id: monitorId,
      symbol: parsed.token,
      condition: parsed.condition,
      threshold: parsed.threshold,
      createdAt: now,
      onTrigger: async (price, symbol) => {
        log.info({ price, symbol, monitorId }, '⚡ price trigger firing task pipeline')
        try {
          const { createTask } = await import('../services/taskRunner.js')
          const { getActiveSession } = await import('../lib/delegation/authorize.js')
          const session = await getActiveSession(input.userAddress as any, 8453)
          if (!session?.permissionsContext) {
            log.warn({ monitorId }, 'no active session for monitor trigger — skipping')
            return
          }
          // Make trigger prompt explicit for executor
          const swapAmount = parsed.executionParams?.amount ?? '1'
          const buyToken = parsed.executionParams?.token ?? parsed.token ?? 'ETH'
          const sellToken = parsed.executionParams?.sellToken ?? 'USDC'
          const explicitPrompt = parsed.executionParams?.action === 'swap'
            ? `[MONITOR TRIGGERED] ${parsed.token} price confirmed at $${price.toFixed(2)} by Binance — condition ${parsed.condition} $${parsed.threshold} MET. DO NOT do web search. Use executor agent to run: swap ${swapAmount} ${sellToken} to ${buyToken} on Base via 0x. executionParams: {"action":"swap","token":"${buyToken}","sellToken":"${sellToken}","amount":"${swapAmount}"}`
            : `[MONITOR TRIGGERED] ${parsed.token} price confirmed at $${price.toFixed(2)} by Binance — condition ${parsed.condition} $${parsed.threshold} MET. DO NOT do web search. ${parsed.triggerPrompt}`
          await createTask({
            userMessage: explicitPrompt,
            userAddress: input.userAddress as `0x${string}`,
            sessionId: input.sessionId ?? input.chatId ?? monitorId,
            chatId: input.chatId,
            permissionsContext: session.permissionsContext as `0x${string}`,
            delegationManager: (session.delegationManager ?? '0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3') as `0x${string}`,
            chainId: 8453,
            isAutonomous: true,
            source: 'api' as const,
          })
        } catch (err) {
          log.error({ err, monitorId }, 'monitor trigger task failed')
        }
      },
    })

    const priceContext = currentPrice
      ? ` Current price: $${currentPrice.toFixed(2)} (${currentPrice > parsed.threshold ? 'above' : 'below'} threshold).`
      : ''

    return {
      type: 'monitor',
      content: `🔍 **Price Monitor Active**\n\n**Watching:** ${parsed.token} via Binance real-time feed\n**Condition:** Price ${parsed.condition} $${parsed.threshold}${priceContext}\n**On trigger:** ${parsed.triggerPrompt}\n\nMonitor ID: \`${monitorId}\`\n\n*Using Binance WebSocket — will trigger instantly when condition is met.*`,
      monitorId,
      watchType: 'price',
      condition: `${parsed.token} ${parsed.condition} $${parsed.threshold}`,
      currentPrice,
      metadata: { monitorId, watchType: 'price', token: parsed.token, condition: parsed.condition, threshold: parsed.threshold },
    }
  }

  // Wallet watch — use scheduler with Alchemy RPC polling
  if (parsed.watchType === 'wallet' && parsed.walletAddress) {
    const session = await (await import('../lib/delegation/authorize.js')).getActiveSession(input.userAddress as any, 8453)
    await db.insert(scheduledTasks).values({
      id: monitorId,
      userAddress: input.userAddress,
      sessionId: input.sessionId ?? input.chatId ?? monitorId,
      name: `Watch: ${parsed.walletAddress.slice(0, 8)}...`,
      prompt: `CHECK CONDITION: Has wallet ${parsed.walletAddress} had any new transactions in the last 15 minutes? Check via Alchemy Base RPC. Reply with only YES or NO.\n\nIF CONDITION MET, RUN: ${parsed.triggerPrompt}`,
      schedule: 'every:15:minutes',
      enabled: 1,
      nextRunAt: now + 900,
      permissionsContext: session?.permissionsContext ?? '',
      delegationManager: session?.delegationManager ?? '0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3',
    })

    return {
      type: 'monitor',
      content: `👁 **Wallet Monitor Active**\n\n**Watching:** \`${parsed.walletAddress}\`\n**Check interval:** Every 15 minutes via Alchemy RPC\n**On activity:** ${parsed.triggerPrompt}\n\nMonitor ID: \`${monitorId}\``,
      monitorId,
      watchType: 'wallet',
      condition: `wallet ${parsed.walletAddress} activity`,
      metadata: { monitorId, watchType: 'wallet', walletAddress: parsed.walletAddress },
    }
  }

  // Fallback — generic schedule
  return {
    type: 'monitor',
    content: `⚠️ Could not parse monitoring condition from: "${input.subject}". Try: "Alert me when ETH drops below $1500" or "Watch wallet 0x1234 for activity"`,
    metadata: { error: 'unparseable condition' },
  }
}
