import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Encoding tests ───────────────────────────────────────────────────────────

describe('encoding', () => {
  let enc: typeof import('../lib/encoding.js')

  beforeEach(async () => {
    enc = await import('../lib/encoding.js')
  })

  describe('usdcToAtoms / atomsToUsdc', () => {
    it('converts 1 USDC to 1_000_000 atoms', () => {
      expect(enc.usdcToAtoms(1)).toBe(1_000_000n)
    })

    it('converts 0.05 USDC correctly', () => {
      expect(enc.usdcToAtoms(0.05)).toBe(50_000n)
    })

    it('round-trips correctly', () => {
      const atoms = enc.usdcToAtoms(9.99)
      expect(enc.atomsToUsdc(atoms)).toBeCloseTo(9.99, 4)
    })
  })

  describe('buildUsdcTransferCalldata', () => {
    it('starts with ERC-20 transfer selector', () => {
      const calldata = enc.buildUsdcTransferCalldata(
        '0x1234567890123456789012345678901234567890',
        1_000_000n
      )
      expect(calldata.startsWith('0xa9059cbb')).toBe(true)
    })

    it('produces correct length (4 + 32 + 32 = 68 bytes = 138 hex chars + 0x)', () => {
      const calldata = enc.buildUsdcTransferCalldata(
        '0x1234567890123456789012345678901234567890',
        1_000_000n
      )
      expect(calldata.length).toBe(138) // 0x + 136 hex chars
    })
  })

  describe('encodeBudgetCaveatTerms', () => {
    it('encodes uint256 correctly', () => {
      const terms = enc.encodeBudgetCaveatTerms(5_000_000n)
      expect(terms).toMatch(/^0x/)
      expect(terms.length).toBe(66) // 0x + 64 hex chars
    })
  })

  describe('encodeTimestampCaveatTerms', () => {
    it('encodes validAfter and validUntil', () => {
      const terms = enc.encodeTimestampCaveatTerms(1000, 2000)
      expect(terms).toMatch(/^0x/)
    })
  })
})

// ─── Salt + ID generation tests ───────────────────────────────────────────────

describe('signature utils', () => {
  let sig: typeof import('../lib/signature.js')

  beforeEach(async () => {
    sig = await import('../lib/signature.js')
  })

  describe('generateSalt', () => {
    it('returns a bigint', () => {
      expect(typeof sig.generateSalt()).toBe('bigint')
    })

    it('generates unique salts', () => {
      const salts = new Set(Array.from({ length: 100 }, () => sig.generateSalt().toString()))
      expect(salts.size).toBe(100)
    })

    it('never returns zero', () => {
      for (let i = 0; i < 50; i++) {
        expect(sig.generateSalt()).not.toBe(0n)
      }
    })
  })

  describe('generateTaskId', () => {
    it('returns UUID-like format', () => {
      const id = sig.generateTaskId()
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    })

    it('generates unique IDs', () => {
      const ids = new Set(Array.from({ length: 100 }, () => sig.generateTaskId()))
      expect(ids.size).toBe(100)
    })
  })

  describe('generateStepId', () => {
    it('returns step_ prefixed ID', () => {
      expect(sig.generateStepId().startsWith('step_')).toBe(true)
    })
  })
})

// ─── 1Shot capabilities tests ─────────────────────────────────────────────────

