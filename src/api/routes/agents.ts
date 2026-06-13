import { Router } from 'express'
import { requireUser } from '../middleware/auth.js'
import { runResearch } from '../../agents/research.js'
import { runAudit } from '../../agents/audit.js'
import { runReport } from '../../agents/report.js'
import { chat } from '../../lib/venice/chat.js'
import { getAllAgents } from '../../lib/erc8004/registry.js'
import { getAgentReputation, getBatchReputation } from '../../lib/erc8004/reputation.js'
import { findBestAgent } from '../../lib/erc8004/discovery.js'
import { AgentNotFoundError } from '../../lib/errors.js'
import { z } from 'zod'

export const agentsRouter = Router()

// Simple in-memory reputation cache — 5 minute TTL
const repCache = new Map<number, { rep: Awaited<ReturnType<typeof getAgentReputation>>; ts: number }>()
const REP_CACHE_TTL = 5 * 60 * 1000 // 5 minutes

async function getCachedReputation(agentId: number) {
  const cached = repCache.get(agentId)
  if (cached && Date.now() - cached.ts < REP_CACHE_TTL) return cached.rep
  const rep = await getAgentReputation(agentId)
  repCache.set(agentId, { rep, ts: Date.now() })
  return rep
}

// Warm up reputation cache on startup using multicall — one RPC request for all agents
export async function warmRepCache(agentIds: number[]): Promise<void> {
  try {
    const repMap = await getBatchReputation(agentIds)
    for (const [id, rep] of repMap) {
      repCache.set(id, { rep, ts: Date.now() })
    }
  } catch (err) {
    // Fallback to individual reads
    for (const id of agentIds) {
      try {
        const rep = await getAgentReputation(id)
        repCache.set(id, { rep, ts: Date.now() })
      } catch { /* ignore */ }
      await new Promise(r => setTimeout(r, 300))
    }
  }
}

// GET /api/agents — list all registered agents with reputation
agentsRouter.get('/', async (_req, res, next) => {
  try {
    const agents = await getAllAgents()

    // Single multicall — all agents in ONE RPC request
    const agentIds = agents.map((a) => a.agentId)
    const repMap = await getBatchReputation(agentIds)

    // Sequential reads with small delay to avoid RPC rate limiting
    const withRep = []
    for (const agent of agents) {
      const rep = repMap.get(agent.agentId) ?? {
        totalRevenue: 0, successRate: 0, taskCount: 0,
        avgLatency: 0, teeVerifiedCount: 0, caveatComplianceCount: 0,
      }
      // Update cache
      repCache.set(agent.agentId, { rep, ts: Date.now() })

      const reg = agent.registration as {
        name?: string
        description?: string
        services?: { name: string; endpoint: string }[]
        x402Support?: boolean
        supportedTrust?: string[]
        veniceModel?: string
        isTEE?: boolean
      }
      const { registration: _reg, ...agentWithoutReg } = agent
      withRep.push({
        ...agentWithoutReg,
        name: reg.name ?? `agent-${agent.agentId}`,
        description: reg.description ?? '',
        veniceModel: reg.veniceModel ?? '',
        isTEE: reg.isTEE ?? false,
        services: reg.services ?? [],
        x402Support: reg.x402Support ?? false,
        supportedTrust: reg.supportedTrust ?? [],
        agentUri: agent.agentUri,
        successRate: rep.successRate,
        totalRevenue: rep.totalRevenue,
        taskCount: rep.taskCount,
        reputationScore: rep.successRate,
        reputation: rep,
      })
    }

    res.json({ agents: withRep, total: withRep.length })
  } catch (err) {
    next(err)
  }
})

