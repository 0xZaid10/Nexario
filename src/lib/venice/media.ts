import { VENICE_ENDPOINTS, VENICE_MODELS } from '../../config/venice.js'
import { veniceRequest } from './client.js'
import { childLogger } from '../logger.js'
import { VeniceError } from '../errors.js'

const log = childLogger('venice:media')

// ─── Image generation ─────────────────────────────────────────────────────────

export interface ImageOptions {
  prompt: string
  width?: number
  height?: number
  steps?: number
  cfgScale?: number
  seed?: number
  stylePreset?: string
}

export interface ImageResult {
  base64: string
  mimeType: 'image/png'
}

export async function generateImage(options: ImageOptions): Promise<ImageResult> {
  const modelId = VENICE_MODELS.image.id

  const res = await veniceRequest<{
    images: string[]
    id: string
  }>(VENICE_ENDPOINTS.image, {
    body: {
      model: modelId,
      prompt: options.prompt,
      width: options.width ?? 1024,
      height: options.height ?? 768,
      steps: options.steps ?? 20,
      cfg_scale: options.cfgScale ?? 7,
      ...(options.seed !== undefined && { seed: options.seed }),
      ...(options.stylePreset && { style_preset: options.stylePreset }),
    },
  })

  const image = res.images[0]
  if (!image) throw new VeniceError('No image returned from Venice')

  log.debug({ model: modelId }, 'image generated')
  return { base64: image, mimeType: 'image/png' }
}

// ─── Text-to-speech ───────────────────────────────────────────────────────────

export interface TTSOptions {
  text: string
  voice?: string
  speed?: number
  format?: 'mp3' | 'wav' | 'opus'
}

export interface TTSResult {
  audioBuffer: Buffer
  format: string
}

export async function textToSpeech(options: TTSOptions): Promise<TTSResult> {
  const modelId = VENICE_MODELS.tts.id

  const res = await fetch(VENICE_ENDPOINTS.tts, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env['VENICE_API_KEY']}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: modelId,
      input: options.text,
      voice: options.voice ?? 'af_heart',
      response_format: options.format ?? 'mp3',
      speed: options.speed ?? 1.0,
    }),
  })

  if (!res.ok) {
    throw new VeniceError(`TTS failed: ${res.status}`, res.status)
  }

  const arrayBuffer = await res.arrayBuffer()
  const audioBuffer = Buffer.from(arrayBuffer)

  log.debug({ model: modelId, textLength: options.text.length }, 'TTS generated')
  return { audioBuffer, format: options.format ?? 'mp3' }
}

export function audioToBase64DataUrl(buffer: Buffer, format: string): string {
  const mimeType = format === 'mp3' ? 'audio/mpeg' : `audio/${format}`
  return `data:${mimeType};base64,${buffer.toString('base64')}`
}
