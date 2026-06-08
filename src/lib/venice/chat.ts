import { VENICE_ENDPOINTS, VENICE_MODELS } from '../../config/venice.js'
import { veniceRequest, veniceStream } from './client.js'
import type { VeniceAgentModel } from '../../config/venice.js'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatOptions {
  model: VeniceAgentModel
  messages: ChatMessage[]
  systemPrompt?: string
  temperature?: number
  maxTokens?: number
  responseSchema?: object
  enableWebSearch?: boolean
  enableWebScraping?: boolean
  reasoningEffort?: 'low' | 'medium' | 'high'
  stream?: boolean
  onChunk?: (delta: string) => void
}

export interface ChatResponse {
  content: string
  reasoningContent?: string
  usage: { promptTokens: number; completionTokens: number; totalTokens: number }
  model: string
}

export async function chat(options: ChatOptions): Promise<ChatResponse> {
  const modelConfig = VENICE_MODELS[options.model as keyof typeof VENICE_MODELS]
  const modelId = modelConfig && 'id' in modelConfig ? modelConfig.id : options.model

  const messages: ChatMessage[] = []
  if (options.systemPrompt) {
    messages.push({ role: 'system', content: options.systemPrompt })
  }
  messages.push(...options.messages)

  const body: Record<string, unknown> = {
    model: modelId,
    messages,
    max_tokens: options.maxTokens ?? 4096,
    temperature: options.temperature ?? 0.3,
    venice_parameters: {
      include_venice_system_prompt: false,
      strip_thinking_response: true,
      disable_thinking: options.reasoningEffort === 'none' ? true : false,
      ...(options.enableWebSearch && { enable_web_search: 'on' }),  // 'on' not 'auto' — no image fetching
      enable_web_scraping: false,  // never scrape — avoids image charges
    },
  }

  // Don't use json_object mode for thinking models — they return empty content
  const isThinkingModel = modelId.includes('thinking') || modelId.includes('deepseek')
  if (options.responseSchema && !isThinkingModel) {
    body['response_format'] = {
      type: 'json_object',
    }
  }

  if (options.reasoningEffort) {
    body['reasoning'] = { effort: options.reasoningEffort }
  }

  if (options.stream && options.onChunk) {
    const content = await veniceStream(
      VENICE_ENDPOINTS.chat,
      body,
      options.onChunk
    )
    return {
      content,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      model: modelId,
    }
  }

  const res = await veniceRequest<{
    choices: {
      message: { content: string; reasoning_content?: string }
    }[]
    usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
    model: string
  }>(VENICE_ENDPOINTS.chat, { body })

  const choice = res.choices[0]
  if (!choice) throw new Error('No choices in Venice chat response')

  return {
    content: choice.message.content,
    reasoningContent: choice.message.reasoning_content,
    usage: {
      promptTokens: res.usage.prompt_tokens,
      completionTokens: res.usage.completion_tokens,
      totalTokens: res.usage.total_tokens,
    },
    model: res.model,
  }
}

export async function chatJSON<T>(
  options: Omit<ChatOptions, 'responseSchema' | 'stream'> & { schema: object }
): Promise<T> {
  const response = await chat({ ...options, responseSchema: options.schema })
  let cleaned = response.content

  if (!cleaned || cleaned.trim() === '') {
    throw new Error('Venice returned empty response — model may not support JSON mode')
  }

  // Strip <think>...</think> blocks from thinking models
  cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/g, '').trim()

  // Strip markdown code fences
  cleaned = cleaned.replace(/```json\n?|```\n?/g, '').trim()

  // Extract first JSON object/array if surrounded by extra text
  const jsonMatch = cleaned.match(/(\{[\s\S]*\}|\[[\s\S]*\])/)
  if (jsonMatch) cleaned = jsonMatch[0]!

  try {
    return JSON.parse(cleaned) as T
  } catch (err) {
    throw new Error(`Failed to parse Venice JSON response: ${cleaned.slice(0, 200)}`)
  }
}