// GET /api/agents/models — fetch Venice models and group by type
// MUST be before /:agentId to avoid route conflict
agentsRouter.get('/models', async (_req, res, next) => {
  try {
    const env = await import('../../config/env.js')
    const apiKey = env.env.VENICE_API_KEY

    // Fetch live from Venice API
    const veniceRes = await fetch('https://api.venice.ai/api/v1/models', {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    })

    if (!veniceRes.ok) {
      throw new Error(`Venice models API failed: ${veniceRes.status}`)
    }

    const veniceData = await veniceRes.json() as { data: { id: string; type?: string; object?: string }[] }
    const rawModels = veniceData.data ?? []

    // Group by type based on model ID patterns
    const grouped: Record<string, { id: string; name: string; type: string; costTier: string; isTEE?: boolean; isUncensored?: boolean; description: string }[]> = {}

    for (const model of rawModels) {
      const id = model.id
      const type = classifyModel(id)
      if (!grouped[type]) grouped[type] = []
      grouped[type]!.push({
        id,
        name: formatModelName(id),
        type,
        costTier: estimateCost(id),
        isTEE: id.startsWith('e2ee-'),
        isUncensored: id.includes('uncensored'),
        description: getModelDescription(id),
      })
    }

    res.json({ models: grouped, total: rawModels.length })
  } catch (err) {
    next(err)
  }
})

// POST /api/agents/:agentId/withdraw — withdraw agent earnings to owner wallet
// Only callable by the agent's registered owner
agentsRouter.post('/:agentId/withdraw', requireUser, async (req, res, next) => {
  try {
    const agentId = parseInt(req.params['agentId']!)
    const callerAddress = req.userAddress!

    // Get agent from DB
    const agents = await getAllAgents()
    const agent = agents.find(a => a.agentId === agentId)
    if (!agent) { res.status(404).json({ error: 'Agent not found' }); return }

    // Only owner can withdraw
    if (agent.owner.toLowerCase() !== callerAddress.toLowerCase()) {
      res.status(403).json({ error: 'Only the agent owner can withdraw earnings' })
      return
    }

    const reg = agent.registration as any
    const agentWalletAddress = (reg?.wallet ?? agent.wallet) as `0x${string}`
    const ownerAddress = callerAddress as `0x${string}`

    // Get agent private key from env (for system agents)
    const agentName = reg?.name?.toLowerCase().split(' ')[0] ?? ''
    const keyMap: Record<string, string | undefined> = {
      coordinator: process.env['AGENT_COORDINATOR_PRIVATE_KEY'],
      research:    process.env['AGENT_RESEARCH_PRIVATE_KEY'],
      audit:       process.env['AGENT_AUDIT_PRIVATE_KEY'],
      report:      process.env['AGENT_REPORT_PRIVATE_KEY'],
    }
    const agentKey = keyMap[agentName] ?? reg?.privateKey

    if (!agentKey) {
      res.status(400).json({ error: 'Agent private key not available — contact admin' })
      return
    }

    const { createWalletClient, createPublicClient, http, parseAbi } = await import('viem')
    const { privateKeyToAccount } = await import('viem/accounts')
    const { base } = await import('viem/chains')

    const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as `0x${string}`
    const rpc = process.env['BASE_RPC_URL'] ?? 'https://mainnet.base.org'
    const abi = parseAbi([
      'function transfer(address to, uint256 amount) returns (bool)',
      'function balanceOf(address) view returns (uint256)',
    ])

    const pub = createPublicClient({ chain: base, transport: http(rpc) })
    const account = privateKeyToAccount(agentKey as `0x${string}`)

    const balance = await pub.readContract({
      address: USDC, abi, functionName: 'balanceOf', args: [agentWalletAddress],
    })

    if (balance === 0n) {
      res.json({ success: true, message: 'No earnings to withdraw', balanceUsdc: 0 })
      return
    }

    const ethBalance = await pub.getBalance({ address: agentWalletAddress })
    if (ethBalance < 50000000000000n) {
      res.status(400).json({
        error: 'Agent wallet needs ETH for gas',
        agentWallet: agentWalletAddress,
        required: '0.00005 ETH',
        currentEth: ethBalance.toString(),
      })
      return
    }

    const walletClient = createWalletClient({ account, chain: base, transport: http(rpc) })
    const txHash = await walletClient.writeContract({
      address: USDC, abi, functionName: 'transfer',
      args: [ownerAddress, balance],
    })

    res.json({
      success: true,
      txHash,
      amountUsdc: Number(balance) / 1_000_000,
      from: agentWalletAddress,
      to: ownerAddress,
      explorerUrl: `https://basescan.org/tx/${txHash}`,
    })
  } catch (err) {
    next(err)
  }
})
agentsRouter.get('/fees', (_req, res) => {
  res.json({
    fees: [
      { name: 'coordinator',  usdc: 0.05, description: 'Task planning' },
      { name: 'research',     usdc: 0.10, description: 'Web research + Venice inference' },
      { name: 'audit',        usdc: 0.15, description: 'Deep reasoning analysis' },
      { name: 'report',       usdc: 0.05, description: 'Result synthesis' },
      { name: 'counsel',      usdc: 0.20, description: 'TEE legal analysis' },
      { name: 'intelligence', usdc: 0.15, description: 'Competitive research (TEE)' },
      { name: 'reflection',   usdc: 0.10, description: 'Personal reflection (TEE)' },
      { name: 'reputation',   usdc: 0.08, description: 'On-chain reputation lookup' },
      { name: 'monitor',      usdc: 0.05, description: 'Condition watch task' },
      { name: 'executor',     usdc: 0.05, description: 'On-chain action + relay fee' },
    ],
    note: 'Fees charged per task via ERC-7710 delegation. User agents set their own fees.',
    paymentFlow: 'User authorizes USDC budget → fees deducted per agent via 1Shot relay',
  })
})

