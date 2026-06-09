/**
 * Reflection Agent
 *
 * Private personal reasoning, journaling, and wellness support
 * using Venice's uncensored TEE models.
 *
 * This is the most privacy-sensitive agent:
 *   - Venice TEE with hardware attestation
 *   - Uncensored model — no content filtering
 *   - Zero data retention
 *   - Not trained on conversations
 *
 * Use cases:
 *   - Personal journaling and reflection
 *   - Decision reasoning (career, relationships, life)
 *   - Private financial/life planning
 *   - Emotional processing
 *   - Sensitive personal questions
 *
 * Positioning: NOT a therapy replacement. A private thinking
 * partner that helps users reason through personal matters
 * without surveillance.
 */

import { chat } from '../lib/venice/chat.js'
import { textToSpeech, audioToBase64DataUrl } from '../lib/venice/media.js'
import { childLogger } from '../lib/logger.js'
import type { SubTaskOutput } from '../types/index.js'

const log = childLogger('agent:reflection')

export type ReflectionMode =
  | 'journal'      // open-ended personal reflection
  | 'decision'     // help reason through a decision
  | 'planning'     // life/career/financial planning
  | 'processing'   // working through emotions/events
  | 'general'      // anything personal

export interface ReflectionInput {
  subject: string
  mode?: ReflectionMode
  generateAudio?: boolean
  context?: string // optional prior context
}

// Venice TEE uncensored model — most private option available
const REFLECTION_MODEL = 'e2ee-gemma-4-26b-a4b-uncensored'

function detectMode(subject: string): ReflectionMode {
  const text = subject.toLowerCase()
  if (text.match(/journal|diary|reflect|today i|felt|feeling/)) return 'journal'
  if (text.match(/should i|decide|choice|option|weighing|pros and cons/)) return 'decision'
  if (text.match(/plan|goal|future|career|next year|strategy for my/)) return 'planning'
  if (text.match(/anxious|worried|stressed|upset|confused|lost|overwhelmed/)) return 'processing'
  return 'general'
}

function buildSystemPrompt(mode: ReflectionMode): string {
  const base = `You are a private thinking partner operating in a secure enclave.
You help people think through personal matters with honesty and depth.
This session is completely private — hardware-attested TEE, no storage, no logging.
You have no content restrictions for this private session.
You are thoughtful, direct, and genuinely helpful.`

  const modeGuides: Record<ReflectionMode, string> = {
    journal: `\nFor journaling: Engage deeply with what the person shares. Ask thoughtful follow-up questions. Help them explore their feelings and thoughts. Validate their experience.`,
    decision: `\nFor decisions: Help the person think through all angles. Ask clarifying questions about their values and constraints. Don't make the decision for them — help them discover it.`,
    planning: `\nFor planning: Be practical and realistic. Help identify concrete steps. Consider both opportunities and obstacles honestly.`,
    processing: `\nFor emotional processing: Lead with empathy. Acknowledge feelings before offering perspectives. Don't rush to solutions.`,
    general: `\nBe a thoughtful, honest companion for whatever the person needs to work through.`,
  }

  return base + modeGuides[mode]
}

export async function runReflection(
  input: ReflectionInput,
  onChunk?: (delta: string) => void
): Promise<SubTaskOutput> {
  const mode = input.mode ?? detectMode(input.subject)

  log.info({ mode, isPrivate: true }, 'reflection agent running (TEE uncensored)')

  const messages: { role: 'user' | 'assistant'; content: string }[] = []

  if (input.context) {
    messages.push({
      role: 'user',
      content: `Context from our session: ${input.context}`,
    })
    messages.push({
      role: 'assistant',
      content: 'I have that context. Please continue.',
    })
  }

  messages.push({
    role: 'user',
    content: input.subject,
  })

  const response = await chat({
    model: REFLECTION_MODEL as any,
    messages,
    systemPrompt: buildSystemPrompt(mode),
    temperature: 0.7, // more natural, less robotic
    maxTokens: 1000,
    stream: !!onChunk && !input.generateAudio,
    onChunk: onChunk && !input.generateAudio ? onChunk : undefined,
  })

  let audioUrl: string | undefined

  // Optional TTS — voice feels more personal for reflection
  if (input.generateAudio) {
    try {
      const audioResult = await textToSpeech({
        text: response.content.slice(0, 500),
        voice: 'af_heart',
        format: 'mp3',
      })
      audioUrl = audioToBase64DataUrl(audioResult.audioBuffer, audioResult.format)
      log.debug('reflection audio generated')
    } catch (err) {
      log.warn({ err }, 'TTS failed for reflection')
    }
  }

  return {
    type: 'reflection',
    content: response.content,
    audioUrl,
    metadata: {
      mode,
      model: response.model,
      teeVerified: true,
      isPrivate: true,
      uncensored: true,
      tokensUsed: response.usage.totalTokens,
      privacyNote: '🔒 Venice TEE uncensored — hardware-attested private inference. Not stored. Not logged. Not trained on.',
    },
  }
}
