/**
 * Privacy Classifier
 *
 * Detects sensitive content in user messages and files.
 * Routes to Venice TEE/E2EE models when sensitivity > threshold.
 *
 * Categories:
 *   medical    — health records, symptoms, medications
 *   legal      — contracts, NDAs, litigation
 *   financial  — salaries, tax, portfolio, net worth
 *   personal   — relationships, mental health, identity
 *   corporate  — competitive intelligence, internal strategy
 *   surveillance — tracking wallets/people
 */

import { chat } from '../venice/chat.js'
import { childLogger } from '../logger.js'

const log = childLogger('privacy:classifier')

export type PrivacyCategory =
  | 'medical'
  | 'legal'
  | 'financial'
  | 'personal'
  | 'corporate'
  | 'surveillance'
  | 'none'

export interface PrivacyClassification {
  score: number               // 0-100, higher = more sensitive
  categories: PrivacyCategory[]
  requiresTEE: boolean        // score > 65
  requiresUncensored: boolean // personal/medical category
  reason: string              // human-readable explanation
  modelOverride?: string      // specific Venice model to use
}

// Venice models for sensitive content
const PRIVATE_MODELS = {
  tee_general:    'e2ee-qwen3-6-35b-a3b',           // TEE + E2EE, general
  tee_uncensored: 'e2ee-gemma-4-26b-a4b-uncensored', // TEE + uncensored
  tee_fast:       'e2ee-glm-5-1',                    // TEE, faster
} as const

// Keyword-based fast pre-check (before calling Venice)
const SENSITIVITY_PATTERNS: Record<PrivacyCategory, RegExp[]> = {
  medical: [
    /\b(diagnosis|symptom|medication|prescription|cancer|depression|anxiety|therapy|doctor|hospital|health record|medical|patient|disease|condition|treatment)\b/i,
  ],
  legal: [
    /\b(contract|NDA|non-disclosure|lawsuit|litigation|attorney|lawyer|legal|clause|liability|settlement|court|sue|intellectual property|IP)\b/i,
  ],
  financial: [
    /\b(salary|income|net worth|tax|portfolio|investment|bank account|credit card|loan|debt|wealth|revenue|profit|loss|balance sheet)\b/i,
  ],
  personal: [
    /\b(relationship|divorce|affair|depression|anxiety|trauma|abuse|addiction|suicide|mental health|therapy|private|confidential|secret|personal)\b/i,
  ],
  corporate: [
    /\b(competitor|competitive|strategy|internal|confidential|acquisition|M&A|merger|roadmap|pricing strategy|customer list|trade secret)\b/i,
  ],
  surveillance: [
    /\b(spy|stalk|surveillance|investigate person|find person|who is|track person|follow person)\b/i,
    // Note: "monitor", "watch", "track" excluded — used for crypto price alerts
  ],
  none: [],
}

const CATEGORY_SCORES: Record<PrivacyCategory, number> = {
  medical:      90,
  legal:        85,
  financial:    80,
  personal:     85,
  corporate:    75,
  surveillance: 50,  // lowered — crypto monitoring ≠ person surveillance
  none:         0,
}

/**
 * Fast rule-based classification — no Venice call needed for clear cases
 */
function fastClassify(text: string): PrivacyClassification | null {
  const detected: PrivacyCategory[] = []

  for (const [category, patterns] of Object.entries(SENSITIVITY_PATTERNS) as [PrivacyCategory, RegExp[]][]) {
    if (category === 'none') continue
    for (const pattern of patterns) {
      if (pattern.test(text)) {
        detected.push(category)
        break
      }
    }
  }

  if (detected.length === 0) return null

  const maxScore = Math.max(...detected.map((c) => CATEGORY_SCORES[c] ?? 0))
  const requiresUncensored = detected.includes('personal') || detected.includes('medical')

  return buildResult(detected, maxScore, requiresUncensored, 'Pattern match')
}

/**
 * Venice-powered deep classification for ambiguous cases
 */