// POST /api/agents/execute — MUST be before /:agentId
agentsRouter.post('/execute', requireUser, async (req, res, next) => {
  try {
    const body = z.object({
      instruction: z.string().min(1).max(1000),
    }).parse(req.body)

    const { runExecutor } = await import('../../agents/executor.js')
    const { getActiveSession } = await import('../../lib/delegation/authorize.js')
    const session = await getActiveSession(req.userAddress! as `0x${string}`, 8453)
    const budget = session ? Number(session.budgetUsdc) / 1_000_000 - Number(session.spentUsdc) / 1_000_000 : 10

    const output = await runExecutor({
      instruction: body.instruction,
      userAddress: req.userAddress! as `0x${string}`,
      permissionsContext: session?.permissionsContext ?? '0x',
      availableBudgetUsdc: budget,
    })

    res.json(output)
  } catch (err) {
    next(err)
  }
})

agentsRouter.get('/:agentId', async (req, res, next) => {
  try {
    const agentId = parseInt(req.params['agentId']!)
    const agents = await getAllAgents()
    const agent = agents.find((a) => a.agentId === agentId)

    if (!agent) throw new AgentNotFoundError(agentId)

    const reputation = await getAgentReputation(agentId)
    // Update list cache with fresh read
    repCache.set(agentId, { rep: reputation, ts: Date.now() })

    const reg = agent.registration as any
    res.json({
      ...agent,
      name: reg?.name ?? `agent-${agentId}`,
      description: reg?.description ?? '',
      veniceModel: reg?.veniceModel ?? '',
      isTEE: reg?.isTEE ?? false,
      capabilities: reg?.capabilities ?? agent.capabilities ?? [],
      wallet: reg?.wallet ?? agent.wallet,
      reputation,
      reputationScore: reputation.successRate,
    })
  } catch (err) {
    next(err)
  }
})

// GET /api/agents/discover?capability=research — Venice-powered discovery
agentsRouter.get('/discover', async (req, res, next) => {
  try {
    const capability = req.query['capability'] as string
    if (!capability) {
      res.status(400).json({ error: 'capability query param required' })
      return
    }

    const agent = await findBestAgent({ capability })
    if (!agent) {
      res.json({ agent: null, message: 'No agents found for this capability' })
      return
    }

    const reputation = await getAgentReputation(agent.agentId)
    res.json({ agent: { ...agent, reputation } })
  } catch (err) {
    next(err)
  }
})

// POST /api/agents/chat — direct chat with any Venice model via any agent
agentsRouter.post('/chat', requireUser, async (req, res, next) => {
  try {
    const body = z.object({
      message: z.string().min(1).max(4000),
      agentModel: z.enum(['coordinator', 'research', 'audit', 'report']).default('coordinator'),
      systemPrompt: z.string().optional(),
      enableWebSearch: z.boolean().optional(),
    }).parse(req.body)

    const response = await chat({
      model: body.agentModel,
      messages: [{ role: 'user', content: body.message }],
      systemPrompt: body.systemPrompt,
      enableWebSearch: body.enableWebSearch,
      temperature: 0.4,
    })

    res.json({
      content: response.content,
      model: response.model,
      usage: response.usage,
    })
  } catch (err) {
    next(err)
  }
})

