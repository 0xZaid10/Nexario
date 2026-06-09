import { createPublicClient, http } from 'viem'
import type { Address } from 'viem'
import type { DemoAgent, DemoAgentName } from '../types/index.js'
import { VENICE_MODELS } from '../config/venice.js'
import { db } from '../db/client.js'
import { childLogger } from '../lib/logger.js'
import { REGISTRY_CHAIN } from '../config/chains.js'
import { NEXARIO_CONTRACTS } from '../config/contracts.js'

const log = childLogger('agents:registry')

// All 10 agents registered on-chain with deployer wallet (0x98a738...)
// getAgentWallet() returns deployer for all agentIds 1-10
const DEPLOYER_WALLET = (process.env['DEPLOYER_ADDRESS'] ?? '0x98a738D21A0EFF97Ee2e68508CD921444553fe0e') as Address

export const AGENT_WALLETS: Record<string, Address> = {
  coordinator:  DEPLOYER_WALLET,
  research:     DEPLOYER_WALLET,
  audit:        DEPLOYER_WALLET,
  report:       DEPLOYER_WALLET,
  monitor:      DEPLOYER_WALLET,
  executor:     DEPLOYER_WALLET,
  counsel:      DEPLOYER_WALLET,
  reputation:   DEPLOYER_WALLET,
  intelligence: DEPLOYER_WALLET,
  reflection:   DEPLOYER_WALLET,
}

// Venice model assignments for all agents
const AGENT_MODELS: Record<string, string> = {
  coordinator:  VENICE_MODELS.coordinator.id,
  research:     VENICE_MODELS.research.id,
  audit:        VENICE_MODELS.audit.id,
  report:       VENICE_MODELS.report.id,
  monitor:      'qwen3-5-9b',                    // fast + cheap for polling
  executor:     'qwen3-235b-a22b-instruct-2507', // high precision for tx building
  counsel:      'e2ee-qwen3-6-35b-a3b',          // TEE for private legal
  reputation:   VENICE_MODELS.research.id,       // web search for address lookup
  intelligence: 'e2ee-qwen3-6-35b-a3b',          // TEE for private intel
  reflection:   'e2ee-gemma-4-26b-a4b-uncensored', // TEE uncensored for personal
}

const AGENT_CAPABILITIES: Record<string, string[]> = {
  coordinator:  ['coordinate', 'plan', 'delegate'],
  research:     ['research', 'web-search', 'on-chain-data'],
  audit:        ['audit', 'risk-analysis', 'reasoning'],
  report:       ['report', 'synthesis', 'tts', 'audio'],
  monitor:      ['monitor', 'watch', 'trigger', 'alert'],
  executor:     ['execute', 'transact', 'relay', '1shot'],
  counsel:      ['legal', 'contract', 'deal', 'compliance', 'tee'],
  reputation:   ['reputation', 'identity', 'wallet-scoring', 'trust'],
  intelligence: ['intelligence', 'competitive', 'research', 'tee'],
  reflection:   ['reflection', 'journal', 'personal', 'wellness', 'tee'],
}

// All agents use the deployer private key since all wallets are the deployer
// Individual agent keys are no longer needed
const DEPLOYER_KEY = process.env['PRIVATE_KEY'] ?? ''

const AGENT_PRIVATE_KEYS: Record<string, string> = {
  coordinator:  DEPLOYER_KEY,
  research:     DEPLOYER_KEY,
  audit:        DEPLOYER_KEY,
  report:       DEPLOYER_KEY,
  monitor:      DEPLOYER_KEY,
  executor:     DEPLOYER_KEY,
  counsel:      DEPLOYER_KEY,
  reputation:   DEPLOYER_KEY,
  intelligence: DEPLOYER_KEY,
  reflection:   DEPLOYER_KEY,
}

// All 10 agents
export const DEMO_AGENTS: Record<string, DemoAgent> = Object.fromEntries(
  Object.keys(AGENT_WALLETS).map((name) => [
    name,
    {
      name,
      agentId: 0,
      address: AGENT_WALLETS[name]!,
      wallet: AGENT_WALLETS[name]!,
      privateKey: AGENT_PRIVATE_KEYS[name] ?? '',
      capabilities: AGENT_CAPABILITIES[name] ?? [],
      veniceModel: AGENT_MODELS[name] ?? '',
      isPrivate: ['counsel', 'intelligence', 'reflection'].includes(name),
      teeVerified: ['counsel', 'intelligence', 'reflection'].includes(name),
    }
  ])
)

