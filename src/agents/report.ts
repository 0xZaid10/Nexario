import { textToSpeech, audioToBase64DataUrl } from '../lib/venice/media.js'
import { chat } from '../lib/venice/chat.js'
import { childLogger } from '../lib/logger.js'
import type { SubTaskOutput } from '../types/index.js'

const log = childLogger('agent:report')

export interface ReportInput {
  subject: string
  researchSummary?: string
  auditSummary?: string
  generateAudio?: boolean
}

export interface ReportOutput {
  narrative: string
  audioDataUrl?: string
}

export async function runReport(
  input: ReportInput,
  onChunk?: (delta: string) => void
): Promise<SubTaskOutput> {
  log.info({ subject: input.subject }, 'report agent running')

  const context = [
    input.researchSummary && `Research: ${input.researchSummary}`,
    input.auditSummary && `Analysis: ${input.auditSummary}`,
  ].filter(Boolean).join('\n\n')

  // Generate narrative report
  const narrative = await chat({
    model: 'report',
    messages: [{
      role: 'user',
      content: `Generate a clear, professional report for: ${input.subject}\n\n${context}`,
    }],
    systemPrompt: 'You generate concise executive-level reports. Lead with the most important findings. Use clear language accessible to non-technical users.',
    temperature: 0.4,
    maxTokens: 1500,
    stream: !!onChunk,
    onChunk,
  }).then((r) => r.content)

  const output: ReportOutput = { narrative }

  // Generate audio summary via TTS
  if (false && input.generateAudio !== false) { // audio now generated post-synthesis in taskRunner
    try {
      const audioResult = await textToSpeech({
        text: buildAudioSummary(narrative),
        voice: 'af_heart',
        format: 'mp3',
      })
      output.audioDataUrl = audioToBase64DataUrl(
        audioResult.audioBuffer,
        audioResult.format
      )
      log.debug('audio summary generated')
    } catch (err) {
      log.warn({ err }, 'TTS failed — continuing without audio')
    }
  }

  return {
    type: 'report',
    content: narrative,
    audioUrl: output.audioDataUrl,
    metadata: {
      hasAudio: !!output.audioDataUrl,
    },
  }
}

function buildAudioSummary(narrative: string): string {
  const sentences = narrative.split(/[.!?]+/).filter(Boolean)
  let summary = ''
  for (const sentence of sentences) {
    if ((summary + sentence).length > 450) break
    summary += sentence.trim() + '. '
  }
  return summary.trim() || narrative.slice(0, 450)
}