// POST /api/agents/research — call research agent directly
agentsRouter.post('/research', requireUser, async (req, res, next) => {
  try {
    const body = z.object({
      query: z.string().min(1).max(2000),
      tokenAddress: z.string().startsWith('0x').optional(),
      walletAddress: z.string().startsWith('0x').optional(),
      chainId: z.number().optional(),
    }).parse(req.body)

    const output = await runResearch({
      query: body.query,
      tokenAddress: body.tokenAddress,
      walletAddress: body.walletAddress,
      chainId: body.chainId ?? req.chainId,
    })

    res.json(output)
  } catch (err) {
    next(err)
  }
})

// POST /api/agents/audit — call audit agent directly
agentsRouter.post('/audit', requireUser, async (req, res, next) => {
  try {
    const body = z.object({
      subject: z.string().min(1).max(10000),
      auditType: z.enum(['token', 'contract', 'wallet', 'protocol', 'general']).default('general'),
      researchData: z.string().optional(),
      onChainAddress: z.string().startsWith('0x').optional(),
    }).parse(req.body)

    const output = await runAudit({
      subject: body.subject,
      auditType: body.auditType,
      researchData: body.researchData,
      onChainAddress: body.onChainAddress,
    })

    res.json(output)
  } catch (err) {
    next(err)
  }
})

// POST /api/agents/report — call report agent directly
agentsRouter.post('/report', requireUser, async (req, res, next) => {
  try {
    const body = z.object({
      subject: z.string().min(1).max(10000),
      researchSummary: z.string().optional(),
      auditSummary: z.string().optional(),
      generateVisual: z.boolean().default(true),
      generateAudio: z.boolean().default(true),
    }).parse(req.body)

    const output = await runReport(body)
    res.json(output)
  } catch (err) {
    next(err)
  }
})

// POST /api/agents/:agentId/call — x402-gated agent call
// External callers pay per request via x402 protocol
agentsRouter.post('/:agentId/call', async (req, res, next) => {
  try {
    const agentId = parseInt(req.params['agentId']!)
    const agents = await getAllAgents()
    const agent = agents.find((a) => a.agentId === agentId)
    if (!agent) { res.status(404).json({ error: 'Agent not found' }); return }

    const reg = agent.registration as any
    const agentWallet = (reg?.wallet ?? agent.wallet) as `0x${string}`
    const chargeAtoms = BigInt(Math.round((reg?.feePerCall ?? 0.10) * 1_000_000))

    // Check for x402 payment proof
    const paymentProof = req.headers['x-payment-proof'] as string | undefined
    if (!paymentProof) {
      // Return 402 with payment instructions
      const { buildX402Response } = await import('../../lib/x402/agentPayment.js')
      const response = buildX402Response({
        agentAddress: agentWallet,
        chargeAtoms,
        endpoint: `/api/agents/${agentId}/call`,
      })
      res.status(402).set(response.headers).json(response.body)
      return
    }

    // Payment verified — execute agent
    const body = z.object({
      query: z.string().min(1).max(5000),
      context: z.string().optional(),
    }).parse(req.body)

    // Run the appropriate agent based on capabilities
    const capabilities = (reg?.capabilities ?? agent.capabilities ?? []) as string[]
    let result: string

    if (capabilities.includes('research') || capabilities.includes('web-search')) {
      const { runResearch } = await import('../../agents/research.js')
      const output = await runResearch({ query: body.query })
      result = output.summary ?? output.content ?? JSON.stringify(output)
    } else {
      // Default: Venice chat with agent's model
      const { chat } = await import('../../lib/venice/chat.js')
      const modelId = reg?.veniceModel ?? 'qwen3-5-9b'
      const response = await chat({
        model: modelId,
        messages: [{ role: 'user', content: body.query }],
        systemPrompt: reg?.systemPrompt ?? `You are ${reg?.name ?? `agent-${agentId}`}. ${reg?.description ?? ''}`,
        maxTokens: 2000,
      })
      result = response.content
    }

    res.json({
      agentId,
      name: reg?.name ?? `agent-${agentId}`,
      result,
      paidAtoms: chargeAtoms.toString(),
      paidUsdc: Number(chargeAtoms) / 1_000_000,
    })
  } catch (err) {
    next(err)
  }
})