// Core 4 registered on-chain (typed for backward compat)
export type CoreAgentName = 'coordinator' | 'research' | 'audit' | 'report'
export type ExtendedAgentName = CoreAgentName | 'monitor' | 'executor' | 'counsel' | 'reputation' | 'intelligence' | 'reflection'

const GET_AGENT_WALLET_ABI = [{
  name: 'getAgentWallet',
  type: 'function' as const,
  stateMutability: 'view' as const,
  inputs: [{ name: 'agentId', type: 'uint256' }],
  outputs: [{ name: '', type: 'address' }],
}] as const

const TOTAL_AGENTS_ABI = [{
  name: 'totalAgents',
  type: 'function' as const,
  stateMutability: 'view' as const,
  inputs: [],
  outputs: [{ name: '', type: 'uint256' }],
}] as const

export async function loadDemoAgentsFromDB(): Promise<void> {
  const agents = await db.query.agents.findMany()

  let loaded = 0
  const ordered = ['coordinator','research','audit','report','monitor','executor','counsel','reputation','intelligence','reflection']
  for (const agent of agents) {
    const reg = agent.registration as any
    const regName = (reg?.name ?? '').toLowerCase()
    // Match by name first
    let name = Object.keys(DEMO_AGENTS).find(k => regName.includes(k))
    // Fallback: match by agentId order
    if (!name) name = ordered[agent.agentId - 1]
    if (!name || !DEMO_AGENTS[name]) continue

    DEMO_AGENTS[name] = {
      ...DEMO_AGENTS[name]!,
      agentId: agent.agentId,
      address: agent.wallet as Address,
      wallet: agent.wallet as Address,
      capabilities: (agent.capabilities as string[]) ?? AGENT_CAPABILITIES[name] ?? [],
    }
    loaded++
    log.info({ name, agentId: agent.agentId }, 'agent loaded from DB')
  }

  if (loaded >= 4) return

  if (!NEXARIO_CONTRACTS.AGENT_REGISTRY || NEXARIO_CONTRACTS.AGENT_REGISTRY === '0x0') {
    log.warn('AgentRegistry not deployed — cannot discover agents on-chain')
    return
  }

  log.info('DB incomplete — scanning AgentRegistry on-chain')

  try {
    const client = createPublicClient({
      chain: REGISTRY_CHAIN,
      transport: http(REGISTRY_CHAIN.rpcUrl),
    })

    const totalAgents = await client.readContract({
      address: NEXARIO_CONTRACTS.AGENT_REGISTRY,
      abi: TOTAL_AGENTS_ABI,
      functionName: 'totalAgents',
    })

    for (let id = Number(totalAgents); id >= 1; id--) {
      try {
        const wallet = await client.readContract({
          address: NEXARIO_CONTRACTS.AGENT_REGISTRY,
          abi: GET_AGENT_WALLET_ABI,
          functionName: 'getAgentWallet',
          args: [BigInt(id)],
        })

        const name = findAgentNameByWallet(wallet)
        if (!name) continue

        if (DEMO_AGENTS[name]!.agentId === 0) {
          DEMO_AGENTS[name] = { ...DEMO_AGENTS[name]!, agentId: id }
          log.info({ name, agentId: id }, 'agent discovered on-chain')
        }
      } catch {}
    }
  } catch (err) {
    log.error({ err }, 'on-chain agent discovery failed')
  }
}

function findAgentNameByWallet(wallet: Address): string | null {
  for (const [name, addr] of Object.entries(AGENT_WALLETS)) {
    if (addr.toLowerCase() === wallet.toLowerCase()) return name
  }
  return null
}

export function getAgentAddress(name: string): Address {
  return DEMO_AGENTS[name]?.address ?? '0x0000000000000000000000000000000000000000'
}

export function isDemoAgentsLoaded(): boolean {
  const core = ['coordinator', 'research', 'audit', 'report']
  return core.every((name) => (DEMO_AGENTS[name]?.agentId ?? 0) > 0)
}
