import { createPublicClient, http, parseAbiItem } from 'viem'
import { NEXARIO_CONTRACTS } from '../../config/contracts.js'
import { REGISTRY_CHAIN } from '../../config/chains.js'
import { db, schema } from '../../db/client.js'
import { childLogger } from '../logger.js'
import type { AgentRegistrationFile } from '../../types/index.js'

const log = childLogger('erc8004:indexer')

const REGISTERED_EVENT = parseAbiItem(
  'event Registered(uint256 indexed agentId, string agentURI, address indexed owner)'
)

const BLOCK_CHUNK_SIZE = 49_000n

let _isRunning = false
let _lastBlock = 0n

export async function startIndexer(): Promise<void> {
  if (_isRunning) return
  _isRunning = true

  log.info('ERC-8004 indexer starting')

  if (!NEXARIO_CONTRACTS.AGENT_REGISTRY || NEXARIO_CONTRACTS.AGENT_REGISTRY === '0x0') {
    log.warn('AgentRegistry not deployed — indexer inactive')
    return
  }

  const client = createPublicClient({
    chain: REGISTRY_CHAIN,
    transport: http(REGISTRY_CHAIN.rpcUrl),
  })

  await syncHistorical(client)
  startPolling(client)

  log.info('ERC-8004 indexer running')
}

async function syncHistorical(
  client: ReturnType<typeof createPublicClient>
): Promise<void> {
  try {
    const currentBlock = await client.getBlockNumber()
    const fromBlock = _lastBlock || currentBlock - 10_000n

    log.info({ fromBlock, toBlock: currentBlock }, 'syncing historical events')

    let chunkStart = fromBlock
    let totalIndexed = 0

    while (chunkStart <= currentBlock) {
      const chunkEnd =
        chunkStart + BLOCK_CHUNK_SIZE < currentBlock
          ? chunkStart + BLOCK_CHUNK_SIZE
          : currentBlock

      const logs = await client.getLogs({
        address: NEXARIO_CONTRACTS.AGENT_REGISTRY,
        event: REGISTERED_EVENT,
        fromBlock: chunkStart,
        toBlock: chunkEnd,
      })

      for (const log_ of logs) {
        if (!log_.args.agentId || !log_.args.agentURI || !log_.args.owner) continue
        await indexAgent(
          Number(log_.args.agentId),
          log_.args.agentURI,
          log_.args.owner,
          Number(log_.blockNumber ?? 0n)
        )
        totalIndexed++
      }

      chunkStart = chunkEnd + 1n
    }

    _lastBlock = currentBlock
    log.info({ count: totalIndexed }, 'historical sync complete')
  } catch (err) {
    log.error({ err }, 'historical sync failed')
  }
}

function startPolling(client: ReturnType<typeof createPublicClient>): void {
  const POLL_INTERVAL_MS = 12_000

  setInterval(async () => {
    try {
      const currentBlock = await client.getBlockNumber()
      if (currentBlock <= _lastBlock) return

      const fromBlock = _lastBlock + 1n
      const toBlock =
        fromBlock + BLOCK_CHUNK_SIZE < currentBlock
          ? fromBlock + BLOCK_CHUNK_SIZE
          : currentBlock

      // Guard against querying beyond head
      if (fromBlock > currentBlock) return

      const logs = await client.getLogs({
        address: NEXARIO_CONTRACTS.AGENT_REGISTRY,
        event: REGISTERED_EVENT,
        fromBlock,
        toBlock,
      })

      for (const log_ of logs) {
        if (!log_.args.agentId || !log_.args.agentURI || !log_.args.owner) continue
        await indexAgent(
          Number(log_.args.agentId),
          log_.args.agentURI,
          log_.args.owner,
          Number(log_.blockNumber ?? 0n)
        )
      }

      _lastBlock = toBlock
    } catch (err) {
      log.error({ err }, 'polling error')
    }
  }, POLL_INTERVAL_MS)
}

async function indexAgent(
  agentId: number,
  agentURI: string,
  owner: `0x${string}`,
  blockNumber: number
): Promise<void> {
  try {
    const registration = await fetchRegistrationFile(agentURI)
    if (!registration) return

    const capabilities = (registration as any).capabilities
      ?? registration.services.map((s: any) => s.name)

    // Use agent's operational wallet from registration if available
    // owner = who registered on-chain (stays as-is)
    // wallet = agent's operational address for receiving payments
    const agentWallet = (registration as any).wallet ?? owner

    await db
      .insert(schema.agents)
      .values({
        agentId,
        owner,
        wallet: agentWallet,
        agentUri: agentURI,
        registration,
        chainId: REGISTRY_CHAIN.id,
        capabilities,
        isActive: (registration as any).active ?? true,
        isDemo: false,
        registeredAt: Math.floor(Date.now() / 1000),
        lastSeen: Math.floor(Date.now() / 1000),
        totalRevenue: 0,
        successRate: 0,
        taskCount: 0,
        reputationScore: 0,
      })
      .onConflictDoUpdate({
        target: schema.agents.agentId,
        set: {
          agentUri: agentURI,
          registration,
          capabilities,
          wallet: agentWallet,
          isActive: (registration as any).active ?? true,
          lastSeen: Math.floor(Date.now() / 1000),
        },
      })

    log.info({ agentId, owner }, 'agent indexed')
  } catch (err) {
    log.error({ agentId, agentURI, err }, 'failed to index agent')
  }
}

async function fetchRegistrationFile(
  agentURI: string
): Promise<AgentRegistrationFile | null> {
  try {
    if (agentURI.startsWith('data:application/json;base64,')) {
      const b64 = agentURI.split(',')[1]
      if (!b64) return null
      return JSON.parse(Buffer.from(b64, 'base64').toString('utf8')) as AgentRegistrationFile
    }

    if (agentURI.startsWith('https://') || agentURI.startsWith('http://')) {
      const res = await fetch(agentURI, { signal: AbortSignal.timeout(5000) })
      if (!res.ok) return null
      return res.json() as Promise<AgentRegistrationFile>
    }

    log.warn({ agentURI }, 'unsupported agentURI scheme')
    return null
  } catch (err) {
    log.error({ agentURI, err }, 'failed to fetch registration file')
    return null
  }
}
