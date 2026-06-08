import { env } from '../../config/env.js'
import { childLogger } from '../logger.js'
import { VeniceError } from '../errors.js'
import type { AgentWalletName } from '../../agents/wallets.js'

const log = childLogger('venice:agent-client')

export interface AgentChatOptions {
  agentName: AgentWalletName
  model: string
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[]
  systemPrompt?: string
  enableWebSearch?: boolean
  responseSchema?: object
  reasoningEffort?: 'low' | 'medium' | 'high'
  temperature?: number
  maxTokens?: number
  stream?: boolean
  onChunk?: (delta: string) => void
}

export interface AgentChatResponse {
  content: string
  tokensUsed: number
  model: string
  paidViaX402: boolean
  agentAddress?: string
}

// Each agent uses its own Venice x402 wallet for inference
// Falls back to shared API key if x402 wallet has no balance
export async function agentChat(options: AgentChatOptions): Promise<AgentChatResponse> {
  const { getAgentWallet } = await import('../../agents/wallets.js')
  const agentWallet = getAgentWallet(options.agentName)

  // Try x402 wallet first
  try {
    const balance = await agentWallet.veniceClient.getBalance()

    if (balance.canConsume) {
      log.debug(
        { agentName: options.agentName, balance: balance.balanceUsd },
        'using x402 wallet for Venice inference'
      )

      const response = await agentWallet.veniceClient.chat({
        model: options.model,
        messages: options.systemPrompt
          ? [{ role: 'system' as const, content: options.systemPrompt }, ...options.messages]
          : options.messages,
        venice_parameters: {
          include_venice_system_prompt: false,
          ...(options.enableWebSearch && { enable_web_search: 'auto' }),
        },
        ...(options.responseSchema && {
          response_format: {
            type: 'json_schema',
            json_schema: { name: 'response', strict: true, schema: options.responseSchema },
          },
        }),
        ...(options.reasoningEffort && { reasoning: { effort: options.reasoningEffort } }),
        temperature: options.temperature ?? 0.3,
        max_tokens: options.maxTokens ?? 4096,
      })

      return {
        content: response.choices[0]?.message?.content ?? '',
        tokensUsed: response.usage?.total_tokens ?? 0,
        model: response.model,
        paidViaX402: true,
        agentAddress: agentWallet.address,
      }
    }
  } catch (err) {
    log.warn(
      { agentName: options.agentName, err },
      'x402 wallet failed — falling back to API key'
    )
  }

  // Fallback to shared API key
  log.debug(
    { agentName: options.agentName },
    'using API key for Venice inference (x402 balance low)'
  )

  const { chat } = await import('./chat.js')
  const response = await chat({
    model: options.agentName as any,
    messages: options.messages,
    systemPrompt: options.systemPrompt,
    enableWebSearch: options.enableWebSearch,
    responseSchema: options.responseSchema,
    reasoningEffort: options.reasoningEffort,
    temperature: options.temperature,
    maxTokens: options.maxTokens,
    stream: options.stream,
    onChunk: options.onChunk,
  })

  return {
    content: response.content,
    tokensUsed: response.usage.totalTokens,
    model: response.model,
    paidViaX402: false,
  }
}
