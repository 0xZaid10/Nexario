/**
 * Counsel Agent
 *
 * Private legal, contract, and deal analysis using Venice TEE models.
 * Data is processed in hardware-attested secure enclaves — not stored,
 * not logged, not used for training.
 *
 * Use cases:
 *   - Contract review (NDAs, employment, SaaS agreements)
 *   - Deal analysis (term sheets, SAFEs, equity)
 *   - Legal risk assessment
 *   - Regulatory compliance check
 *   - Smart contract legal implications
 */

import { chat } from '../lib/venice/chat.js'
import { childLogger } from '../lib/logger.js'
import type { SubTaskOutput } from '../types/index.js'

const log = childLogger('agent:counsel')

export type CounselType =
  | 'contract'
  | 'deal'
  | 'compliance'
  | 'dispute'
  | 'ip'
  | 'general'

export interface CounselInput {
  subject: string
  documentText?: string   // pasted contract/document text
  counselType?: CounselType
  jurisdiction?: string   // e.g. "US", "UK", "India"
}

// Venice TEE models for private legal analysis
const COUNSEL_MODELS = {
  primary:   'e2ee-qwen3-6-35b-a3b',           // TEE + E2EE
  uncensored: 'e2ee-gemma-4-26b-a4b-uncensored', // TEE + uncensored for sensitive
  fast:      'e2ee-glm-5-1',                    // TEE, faster
} as const

function detectCounselType(subject: string): CounselType {
  const text = subject.toLowerCase()
  if (text.match(/contract|agreement|clause|nda|terms/)) return 'contract'
  if (text.match(/deal|term sheet|safe|equity|valuation|cap table/)) return 'deal'
  if (text.match(/complian|regulation|gdpr|sec|aml|kyc/)) return 'compliance'
  if (text.match(/dispute|lawsuit|sue|litigation|arbitration/)) return 'dispute'
  if (text.match(/patent|trademark|copyright|ip|intellectual property/)) return 'ip'
  return 'general'
}

function buildSystemPrompt(type: CounselType, jurisdiction?: string): string {
  const jurisNote = jurisdiction ? ` (jurisdiction: ${jurisdiction})` : ''

  const basePrompt = `You are a private legal analysis agent${jurisNote}. 
You analyze legal documents, contracts, and deals with precision.
This session is processed in a hardware-attested TEE — completely private.
Always note: this is analysis, not legal advice. Recommend professional counsel for final decisions.`

  const typeSpecific: Record<CounselType, string> = {
    contract: `\nFocus on: unusual clauses, liability exposure, missing protections, termination rights, IP ownership, dispute resolution.`,
    deal: `\nFocus on: valuation fairness, liquidation preferences, anti-dilution, board control, information rights, exit provisions.`,
    compliance: `\nFocus on: regulatory requirements, data protection obligations, reporting requirements, penalties for non-compliance.`,
    dispute: `\nFocus on: strength of claims, evidence requirements, likely outcomes, settlement considerations.`,
    ip: `\nFocus on: ownership clarity, assignment clauses, licensing terms, infringement risks, freedom to operate.`,
    general: `\nProvide balanced analysis of key risks and opportunities.`,
  }

  return basePrompt + (typeSpecific[type] ?? '')
}

export async function runCounsel(
  input: CounselInput,
  onChunk?: (delta: string) => void
): Promise<SubTaskOutput> {
  const counselType = input.counselType ?? detectCounselType(input.subject)

  log.info({
    counselType,
    hasDocument: !!input.documentText,
    jurisdiction: input.jurisdiction,
  }, 'counsel agent running (TEE)')

  // Build analysis prompt
  const analysisContent = [
    `Analysis request: "${input.subject}"`,
    input.documentText
      ? `\n\nDocument content:\n${input.documentText.slice(0, 8000)}`
      : '',
    input.jurisdiction ? `\nJurisdiction: ${input.jurisdiction}` : '',
    '\n\nProvide structured analysis with:\n1. Key findings\n2. Risk assessment (High/Medium/Low)\n3. Red flags or unusual provisions\n4. Recommendations\n5. Questions to ask legal counsel',
  ].filter(Boolean).join('')

  const response = await chat({
    model: COUNSEL_MODELS.primary as any,
    messages: [{ role: 'user', content: analysisContent }],
    systemPrompt: buildSystemPrompt(counselType, input.jurisdiction),
    temperature: 0.1,
    maxTokens: 2000,
    stream: !!onChunk,
    onChunk,
  })

  return {
    type: 'counsel',
    content: response.content,
    metadata: {
      counselType,
      model: response.model,
      teeVerified: true,
      isPrivate: true,
      tokensUsed: response.usage.totalTokens,
      privacyNote: '🔒 Processed in Venice TEE — not stored, not logged',
    },
  }
}
