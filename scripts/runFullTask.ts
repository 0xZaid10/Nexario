/**
 * Full task test: runs coordinator → research → audit → report
 * Saves all results to ./task-results/<timestamp>/
 *
 * Run: npx tsx scripts/runFullTask.ts
 */

import { mkdirSync, writeFileSync } from 'fs'
import { resolve } from 'path'

const BASE_URL = 'http://localhost:3000'
const USER_ADDRESS = '0x98a738D21A0EFF97Ee2e68508CD921444553fe0e'
const API_KEY = 'nexario-dev-key-change-in-prod'

const headers = {
  'Content-Type': 'application/json',
  'X-User-Address': USER_ADDRESS,
  'X-API-Key': API_KEY,
}

const TASK_QUERY = 'Analyze the current state of Ethereum: price, gas fees, network activity, and whether now is a good time to transact or deploy a smart contract.'

async function post(path: string, body: object) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  return res.json()
}

async function main() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const outputDir = resolve(process.cwd(), `task-results/${timestamp}`)
  mkdirSync(outputDir, { recursive: true })

  console.log('\n🚀 Nexario Full Task Test')
  console.log(`📁 Results → ${outputDir}`)
  console.log(`❓ Query: "${TASK_QUERY}"\n`)

  // ── Step 1: Research ──────────────────────────────────────────────────────
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('🔍 Step 1: Research Agent (kimi-k2-6)')
  console.log('   Fetching live ETH data + on-chain info...')

  const t1 = Date.now()
  const research = await post('/api/agents/research', {
    query: TASK_QUERY,
    chainId: 1,
  }) as any
  const researchMs = Date.now() - t1

  if (research.error) {
    console.log(`   ❌ Failed: ${research.detail ?? research.error}`)
    process.exit(1)
  }

  // Research returns { type, content, metadata }
  const researchContent = research.content ?? research.text ?? JSON.stringify(research)

  console.log(`   ✅ Done in ${researchMs}ms`)
  console.log(`   Model: ${research.metadata?.model}`)
  console.log(`   Tokens: ${research.metadata?.tokensUsed}`)
  console.log(`   On-chain data: ${JSON.stringify(research.metadata?.onChainDataFetched)}`)
  console.log(`   Preview: ${researchContent.slice(0, 200)}...`)

  writeFileSync(`${outputDir}/1-research.md`, [
    `# Research Results`,
    `**Query:** ${TASK_QUERY}`,
    `**Model:** ${research.metadata?.model}`,
    `**Tokens:** ${research.metadata?.tokensUsed}`,
    `**Time:** ${researchMs}ms`,
    `**On-chain data fetched:** ${JSON.stringify(research.metadata?.onChainDataFetched)}`,
    '',
    researchContent,
  ].join('\n'))

  // ── Step 2: Audit ─────────────────────────────────────────────────────────
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('🔒 Step 2: Audit Agent (qwen3-235b-thinking)')
  console.log('   Deep risk analysis...')

  const t2 = Date.now()
  const audit = await post('/api/agents/audit', {
    subject: `${TASK_QUERY}\n\nResearch findings:\n${researchContent.slice(0, 2000)}`,
    auditType: 'general',
  }) as any
  const auditMs = Date.now() - t2

  if (audit.error) {
    console.log(`   ❌ Failed: ${audit.detail ?? audit.error}`)
  } else {
    const auditContent = audit.content ?? audit.text ?? JSON.stringify(audit)
    console.log(`   ✅ Done in ${auditMs}ms`)
    console.log(`   Preview: ${auditContent.slice(0, 150)}...`)

    writeFileSync(`${outputDir}/2-audit.md`, [
      `# Audit Results`,
      `**Subject:** Market analysis`,
      `**Time:** ${auditMs}ms`,
      '',
      auditContent,
    ].join('\n'))
  }

  // ── Step 3: Report ────────────────────────────────────────────────────────
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('📄 Step 3: Report Agent (kimi-k2-5 + TTS)')
  console.log('   Generating executive summary + audio...')

  const t3 = Date.now()
  const report = await post('/api/agents/report', {
    subject: TASK_QUERY,
    researchSummary: researchContent.slice(0, 1500),
    auditSummary: audit?.content?.slice(0, 1000) ?? audit?.text?.slice(0, 1000),
  }) as any
  const reportMs = Date.now() - t3

  if (report.error) {
    console.log(`   ❌ Failed: ${report.detail ?? report.error}`)
  } else {
    const reportContent = report.content ?? report.text ?? ''
    console.log(`   ✅ Done in ${reportMs}ms`)
    console.log(`   Has audio: ${!!report.audioUrl}`)
    console.log(`   Preview: ${reportContent.slice(0, 150)}...`)

    writeFileSync(`${outputDir}/3-report.md`, [
      `# Executive Report`,
      `**Subject:** ${TASK_QUERY}`,
      `**Time:** ${reportMs}ms`,
      `**Has audio:** ${!!report.audioUrl}`,
      '',
      reportContent,
    ].join('\n'))

    if (report.audioUrl) {
      const base64 = report.audioUrl
        .replace('data:audio/mp3;base64,', '')
        .replace('data:audio/mpeg;base64,', '')
        .replace('data:audio/wav;base64,', '')
      const audioBuffer = Buffer.from(base64, 'base64')
      writeFileSync(`${outputDir}/3-report-audio.mp3`, audioBuffer)
      console.log(`   🔊 Audio saved`)
    }
  }

  // ── Step 4: Coordinator synthesis ────────────────────────────────────────
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('🎯 Step 4: Coordinator synthesis (qwen3-235b)')
  console.log('   Final synthesis of all findings...')

  const t4 = Date.now()
  const synthesis = await post('/api/agents/chat', {
    message: [
      `Original query: ${TASK_QUERY}`,
      '',
      'Research findings:',
      researchContent.slice(0, 1500),
      '',
      'Risk analysis:',
      audit?.content?.slice(0, 800) ?? audit?.text?.slice(0, 800) ?? 'Not available',
      '',
      'Synthesize the above into a final actionable recommendation in 3-5 bullet points.',
    ].join('\n'),
    agentModel: 'coordinator',
  }) as any
  const synthesisMs = Date.now() - t4

  if (synthesis.error) {
    console.log(`   ❌ Failed: ${synthesis.detail ?? synthesis.error}`)
  } else {
    const synthesisContent = synthesis.content ?? synthesis.text ?? ''
    console.log(`   ✅ Done in ${synthesisMs}ms`)
    console.log(`   Model: ${synthesis.model}`)
    console.log(`   Tokens: ${synthesis.usage?.totalTokens}`)

    writeFileSync(`${outputDir}/4-synthesis.md`, [
      `# Final Synthesis`,
      `**Model:** ${synthesis.model}`,
      `**Tokens:** ${synthesis.usage?.totalTokens}`,
      `**Time:** ${synthesisMs}ms`,
      '',
      synthesisContent,
    ].join('\n'))
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  const totalMs = researchMs + auditMs + reportMs + synthesisMs
  const totalTokens = (research.metadata?.tokensUsed ?? 0)
    + (audit?.metadata?.tokensUsed ?? 0)
    + (synthesis.usage?.totalTokens ?? 0)

  const summary = {
    query: TASK_QUERY,
    timestamp: new Date().toISOString(),
    agents: {
      research: { model: research.metadata?.model, tokens: research.metadata?.tokensUsed, ms: researchMs },
      audit: { ms: auditMs },
      report: { ms: reportMs, hasAudio: !!report?.audioUrl },
      coordinator: { model: synthesis.model, tokens: synthesis.usage?.totalTokens, ms: synthesisMs },
    },
    totals: { ms: totalMs, tokens: totalTokens },
    onChainDataFetched: research.metadata?.onChainDataFetched,
  }

  writeFileSync(`${outputDir}/0-summary.json`, JSON.stringify(summary, null, 2))

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('✅ Full task complete\n')
  console.log(`Total time:   ${(totalMs / 1000).toFixed(1)}s`)
  console.log(`Total tokens: ${totalTokens}`)
  console.log(`\nFiles saved:`)
  console.log(`  ${outputDir}/0-summary.json`)
  console.log(`  ${outputDir}/1-research.md`)
  console.log(`  ${outputDir}/2-audit.md`)
  console.log(`  ${outputDir}/3-report.md`)
  if (report?.audioUrl) {
    console.log(`  ${outputDir}/3-report-audio.mp3`)
  }
  console.log(`  ${outputDir}/4-synthesis.md`)
}

main().catch((err) => {
  console.error('Task failed:', err.message)
  process.exit(1)
})
