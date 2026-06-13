import { ethers } from 'hardhat'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const DEMO_AGENTS = [
  {
    name: 'coordinator',
    description: 'Nexario coordinator agent — task planning, sub-delegation, synthesis',
    capabilities: ['coordinate'],
    endpoint: 'https://nexario.xyz/agents/coordinator',
  },
  {
    name: 'research',
    description: 'Nexario research agent — Venice web search and on-chain data via crypto RPC',
    capabilities: ['research'],
    endpoint: 'https://nexario.xyz/agents/research',
  },
  {
    name: 'audit',
    description: 'Nexario audit agent — deep reasoning and structured risk analysis',
    capabilities: ['audit'],
    endpoint: 'https://nexario.xyz/agents/audit',
  },
  {
    name: 'report',
    description: 'Nexario report agent — visual and audio output generation via Venice',
    capabilities: ['report'],
    endpoint: 'https://nexario.xyz/agents/report',
  },
]

async function main() {
  const [deployer] = await ethers.getSigners()

  const deployments = JSON.parse(
    readFileSync(join(__dirname, '../deployments/sepolia.json'), 'utf8')
  ) as Record<string, string>

  const registry = await ethers.getContractAt(
    'NexarioAgentRegistry',
    deployments['AgentRegistry']!
  )

  console.log('Registering demo agents on ERC-8004 registry...')
  console.log('Registry:', deployments['AgentRegistry'])

  const registeredIds: Record<string, number> = {}

  for (const agent of DEMO_AGENTS) {
    const registration = {
      type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
      name: `nexario-${agent.name}`,
      description: agent.description,
      services: [
        { name: 'A2A', endpoint: `${agent.endpoint}/.well-known/agent-card.json`, version: '0.3.0' },
        { name: 'web', endpoint: agent.endpoint },
      ],
      x402Support: true,
      active: true,
      registrations: [],
      supportedTrust: ['reputation'],
    }

    const agentURI = `data:application/json;base64,${Buffer.from(
      JSON.stringify(registration)
    ).toString('base64')}`

    console.log(`\nRegistering ${agent.name}...`)

    const tx = await registry['register(string)'](agentURI)
    const receipt = await tx.wait()

    // Parse agentId from Transfer event
    const transferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
    const transferLog = receipt?.logs.find(
      (l: { topics: string[] }) => l.topics[0] === transferTopic
    )
    const agentId = transferLog?.topics[3]
      ? parseInt(transferLog.topics[3] as string, 16)
      : 0

    registeredIds[agent.name] = agentId
    console.log(`  agentId: ${agentId}`)
    console.log(`  tx: ${receipt?.hash}`)
  }

  // Update deployments file with agent IDs
  const updated = { ...deployments, demoAgentIds: registeredIds }
  writeFileSync(
    join(__dirname, '../deployments/sepolia.json'),
    JSON.stringify(updated, null, 2)
  )

  console.log('\n✅ Demo agents registered')
  console.log('   Agent IDs:', registeredIds)
  console.log('   Updated deployments/sepolia.json')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
