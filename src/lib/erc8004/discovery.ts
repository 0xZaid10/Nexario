import { db, schema } from '../../db/client.js'
import { chat } from '../venice/chat.js'
import { childLogger } from '../logger.js'
import type { AgentCapability, IndexedAgent } from '../../types/index.js'
import { eq, and } from 'drizzle-orm'

const log = childLogger('erc8004:discovery')

export interface DiscoveryQuery {
  capability: AgentCapability | string
  maxResults?: number
  minSuccessRate?: number
  requireTee?: boolean
}

export interface RankedAgent {
  agent: typeof schema.agents.$inferSelect
  score: number
  reasoning: string
}

// Find best agent for a capability using Venice LLM ranking
export async function findBestAgent(
  query: DiscoveryQuery
): Promise<typeof schema.agents.$inferSelect | null> {
  const candidates = await getCandidates(query)

  if (candidates.length === 0) {
    log.warn({ capability: query.capability }, 'no agents found for capability')
    return null
  }

  if (candidates.length === 1) return candidates[0]!

  try {
    const ranked = await rankWithVenice(candidates, query)
    return ranked[0]?.agent ?? candidates[0] ?? null
  } catch (err) {
    log.error({ err }, 'Venice ranking failed — using first candidate')
    return candidates[0] ?? null
  }
}

async function getCandidates(
  query: DiscoveryQuery
): Promise<typeof schema.agents.$inferSelect[]> {
  const all = await db.query.agents.findMany({
    where: eq(schema.agents.isActive, true),
  })

  return all.filter((agent) => {
    const capabilities = agent.capabilities as string[]
    const hasCapability = capabilities.some(
      (c) =>
        c.toLowerCase().includes(query.capability.toLowerCase()) ||
        query.capability.toLowerCase().includes(c.toLowerCase())
    )
    if (!hasCapability) return false

    if (query.minSuccessRate !== undefined && agent.successRate < query.minSuccessRate) {
      return false
    }

    return true
  }).slice(0, 10) // Max 10 candidates to Venice
}

async function rankWithVenice(
  candidates: typeof schema.agents.$inferSelect[],
  query: DiscoveryQuery
): Promise<RankedAgent[]> {
  const agentSummaries = candidates.map((a, i) => {
    const reg = a.registration as { description?: string }
    return `Agent ${i + 1} (id=${a.agentId}):
  - Description: ${reg.description ?? 'No description'}
  - Success rate: ${a.successRate.toFixed(1)}%
  - Total tasks: ${a.taskCount}
  - Revenue earned: $${a.totalRevenue.toFixed(2)}
  - Reputation score: ${a.reputationScore.toFixed(1)}`
  }).join('\n\n')

  const schema_ = {
    type: 'object',
    properties: {
      rankings: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            agentIndex: { type: 'number' },
            score: { type: 'number' },
            reasoning: { type: 'string' },
          },
          required: ['agentIndex', 'score', 'reasoning'],
          additionalProperties: false,
        },
      },
    },
    required: ['rankings'],
    additionalProperties: false,
  }

  const result = await chat({
    model: 'coordinator',
    messages: [{
      role: 'user',
      content: `Rank these agents for the task: "${query.capability}"\n\n${agentSummaries}\n\nReturn rankings from best to worst.`,
    }],
    systemPrompt: 'You are an agent selection system. Rank agents by fitness for the requested capability. Consider success rate, task count, and revenue as trust signals.',
    responseSchema: schema_,
    temperature: 0,
  })

  type RankingResult = { rankings: { agentIndex: number; score: number; reasoning: string }[] }
  const parsed = JSON.parse(result.content) as RankingResult

  return parsed.rankings
    .map((r) => ({
      agent: candidates[r.agentIndex - 1]!,
      score: r.score,
      reasoning: r.reasoning,
    }))
    .filter((r) => r.agent !== undefined)
}

// For the demo — return our 4 pre-registered agents by name
export async function getDemoAgent(
  name: 'coordinator' | 'research' | 'audit' | 'report'
): Promise<typeof schema.agents.$inferSelect | null> {
  const all = await db.query.agents.findMany({
    where: and(
      eq(schema.agents.isDemo, true),
      eq(schema.agents.isActive, true)
    ),
  })

  return all.find((a) => {
    const reg = a.registration as { name?: string }
    return reg.name?.toLowerCase().includes(name)
  }) ?? null
}