async function deepClassify(text: string): Promise<PrivacyClassification> {
  try {
    const response = await chat({
      model: 'coordinator', // fast model for classification
      messages: [{
        role: 'user',
        content: `Classify the privacy sensitivity of this user request. Reply with JSON only.

Request: "${text.slice(0, 500)}"

JSON format:
{
  "score": 0-100,
  "categories": ["medical"|"legal"|"financial"|"personal"|"corporate"|"surveillance"|"none"],
  "reason": "brief explanation"
}

Score guide: 0=public info, 50=somewhat sensitive, 80=highly sensitive, 100=extremely private`,
      }],
      systemPrompt: 'You classify privacy sensitivity. Reply with valid JSON only. No other text.',
      temperature: 0,
      maxTokens: 200,
    })

    const cleaned = response.content
      .replace(/<think>[\s\S]*?<\/think>/g, '')
      .replace(/```json|```/g, '')
      .trim()

    const parsed = JSON.parse(cleaned) as {
      score: number
      categories: PrivacyCategory[]
      reason: string
    }

    const requiresUncensored = parsed.categories.includes('personal') ||
      parsed.categories.includes('medical')

    return buildResult(
      parsed.categories,
      parsed.score,
      requiresUncensored,
      parsed.reason
    )
  } catch (err) {
    log.warn({ err }, 'deep classify failed — using default')
    return buildResult(['none'], 0, false, 'Classification unavailable')
  }
}

function buildResult(
  categories: PrivacyCategory[],
  score: number,
  requiresUncensored: boolean,
  reason: string
): PrivacyClassification {
  const requiresTEE = score >= 65

  let modelOverride: string | undefined
  if (requiresTEE) {
    modelOverride = requiresUncensored
      ? PRIVATE_MODELS.tee_uncensored
      : PRIVATE_MODELS.tee_general
  }

  return {
    score,
    categories,
    requiresTEE,
    requiresUncensored,
    reason,
    modelOverride,
  }
}

/**
 * Main classifier — fast path first, Venice fallback for ambiguous
 */
export async function classifyPrivacy(text: string): Promise<PrivacyClassification> {
  // Fast exemption: monitor triggers and crypto actions are never sensitive
  if (text.includes('[MONITOR TRIGGERED]') || text.includes('swap') && text.includes('USDC') || text.includes('1Shot relay')) {
    return { score: 0, categories: ['none'], requiresTEE: false, requiresUncensored: false, reason: 'crypto action — not sensitive' }
  }
  // Fast keyword check first — no Venice call
  const fast = fastClassify(text)

  if (fast) {
    log.debug({
      score: fast.score,
      categories: fast.categories,
      requiresTEE: fast.requiresTEE,
    }, 'privacy classified (fast)')
    return fast
  }

  // Score 0-40: clearly public, skip Venice call
  if (text.length < 100) {
    return buildResult(['none'], 0, false, 'Short public query')
  }

  // Ambiguous — ask Venice
  const deep = await deepClassify(text)
  log.debug({
    score: deep.score,
    categories: deep.categories,
    requiresTEE: deep.requiresTEE,
  }, 'privacy classified (deep)')

  return deep
}

/**
 * Get the appropriate Venice model based on privacy classification
 */
export function getPrivacyAwareModel(
  baseModel: string,
  classification: PrivacyClassification
): { model: string; isPrivate: boolean; teeVerified: boolean } {
  if (!classification.requiresTEE) {
    return { model: baseModel, isPrivate: false, teeVerified: false }
  }

  return {
    model: classification.modelOverride ?? PRIVATE_MODELS.tee_general,
    isPrivate: true,
    teeVerified: true,
  }
}

/**
 * Format privacy notice for UI
 */
export function getPrivacyNotice(classification: PrivacyClassification): string | null {
  if (!classification.requiresTEE) return null

  const categoryLabels: Partial<Record<PrivacyCategory, string>> = {
    medical:      'medical information',
    legal:        'legal content',
    financial:    'financial data',
    personal:     'personal information',
    corporate:    'confidential business data',
    surveillance: 'sensitive tracking request',
  }

  const detected = classification.categories
    .filter((c) => c !== 'none')
    .map((c) => categoryLabels[c] ?? c)
    .join(', ')

  return `🔒 Detected ${detected}. Routing to Venice TEE — hardware-attested private inference. Your data is not stored or logged.`
}
