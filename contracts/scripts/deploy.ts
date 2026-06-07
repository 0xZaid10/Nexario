import { ethers } from 'hardhat'
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

async function main() {
  const [deployer] = await ethers.getSigners()
  console.log('Deploying with:', deployer.address)
  console.log('Balance:', ethers.formatEther(await ethers.provider.getBalance(deployer.address)), 'ETH')

  const addresses: Record<string, string> = {}

  // 1. AgentRegistry
  console.log('\nDeploying NexarioAgentRegistry...')
  const AgentRegistry = await ethers.getContractFactory('NexarioAgentRegistry')
  const agentRegistry = await AgentRegistry.deploy()
  await agentRegistry.waitForDeployment()
  addresses['AgentRegistry'] = await agentRegistry.getAddress()
  console.log('AgentRegistry:', addresses['AgentRegistry'])

  // 2. ReputationRegistry — pass oracle address so it can bootstrap reputation
  const oracleAddress = process.env['ORACLE_ADDRESS'] ?? deployer.address
  console.log('\nDeploying NexarioReputationRegistry...')
  console.log('Oracle:', oracleAddress)
  const ReputationRegistry = await ethers.getContractFactory('NexarioReputationRegistry')
  const reputationRegistry = await ReputationRegistry.deploy(
    addresses['AgentRegistry'],
    oracleAddress
  )
  await reputationRegistry.waitForDeployment()
  addresses['ReputationRegistry'] = await reputationRegistry.getAddress()
  addresses['Oracle'] = oracleAddress
  console.log('ReputationRegistry:', addresses['ReputationRegistry'])

  // 3. Caveats
  console.log('\nDeploying BudgetCaveat...')
  const BudgetCaveat = await ethers.getContractFactory('BudgetCaveat')
  const budgetCaveat = await BudgetCaveat.deploy()
  await budgetCaveat.waitForDeployment()
  addresses['BudgetCaveat'] = await budgetCaveat.getAddress()
  console.log('BudgetCaveat:', addresses['BudgetCaveat'])

  console.log('\nDeploying TimestampCaveat...')
  const TimestampCaveat = await ethers.getContractFactory('TimestampCaveat')
  const timestampCaveat = await TimestampCaveat.deploy()
  await timestampCaveat.waitForDeployment()
  addresses['TimestampCaveat'] = await timestampCaveat.getAddress()
  console.log('TimestampCaveat:', addresses['TimestampCaveat'])

  console.log('\nDeploying ReputationGatedCaveat...')
  const RepGatedCaveat = await ethers.getContractFactory('ReputationGatedCaveat')
  const repGatedCaveat = await RepGatedCaveat.deploy()
  await repGatedCaveat.waitForDeployment()
  addresses['ReputationGatedCaveat'] = await repGatedCaveat.getAddress()
  console.log('ReputationGatedCaveat:', addresses['ReputationGatedCaveat'])

  console.log('\nDeploying ActionScopeCaveat...')
  const ActionScopeCaveat = await ethers.getContractFactory('ActionScopeCaveat')
  const actionScopeCaveat = await ActionScopeCaveat.deploy()
  await actionScopeCaveat.waitForDeployment()
  addresses['ActionScopeCaveat'] = await actionScopeCaveat.getAddress()
  console.log('ActionScopeCaveat:', addresses['ActionScopeCaveat'])

  // 6. AuthorityLeaseRegistry — the core lease primitive
  console.log('\nDeploying AuthorityLeaseRegistry...')
  const AuthorityLeaseRegistry = await ethers.getContractFactory('AuthorityLeaseRegistry')
  const authorityLeaseRegistry = await AuthorityLeaseRegistry.deploy(addresses['ReputationRegistry'])
  await authorityLeaseRegistry.waitForDeployment()
  addresses['AuthorityLeaseRegistry'] = await authorityLeaseRegistry.getAddress()
  console.log('AuthorityLeaseRegistry:', addresses['AuthorityLeaseRegistry'])

  // MetaMask DelegationManager address on Sepolia
  // From MetaMask Smart Accounts Kit deployment
  addresses['DelegationManager'] = '0x0000000000000000000000000000000000000000'
  console.log('\n⚠  Set DelegationManager address manually in deployments/sepolia.json')

  // Write to deployments
  const deploymentsDir = join(__dirname, '../deployments')
  mkdirSync(deploymentsDir, { recursive: true })

  const output = {
    ...addresses,
    deployer: deployer.address,
    network: 'sepolia',
    chainId: 11155111,
    deployedAt: new Date().toISOString(),
  }

  writeFileSync(
    join(deploymentsDir, 'sepolia.json'),
    JSON.stringify(output, null, 2)
  )

  console.log('\n✅ All contracts deployed')
  console.log('   Addresses written to contracts/deployments/sepolia.json')
  console.log('\n📋 Next steps:')
  console.log('   1. Update AGENT_REGISTRY_ADDRESS in .env')
  console.log('   2. Update REPUTATION_REGISTRY_ADDRESS in .env')
  console.log('   3. Run: npm run register:agents')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
