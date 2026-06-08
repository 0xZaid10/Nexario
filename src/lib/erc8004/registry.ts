import { createPublicClient, createWalletClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import type { Address, Hex } from 'viem'
import { env } from '../../config/env.js'
import { NEXARIO_CONTRACTS } from '../../config/contracts.js'
import { REGISTRY_CHAIN, getViemChain } from '../../config/chains.js'
import { db, schema } from '../../db/client.js'
import { childLogger } from '../logger.js'
import { RegistryError } from '../errors.js'
import type { AgentRegistrationFile } from '../../types/index.js'
import { eq, and } from 'drizzle-orm'

const log = childLogger('erc8004:registry')

const REGISTRY_ABI = [
  {
    name: 'register',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'agentURI', type: 'string' }],
    outputs: [{ name: 'agentId', type: 'uint256' }],
  },
  {
    name: 'setAgentWallet',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'newWallet', type: 'address' },
      { name: 'deadline', type: 'uint256' },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    name: 'getAgentWallet',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'setMetadata',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'metadataKey', type: 'string' },
      { name: 'metadataValue', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    name: 'ownerOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
  },
] as const

export async function registerAgent(params: {
  agentURI: string
  registration: AgentRegistrationFile
  chainId?: number
}): Promise<{ agentId: number; txHash: Hex }> {
  const chainId = params.chainId ?? REGISTRY_CHAIN.id
  const chain = getViemChain(chainId)
  const account = privateKeyToAccount(env.PRIVATE_KEY as Hex)

  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(),
  })

  const publicClient = createPublicClient({ chain, transport: http() })

  log.info({ agentURI: params.agentURI }, 'registering agent on ERC-8004')

  const txHash = await walletClient.writeContract({
    address: NEXARIO_CONTRACTS.AGENT_REGISTRY,
    abi: REGISTRY_ABI,
    functionName: 'register',
    args: [params.agentURI],
  })

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })

  // Parse agentId from Transfer event logs (ERC-721 mint)
  const transferTopic =
    '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
  const transferLog = receipt.logs.find((l) => l.topics[0] === transferTopic)
  const agentId = transferLog?.topics[3]
    ? parseInt(transferLog.topics[3], 16)
    : 0

  // Persist to local DB
  await db
    .insert(schema.agents)
    .values({
      agentId,
      owner: account.address,
      wallet: account.address,
      agentUri: params.agentURI,
      registration: params.registration,
      chainId,
      capabilities: params.registration.services.map((s) => s.name),
      isActive: true,
      isDemo: true,
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
        agentUri: params.agentURI,
        registration: params.registration,
      },
    })

  log.info({ agentId, txHash }, 'agent registered')
  return { agentId, txHash }
}

export async function getAgentFromDB(
  agentId: number
): Promise<typeof schema.agents.$inferSelect | null> {
  const agent = await db.query.agents.findFirst({
    where: eq(schema.agents.agentId, agentId),
  })
  return agent ?? null
}

export async function getAllAgents(): Promise<
  typeof schema.agents.$inferSelect[]
> {
  return db.query.agents.findMany({
    where: eq(schema.agents.isActive, true),
  })
}

export async function getAgentsByOwner(ownerAddress: string): Promise<
  typeof schema.agents.$inferSelect[]
> {
  return db.query.agents.findMany({
    where: and(
      eq(schema.agents.isActive, true),
      eq(schema.agents.owner, ownerAddress.toLowerCase())
    ),
  })
}

export async function updateAgentStats(
  agentId: number,
  delta: {
    taskCount?: number
    revenueUsdc?: number
    success?: boolean
  }
): Promise<void> {
  const agent = await getAgentFromDB(agentId)
  if (!agent) return

  const newTaskCount = agent.taskCount + (delta.taskCount ?? 1)
  const newRevenue = agent.totalRevenue + (delta.revenueUsdc ?? 0)

  let newSuccessRate = agent.successRate
  if (delta.success !== undefined) {
    newSuccessRate =
      (agent.successRate * agent.taskCount + (delta.success ? 100 : 0)) /
      newTaskCount
  }

  await db
    .update(schema.agents)
    .set({
      taskCount: newTaskCount,
      totalRevenue: newRevenue,
      successRate: newSuccessRate,
      lastSeen: Math.floor(Date.now() / 1000),
    })
    .where(eq(schema.agents.agentId, agentId))
}