describe('oneshot/capabilities', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('parses capabilities response correctly', async () => {
    const mockResponse = {
      targetAddress: '0x1234567890123456789012345678901234567890',
      feeCollector: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
      acceptedTokens: [
        { address: '0xUSDC', symbol: 'USDC', decimals: 6, minFee: '100000', chainId: '11155111' },
      ],
      supportedChains: ['11155111'],
    }

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: mockResponse }),
    }) as any

    const { getCapabilities, clearCapabilitiesCache } = await import('../lib/oneshot/capabilities.js')
    clearCapabilitiesCache(11155111)

    const caps = await getCapabilities(11155111)
    expect(caps.targetAddress).toBe(mockResponse.targetAddress)
    expect(caps.feeCollector).toBe(mockResponse.feeCollector)
    expect(caps.acceptedTokens).toHaveLength(1)
  })

  it('caches capabilities and skips refetch within TTL', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        result: {
          targetAddress: '0x1234567890123456789012345678901234567890',
          feeCollector: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
          acceptedTokens: [{ address: '0xUSDC', symbol: 'USDC', decimals: 6, minFee: '100000', chainId: '1' }],
          supportedChains: ['1'],
          fetchedAt: Date.now(),
        },
      }),
    })
    global.fetch = mockFetch as any

    const { getCapabilities, clearCapabilitiesCache } = await import('../lib/oneshot/capabilities.js')
    clearCapabilitiesCache(1)

    await getCapabilities(1)
    await getCapabilities(1) // Should use cache

    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('throws OneShotError on missing targetAddress', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: { acceptedTokens: [] } }),
    }) as any

    const { getCapabilities, clearCapabilitiesCache } = await import('../lib/oneshot/capabilities.js')
    clearCapabilitiesCache(99)

    await expect(getCapabilities(99)).rejects.toThrow('Invalid capabilities response')
  })
})

// ─── Reputation tag derivation tests ─────────────────────────────────────────

describe('erc8004/reputation', () => {
  it('derives revenues tag from spentUsdc', async () => {
    const { deriveTagsFromExecution } = await import('../lib/erc8004/reputation.js')

    const tags = deriveTagsFromExecution({
      agentId: 1,
      taskId: 'test-task',
      executionTimeMs: 5000,
      spentUsdc: 500_000n, // 0.50 USDC
      veniceTokensUsed: 1000,
      veniceModelId: 'kimi-k2-6',
      teeUsed: false,
      e2eeUsed: false,
      delegationDepth: 2,
      crossChain: false,
      success: true,
      refunded: false,
    })

    const revenueTag = tags.find((t) => t.tag1 === 'revenues')
    expect(revenueTag).toBeDefined()
    expect(revenueTag!.value).toBe(50n) // 0.50 USD * 100 = 50 cents

    const successTag = tags.find((t) => t.tag1 === 'successRate')
    expect(successTag?.value).toBe(100n)

    const complianceTag = tags.find((t) => t.tag1 === 'caveatCompliance')
    expect(complianceTag?.value).toBe(1n)
  })

  it('derives teeVerified tag when teeUsed is true', async () => {
    const { deriveTagsFromExecution } = await import('../lib/erc8004/reputation.js')

    const tags = deriveTagsFromExecution({
      agentId: 1,
      taskId: 'test-task',
      executionTimeMs: 3000,
      spentUsdc: 100_000n,
      veniceTokensUsed: 500,
      veniceModelId: 'tee-qwen3-5-122b-a10b',
      teeUsed: true,
      e2eeUsed: false,
      delegationDepth: 1,
      crossChain: false,
      success: true,
      refunded: false,
    })

    const teeTag = tags.find((t) => t.tag1 === 'teeVerified')
    expect(teeTag?.value).toBe(1n)
  })

  it('omits caveatCompliance tag on failure', async () => {
    const { deriveTagsFromExecution } = await import('../lib/erc8004/reputation.js')

    const tags = deriveTagsFromExecution({
      agentId: 1,
      taskId: 'test-task',
      executionTimeMs: 1000,
      spentUsdc: 0n,
      veniceTokensUsed: 0,
      veniceModelId: 'kimi-k2-6',
      teeUsed: false,
      e2eeUsed: false,
      delegationDepth: 1,
      crossChain: false,
      success: false,
      refunded: false,
    })

    const complianceTag = tags.find((t) => t.tag1 === 'caveatCompliance')
    expect(complianceTag).toBeUndefined()
  })

  it('classifies venice model by endpoint in inferenceTokens tag2', async () => {
    const { deriveTagsFromExecution } = await import('../lib/erc8004/reputation.js')

    const imageTags = deriveTagsFromExecution({
      agentId: 1,
      taskId: 'test',
      executionTimeMs: 2000,
      spentUsdc: 40_000n,
      veniceTokensUsed: 1,
      veniceModelId: 'flux-2-pro',
      teeUsed: false,
      e2eeUsed: false,
      delegationDepth: 1,
      crossChain: false,
      success: true,
      refunded: false,
    })

    const tokenTag = imageTags.find((t) => t.tag1 === 'inferenceTokens')
    expect(tokenTag?.tag2).toBe('venice-image')
  })
})

