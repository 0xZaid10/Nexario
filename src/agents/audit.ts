import { chatJSON, chat } from '../lib/venice/chat.js'
import { childLogger } from '../lib/logger.js'
import type { SubTaskOutput } from '../types/index.js'

const log = childLogger('agent:audit')

export interface AuditInput {
  subject: string
  researchData?: string
  auditType: 'token' | 'contract' | 'wallet' | 'protocol' | 'general'
  onChainAddress?: string
}

export interface AuditResult {
  overallScore: number        // 0-100
  riskLevel: 'low' | 'medium' | 'high' | 'critical'
  summary: string
  findings: {
    category: string
    severity: 'info' | 'low' | 'medium' | 'high' | 'critical'
    description: string
    recommendation: string
  }[]
  metrics: Record<string, string | number>
  verdict: string
}

const AUDIT_SCHEMA = {
  type: 'object',
  properties: {
    overallScore: { type: 'number' },
    riskLevel: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
    summary: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          category: { type: 'string' },
          severity: { type: 'string', enum: ['info', 'low', 'medium', 'high', 'critical'] },
          description: { type: 'string' },
          recommendation: { type: 'string' },
        },
        required: ['category', 'severity', 'description', 'recommendation'],
        additionalProperties: false,
      },
    },
    metrics: { type: 'object', additionalProperties: { type: ['string', 'number'] } },
    verdict: { type: 'string' },
  },
  required: ['overallScore', 'riskLevel', 'summary', 'findings', 'metrics', 'verdict'],
  additionalProperties: false,
}

export async function runAudit(
  input: AuditInput,
  onChunk?: (delta: string) => void
): Promise<SubTaskOutput> {
  log.info({ subject: input.subject, auditType: input.auditType }, 'audit agent running')

  const contextSection = input.researchData
    ? `\n\nResearch data:\n${input.researchData}`
    : ''

  const addressSection = input.onChainAddress
    ? `\n\nOn-chain address: ${input.onChainAddress}`
    : ''

  try {
    // Use freeform chat instead of JSON schema — thinking model output is too long
    // and gets truncated mid-JSON. Freeform gives full response then we parse structure.
    const response = await chat({
      model: 'audit',
      messages: [{
        role: 'user',
        content: `Perform a ${input.auditType} audit of: ${input.subject}${addressSection}${contextSection}

Provide a comprehensive structured analysis covering:
1. Risk Score (0-100, where 100 = highest risk)
2. Key Risks (list with severity: low/medium/high/critical)
3. Opportunities
4. Recommendations
5. Overall verdict`,
      }],
      systemPrompt: `You are a professional blockchain and AI audit agent. 
Perform rigorous analysis. Be specific about risks and opportunities.
Score conservatively — most real-world assets have some risk.`,
      reasoningEffort: 'low',
      temperature: 0.1,
      maxTokens: 3000,
      stream: !!onChunk,
      onChunk,
    })

    return {
      type: 'audit',
      content: response.content,
      metadata: {
        auditType: input.auditType,
        model: response.model,
        tokensUsed: response.usage.totalTokens,
      },
    }
  } catch (err) {
    log.error({ err }, 'audit failed')
    throw err
  }
}


function formatAuditReport(result: AuditResult): string {
  const riskEmoji = { low: '🟢', medium: '🟡', high: '🟠', critical: '🔴' }[result.riskLevel]

  const findings = result.findings
    .map((f) => `• [${f.severity.toUpperCase()}] ${f.category}: ${f.description}\n  → ${f.recommendation}`)
    .join('\n')

  const metrics = Object.entries(result.metrics)
    .map(([k, v]) => `  ${k}: ${v}`)
    .join('\n')

  return `${riskEmoji} AUDIT REPORT — Score: ${result.overallScore}/100 (${result.riskLevel.toUpperCase()} RISK)

${result.summary}

KEY FINDINGS:
${findings}

METRICS:
${metrics}

VERDICT: ${result.verdict}`
}
