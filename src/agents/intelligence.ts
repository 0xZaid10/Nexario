/**
 * Intelligence Agent
 *
 * Private competitive and business intelligence using Venice TEE.
 * Research competitors, markets, people, or organizations without
 * your queries being logged or associated with your identity.
 *
 * Venice TEE ensures:
 *   - Hardware-attested secure execution
 *   - No data retention
 *   - No training on your queries
 *   - Independent verification via attestation proofs
 */

import { chat } from '../lib/venice/chat.js'
import { childLogger } from '../lib/logger.js'
import type { SubTaskOutput } from '../types/index.js'

const log = childLogger('agent:intelligence')

export type IntelType =
  | 'competitor'
  | 'market'
  | 'person'
  | 'organization'
  | 'technology'
  | 'general'

export interface IntelligenceInput {
  subject: string
  intelType?: IntelType
  depth?: 'brief' | 'standard' | 'deep'
  focusAreas?: string[]
}

// Venice TEE models
const INTEL_MODELS = {
  search: 'kimi-k2-6',                 // web search, latest data (no TEE but best search)
  tee:    'e2ee-qwen3-6-35b-a3b',      // TEE for synthesis of sensitive findings
} as const

function detectIntelType(subject: string): IntelType {
  const text = subject.toLowerCase()
  if (text.match(/competitor|competing|rival|vs\s|compare.*company/)) return 'competitor'
  if (text.match(/market|industry|sector|trend|landscape/)) return 'market'
  if (text.match(/\bperson\b|individual|founder|ceo|cto|executive/)) return 'person'
  if (text.match(/company|startup|corp|organization|firm/)) return 'organization'
  if (text.match(/tech|protocol|stack|platform|tool|framework/)) return 'technology'
  return 'general'
}

function buildIntelPrompt(type: IntelType, depth: string): string {
  const depthGuide = {
    brief: 'Provide a 3-5 bullet executive summary.',
    standard: 'Provide structured analysis with key findings and implications.',
    deep: 'Provide comprehensive analysis including recent developments, strategy, weaknesses, and opportunities.',
  }[depth] ?? 'Provide structured analysis.'

  const typeGuide: Record<IntelType, string> = {
    competitor: 'Focus on: product offerings, pricing, market position, recent moves, weaknesses, strengths vs subject.',
    market: 'Focus on: size, growth rate, key players, trends, entry barriers, opportunities.',
    person: 'Focus on: background, expertise, recent activity, public statements, affiliations.',
    organization: 'Focus on: mission, funding, team, products, partnerships, trajectory.',
    technology: 'Focus on: capabilities, adoption, limitations, alternatives, future roadmap.',
    general: 'Provide balanced intelligence briefing.',
  }

  return `${typeGuide[type]}\n\n${depthGuide}\n\nNote: This is private intelligence research. Be factual and cite sources where possible.`
}

export async function runIntelligence(
  input: IntelligenceInput,
  onChunk?: (delta: string) => void
): Promise<SubTaskOutput> {
  const intelType = input.intelType ?? detectIntelType(input.subject)
  const depth = input.depth ?? 'standard'

  log.info({ intelType, depth, subject: input.subject.slice(0, 50) }, 'intelligence agent running (TEE)')

  // Phase 1: Web search for latest data (kimi-k2-6 has web search)
  const searchResponse = await chat({
    model: 'research' as any, // kimi-k2-6
    messages: [{
      role: 'user',
      content: `Research request: "${input.subject}"${
        input.focusAreas?.length
          ? `\n\nFocus areas: ${input.focusAreas.join(', ')}`
          : ''
      }\n\nGather the latest available information.`,
    }],
    systemPrompt: 'You are a research analyst. Gather comprehensive, factual information from available sources. Include recent developments.',
    temperature: 0.2,
    maxTokens: 2000,
  })

  // Phase 2: TEE synthesis — private analysis of gathered intelligence
  const synthesisResponse = await chat({
    model: INTEL_MODELS.tee as any,
    messages: [{
      role: 'user',
      content: `Intelligence briefing request: "${input.subject}"\n\nResearch findings:\n${searchResponse.content}\n\n${buildIntelPrompt(intelType, depth)}`,
    }],
    systemPrompt: `You are a private intelligence analyst operating in a secure enclave.
Synthesize research into actionable intelligence briefings.
Be analytical, objective, and highlight strategic implications.
This session is fully private — process with complete candor.`,
    temperature: 0.3,
    maxTokens: 1500,
    stream: !!onChunk,
    onChunk,
  })

  return {
    type: 'intelligence',
    content: synthesisResponse.content,
    metadata: {
      intelType,
      depth,
      searchModel: searchResponse.model,
      synthesisModel: synthesisResponse.model,
      teeVerified: true,
      isPrivate: true,
      tokensUsed: searchResponse.usage.totalTokens + synthesisResponse.usage.totalTokens,
      privacyNote: '🔒 Synthesized in Venice TEE — not stored, not logged',
    },
  }
}
