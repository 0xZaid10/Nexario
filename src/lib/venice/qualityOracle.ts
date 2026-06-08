/**
 * Venice Quality Oracle
 *
 * After each sub-agent completes its task, this oracle asks Venice to evaluate
 * the output quality on a 0-100 scale. The score is written as a reputation
 * tag with the 1Shot txHash as payment proof.
 *
 * This makes Venice genuinely core to Nexario — Venice doesn't just do the work,
 * it also evaluates the work and writes the trust signal.
 *
 * The user opts into this at delegation signing time via veniceQualityOracle: true.
 */

import { env } from '../../config/env.js'
import { VENICE_BASE_URL, VENICE_MODELS } from '../../config/venice.js'
import { childLogger } from '../logger.js'
import { writeTags } from '../erc8004/reputation.js'
import { deriveTagsFromExecution } from '../erc8004/reputation.js'
import type { DemoAgentName } from '../../types/index.js'

const log = childLogger('venice:quality-oracle')

export interface QualityEvalInput {
  agentName: DemoAgentName
  agentId: number
  taskDescription: string
  agentOutput: string
  executionTimeMs: number
  success: boolean
  spentUsdc: bigint
  oneShotTxHash?: `0x${string}`
  userAddress?: string
}

export interface QualityScore {
  score: number          // 0-100
  reasoning: string
  tags: string[]         // what aspects were evaluated
  veniceModel: string
}

/**
 * Ask Venice to evaluate an agent's output quality.
 * Returns a 0-100 score with reasoning.
 */
export async function evaluateOutputQuality(
  input: QualityEvalInput
): Promise<QualityScore | null> {
  if (!env.VENICE_API_KEY) {
    log.warn('VENICE_API_KEY not set — quality oracle disabled')
    return null
  }

  const prompt = `You are evaluating the quality of an AI agent's output for a specific task.

Task given to agent: ${input.taskDescription}

Agent output:
${input.agentOutput.slice(0, 2000)}${input.agentOutput.length > 2000 ? '\n[truncated...]' : ''}

Execution time: ${input.executionTimeMs}ms
Success: ${input.success}

Score this output on a scale of 0-100 based on:
- Relevance: did the output address the task?
- Completeness: was the response thorough?
- Accuracy: does the information appear correct?
- Efficiency: was the execution time reasonable?

Respond with ONLY a JSON object in this exact format:
{
  "score": <number 0-100>,
  "reasoning": "<one sentence explaining the score>",
  "tags": ["relevance", "completeness", "accuracy", "efficiency"]
}`

  try {
    const res = await fetch(`${VENICE_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.VENICE_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'qwen3-235b',  // fast, cheap, good for evaluation
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 200,
        temperature: 0.1,
        venice_parameters: {
          include_venice_system_prompt: false,
        },
      }),
    })

    if (!res.ok) {
      log.warn({ status: res.status }, 'Venice quality eval failed')
      return null
    }

    const data = await res.json() as any
    const text = data.choices?.[0]?.message?.content ?? ''

    // Parse JSON response
    const cleaned = text.replace(/```json|```/g, '').trim()
    const parsed = JSON.parse(cleaned) as QualityScore
    parsed.veniceModel = data.model ?? 'qwen3-235b'

    log.info(
      { agentName: input.agentName, score: parsed.score, reasoning: parsed.reasoning },
      'Venice quality evaluation complete'
    )

    return parsed
  } catch (err) {
    log.error({ agentName: input.agentName, err }, 'Venice quality evaluation failed')
    return null
  }
}

/**
 * Full oracle flow:
 * 1. Ask Venice to evaluate output quality (0-100 score)
 * 2. Write that score as a reputation tag on-chain
 * 3. Include the 1Shot txHash as payment proof
 *
 * Called by taskRunner after each sub-agent execution when
 * session.veniceQualityOracle = true
 */
export async function runQualityOracle(input: QualityEvalInput): Promise<void> {
  log.info({ agentName: input.agentName }, 'running Venice quality oracle')

  const quality = await evaluateOutputQuality(input)
  if (!quality) return

  // Derive standard execution tags
  const executionTags = deriveTagsFromExecution({
    success: input.success,
    spentUsdc: input.spentUsdc,
    executionTimeMs: input.executionTimeMs,
    veniceTokensUsed: 0,
    veniceModelId: VENICE_MODELS[input.agentName]?.id ?? '',
    teeUsed: false,
    e2eeUsed: false,
    delegationDepth: 1,
    crossChain: false,
    refunded: false,
  })

  // Add Venice quality score as additional tag
  const qualityTag = {
    tag1: 'veniceQuality',
    tag2: input.agentName,
    value: BigInt(Math.round(quality.score)),
    valueDecimals: 0,
  }

  // Override successRate with Venice's quality score instead of binary pass/fail
  const tagsWithQuality = executionTags.map((t) =>
    t.tag1 === 'successRate'
      ? { ...t, value: BigInt(Math.round(quality.score)) }
      : t
  )
  tagsWithQuality.push(qualityTag)

  await writeTags(
    input.agentId,
    tagsWithQuality,
    `oracle-${input.agentName}-${Date.now()}`,
    undefined,
    input.oneShotTxHash,
    undefined
  )

  log.info(
    {
      agentName: input.agentName,
      agentId: input.agentId,
      score: quality.score,
      txHash: input.oneShotTxHash,
    },
    'Venice quality oracle wrote reputation'
  )
}
