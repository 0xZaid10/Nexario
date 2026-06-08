import { env } from '../../config/env.js'
import { VENICE_BASE_URL } from '../../config/venice.js'
import { childLogger } from '../logger.js'
import { VeniceError, VeniceBalanceError } from '../errors.js'

const log = childLogger('venice:client')

export interface VeniceRequestOptions {
  method?: 'GET' | 'POST'
  body?: unknown
  useX402?: boolean
  idempotencyKey?: string
}

export async function veniceRequest<T>(
  endpoint: string,
  options: VeniceRequestOptions = {}
): Promise<T> {
  const { method = 'POST', body, useX402 = false, idempotencyKey } = options

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  if (useX402 && env.VENICE_WALLET_PRIVATE_KEY) {
    const { buildSIWXHeader } = await import('./x402.js')
    headers['X-Sign-In-With-X'] = await buildSIWXHeader(endpoint)
  } else {
    headers['Authorization'] = `Bearer ${env.VENICE_API_KEY}`
  }

  if (idempotencyKey) {
    headers['Idempotency-Key'] = idempotencyKey
  }

  const res = await fetch(endpoint, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })

  if (res.status === 402) {
    throw new VeniceError(
      'Venice API requires credits — add credits at https://venice.ai/settings/billing',
      402,
      { hint: 'Fund your Venice account to enable AI inference' }
    )
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new VeniceError(`Venice ${res.status}: ${text}`, res.status)
  }

  return res.json() as Promise<T>
}

export async function veniceStream(
  endpoint: string,
  body: unknown,
  onChunk: (delta: string) => void
): Promise<string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${env.VENICE_API_KEY}`,
  }

  const res = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...(body as object), stream: true }),
  })

  if (!res.ok || !res.body) {
    throw new VeniceError(`Venice stream ${res.status}`, res.status)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let full = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const text = decoder.decode(value)
    for (const line of text.split('\n')) {
      if (!line.startsWith('data: ') || line === 'data: [DONE]') continue
      try {
        const chunk = JSON.parse(line.slice(6)) as {
          choices: { delta: { content?: string; reasoning_content?: string } }[]
        }
        const delta = chunk.choices[0]?.delta?.content ?? ''
        if (delta) { onChunk(delta); full += delta }
      } catch { /* ignore malformed chunks */ }
    }
  }

  return full
}