// ─── Venice chat tests ────────────────────────────────────────────────────────

describe('venice/chat', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    process.env['VENICE_API_KEY'] = 'test-key'
  })

  it('chatJSON parses valid JSON response', async () => {
    const mockContent = JSON.stringify({ result: 'test', score: 42 })

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: mockContent } }],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        model: 'kimi-k2-6',
      }),
    }) as any

    const { chatJSON } = await import('../lib/venice/chat.js')

    const result = await chatJSON<{ result: string; score: number }>({
      model: 'research',
      messages: [{ role: 'user', content: 'test' }],
      schema: {
        type: 'object',
        properties: { result: { type: 'string' }, score: { type: 'number' } },
        required: ['result', 'score'],
        additionalProperties: false,
      },
    })

    expect(result.result).toBe('test')
    expect(result.score).toBe(42)
  })

  it('strips markdown fences from JSON response', async () => {
    const mockContent = '```json\n{"value": 99}\n```'

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: mockContent } }],
        usage: { prompt_tokens: 5, completion_tokens: 10, total_tokens: 15 },
        model: 'kimi-k2-6',
      }),
    }) as any

    const { chatJSON } = await import('../lib/venice/chat.js')

    const result = await chatJSON<{ value: number }>({
      model: 'research',
      messages: [{ role: 'user', content: 'test' }],
      schema: {
        type: 'object',
        properties: { value: { type: 'number' } },
        required: ['value'],
        additionalProperties: false,
      },
    })

    expect(result.value).toBe(99)
  })

  it('throws VeniceError on non-ok response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve('Unauthorized'),
    }) as any

    const { chat } = await import('../lib/venice/chat.js')
    await expect(
      chat({ model: 'research', messages: [{ role: 'user', content: 'test' }] })
    ).rejects.toThrow('Venice 401')
  })
})

// ─── Webhook verification tests ───────────────────────────────────────────────

describe('oneshot/webhook', () => {
  it('extracts oneShotTaskId from nexario: memo format', async () => {
    const { buildMemo } = await import('../lib/oneshot/webhook.js')

    const memo = buildMemo('oneshot-task-123', 'nexario-task-456')
    expect(memo).toBe('nexario:oneshot-task-123:nexario-task-456')
  })

  it('rejects webhooks older than 5 minutes', async () => {
    vi.stubEnv('ONESHOT_WEBHOOK_PUBLIC_KEY', '')

    const { verifyAndParseWebhook } = await import('../lib/oneshot/webhook.js')

    const stalePayload = JSON.stringify({
      eventName: 'TransactionExecutionSuccess',
      data: {
        chain: 11155111,
        transactionExecutionId: 'test-id',
        transactionExecutionMemo: 'nexario:task1:task2',
        transactionReceipt: { hash: '0xabc', blockNumber: 100, gasUsed: '21000', status: 1 },
      },
      timestamp: Math.floor(Date.now() / 1000) - 400, // 400 seconds ago
      apiVersion: 0,
      signature: 'fakesig',
    })

    await expect(
      verifyAndParseWebhook(stalePayload, 'fakesig')
    ).rejects.toThrow()
  })
})