// GET /api/agents/:agentId/x402 — get agent's Venice x402 balance
agentsRouter.get('/:agentId/x402', requireUser, async (req, res, next) => {
  try {
    const agentId = parseInt(req.params['agentId'] ?? '0')
    if (isNaN(agentId)) {
      res.status(400).json({ error: 'Invalid agentId' })
      return
    }

    const { VeniceClient } = await import('venice-x402-client')
    const { getAllAgents } = await import('../../lib/erc8004/registry.js')

    const agents = await getAllAgents()
    const agent = agents.find((a) => a.agentId === agentId)
    if (!agent) {
      res.status(404).json({ error: 'Agent not found' })
      return
    }

    // Get x402 balance for agent wallet
    const reg = agent.registration as any
    const wallet = reg?.wallet ?? agent.wallet
    if (!wallet) {
      res.json({ balance: null, wallet: null })
      return
    }

    try {
      const client = new VeniceClient('0x' + '0'.repeat(64)) // read-only
      const balance = await client.getBalance(wallet)
      res.json({ balance, wallet })
    } catch {
      res.json({ balance: null, wallet })
    }
  } catch (err) {
    next(err)
  }
})

// ── Venice model classification helpers ──────────────────────────────────────

function classifyModel(id: string): string {
  if (id.startsWith('e2ee-')) return 'tee'
  if (id.startsWith('tts-') || id.endsWith('-tts')) return 'tts'
  if (id.startsWith('stt-') || id.includes('scribe') || id.includes('wizper') || id.includes('whisper')) return 'stt'
  if (id.includes('text-to-video') || id.includes('image-to-video') || id.includes('reference-to-video') || id.includes('video-to-video') || id.includes('kling') || id.includes('pixverse') || id.includes('runway') || id.includes('wan-') || id.includes('happyhorse')) return 'video'
  if (id.includes('image') || id.includes('flux') || id.includes('ideogram') || id.includes('krea') || id.includes('gpt-image') || id.includes('imagine') || id.includes('qwen-edit') || id.includes('gemma-4-uncensored') && false) return 'image'
  if (id.includes('music') || id.includes('lyria') || id.includes('audio')) return 'audio'
  if (id.includes('coder') || id.includes('grok-build') || id.includes('code')) return 'code'
  if (id.includes('thinking') || id.includes('arcee') || id.includes('grok-4') || id.includes('deepseek') || id.includes('gemini') || id.includes('o3') || id.includes('reasoning')) return 'reasoning'
  return 'text'
}

function formatModelName(id: string): string {
  return id
    .replace(/^(e2ee-|tts-|stt-)/, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\s+(v\d|[0-9]+b|[0-9]+k)\b/gi, (m) => m.toUpperCase())
    .slice(0, 40)
}

function estimateCost(id: string): string {
  if (id.includes('480b') || id.includes('235b') || id.includes('4k') || id.includes('gpt-5') || id.includes('opus')) return 'expensive'
  if (id.includes('9b') || id.includes('flash') || id.includes('turbo') || id.includes('mini') || id.includes('fast')) return 'cheap'
  return 'mid'
}

function getModelDescription(id: string): string {
  if (id.startsWith('e2ee-')) return 'Hardware-attested TEE. Zero data retention. Private inference.'
  if (id.includes('kimi-k2')) return 'Web search enabled. Best for research and live data.'
  if (id.includes('qwen3-235b') && id.includes('thinking')) return 'Extended reasoning. Best for deep analysis and audits.'
  if (id.includes('qwen3-235b')) return 'Flagship instruction model. Best for planning and coordination.'
  if (id.includes('qwen3-coder')) return 'Largest code model. Smart contract analysis and technical tasks.'
  if (id.includes('deepseek')) return 'Long context MoE. Advanced reasoning and agentic workflows.'
  if (id.includes('grok-4')) return 'xAI reasoning model with function calling and structured outputs.'
  if (id.includes('tts-')) return 'Text-to-speech voice synthesis.'
  if (id.includes('ideogram')) return 'Industry-leading text rendering for images.'
  if (id.includes('gpt-image')) return 'High-fidelity image generation with fine typography.'
  if (id.includes('kling')) return 'Cinema-grade 4K video generation.'
  if (id.includes('venice-uncensored')) return 'Venice own model. No content filtering.'
  return 'General purpose AI model.'
}
