/**
 * Venice Model Catalog
 * Complete list of available models grouped by type.
 * Used for agent registration UI and dynamic model selection.
 */

export type VeniceModelType = 
  | 'text'
  | 'reasoning'
  | 'code'
  | 'image'
  | 'audio'
  | 'video'
  | 'tts'
  | 'stt'
  | 'tee'

export interface VeniceModel {
  id: string
  name: string
  type: VeniceModelType
  description: string
  contextWindow?: string
  isPrivate?: boolean    // requires account
  isAnon?: boolean       // fully permissionless
  isTEE?: boolean        // hardware-attested
  isUncensored?: boolean
  supportsWebSearch?: boolean
  supportsTools?: boolean
  costTier: 'cheap' | 'mid' | 'expensive'
}

export const VENICE_MODEL_CATALOG: VeniceModel[] = [
  // ── Text / Reasoning ───────────────────────────────────────────────────────
  {
    id: 'qwen3-235b-a22b-instruct-2507',
    name: 'Qwen3 235B Instruct',
    type: 'text',
    description: 'Alibaba\'s flagship instruction model. Best for planning, coordination, and complex reasoning.',
    contextWindow: '256K',
    isAnon: true,
    supportsTools: true,
    costTier: 'expensive',
  },
  {
    id: 'qwen3-235b-a22b-thinking-2507',
    name: 'Qwen3 235B Thinking',
    type: 'reasoning',
    description: 'Extended thinking mode for deep analysis, audits, and multi-step reasoning.',
    contextWindow: '256K',
    isAnon: true,
    costTier: 'expensive',
  },
  {
    id: 'kimi-k2-6',
    name: 'Kimi K2.6',
    type: 'text',
    description: '1T parameter MoE model with web search. Best for research and live data tasks.',
    contextWindow: '256K',
    isPrivate: true,
    supportsWebSearch: true,
    supportsTools: true,
    costTier: 'expensive',
  },
  {
    id: 'kimi-k2-5',
    name: 'Kimi K2.5',
    type: 'text',
    description: 'Strong general-purpose model with web search and tool use.',
    contextWindow: '256K',
    isAnon: true,
    supportsWebSearch: true,
    costTier: 'mid',
  },
  {
    id: 'grok-4-3',
    name: 'Grok 4.3',
    type: 'reasoning',
    description: 'xAI\'s fastest reasoning model with function calling and structured outputs.',
    contextWindow: '1M',
    isPrivate: true,
    supportsTools: true,
    costTier: 'expensive',
  },
  {
    id: 'qwen3-5-9b',
    name: 'Qwen3 5 9B',
    type: 'text',
    description: 'Fast, cheap model for classification, routing, and lightweight tasks.',
    contextWindow: '32K',
    isAnon: true,
    costTier: 'cheap',
  },
  {
    id: 'qwen3-5-397b-a17b',
    name: 'Qwen3 5 397B',
    type: 'text',
    description: 'Large MoE model balancing capability and cost.',
    contextWindow: '32K',
    isAnon: true,
    costTier: 'mid',
  },
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    type: 'reasoning',
    description: '1.6T parameter MoE with 1M context. Built for advanced reasoning and long-horizon agentic workflows.',
    contextWindow: '1M',
    isAnon: true,
    costTier: 'expensive',
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    type: 'text',
    description: 'Efficiency-optimized 284B MoE with 1M context. Fast inference for high-throughput tasks.',
    contextWindow: '1M',
    isAnon: true,
    costTier: 'mid',
  },
  {
    id: 'minimax-m3',
    name: 'MiniMax M3',
    type: 'text',
    description: 'MiniMax\'s frontier model for coding, agentic workflows, and complex reasoning.',
    contextWindow: '500K',
    isAnon: true,
    costTier: 'mid',
  },
  {
    id: 'venice-uncensored-1-2',
    name: 'Venice Uncensored',
    type: 'text',
    description: 'Venice\'s own uncensored model. No content filtering.',
    isAnon: true,
    isUncensored: true,
    costTier: 'cheap',
  },
  {
    id: 'tencent-hy3-preview',
    name: 'Hy3 Preview',
    type: 'reasoning',
    description: '295B MoE from Tencent. Excels at complex reasoning, coding, and agent tasks.',
    contextWindow: '256K',
    isPrivate: true,
    costTier: 'expensive',
  },
  // ── Code ───────────────────────────────────────────────────────────────────
  {
    id: 'qwen3-coder-480b-a35b-instruct-turbo',
    name: 'Qwen3 Coder 480B',
    type: 'code',
    description: 'Largest code model on Venice. Best for smart contract analysis, code generation, and technical audits.',
    isAnon: true,
    costTier: 'expensive',
  },
  {
    id: 'grok-build-0-1',
    name: 'Grok Build 0.1',
    type: 'code',
    description: 'xAI\'s fast coding model trained specifically for agentic coding.',
    contextWindow: '256K',
    isPrivate: true,
    costTier: 'mid',
  },
  // ── TEE / Private ──────────────────────────────────────────────────────────
  {
    id: 'e2ee-qwen3-6-35b-a3b',
    name: 'Qwen3.6 35B TEE',
    type: 'tee',
    description: 'TEE + E2EE. Hardware-attested secure enclave. Zero data retention. For sensitive analysis.',
    contextWindow: '128K',
    isTEE: true,
    costTier: 'mid',
  },
  {
    id: 'e2ee-gemma-4-26b-a4b-uncensored',
    name: 'Gemma 4 TEE Uncensored',
    type: 'tee',
    description: 'TEE + uncensored. Hardware-attested. No content filtering. For personal and sensitive content.',
    isTEE: true,
    isUncensored: true,
    costTier: 'mid',
  },
  {
    id: 'e2ee-glm-5-1',
    name: 'GLM 5.1 TEE',
    type: 'tee',
    description: 'Faster TEE model. Hardware-attested. Good for lower-latency private inference.',
    contextWindow: '200K',
    isTEE: true,
    costTier: 'cheap',
  },
  {
    id: 'e2ee-qwen3-6-35b-a3b-uncensored-p',
    name: 'Qwen3.6 35B TEE Uncensored',
    type: 'tee',
    description: 'TEE + E2EE + uncensored. Maximum privacy with no content restrictions.',
    contextWindow: '262K',
    isTEE: true,
    isUncensored: true,
    costTier: 'mid',
  },
  // ── Image ──────────────────────────────────────────────────────────────────
  {
    id: 'ideogram-v4',
    name: 'Ideogram V4',
    type: 'image',
    description: 'Industry-leading text rendering. Best for posters, logos, and marketing graphics.',
    isAnon: true,
    costTier: 'mid',
  },
  {
    id: 'gpt-image-2',
    name: 'GPT Image 2',
    type: 'image',
    description: 'OpenAI\'s latest image model. Fine typography and high detail.',
    isAnon: true,
    costTier: 'expensive',
  },
  {
    id: 'krea-v2-large',
    name: 'Krea v2 Large',
    type: 'image',
    description: 'High-fidelity text-to-image. Refined aesthetics and lifelike detail.',
    isAnon: true,
    costTier: 'mid',
  },
  {
    id: 'krea-v2-medium',
    name: 'Krea v2 Medium',
    type: 'image',
    description: 'Cost-effective image generation balancing speed and quality.',
    isAnon: true,
    costTier: 'cheap',
  },
  // ── TTS ───────────────────────────────────────────────────────────────────
  {
    id: 'tts-gradium-v1',
    name: 'Gradium TTS',
    type: 'tts',
    description: 'Natural voice synthesis by Venice.',
    costTier: 'cheap',
  },
  {
    id: 'tts-elevenlabs-turbo-v2-5',
    name: 'ElevenLabs Turbo',
    type: 'tts',
    description: 'Fast, high-quality text-to-speech from ElevenLabs.',
    costTier: 'mid',
  },
  {
    id: 'tts-minimax-speech-02-hd',
    name: 'MiniMax Speech HD',
    type: 'tts',
    description: 'High-definition voice synthesis from MiniMax.',
    costTier: 'mid',
  },
  {
    id: 'tts-xai-v1',
    name: 'xAI TTS',
    type: 'tts',
    description: 'xAI\'s natural voice synthesis model.',
    costTier: 'cheap',
  },
  {
    id: 'tts-orpheus',
    name: 'Orpheus TTS',
    type: 'tts',
    description: 'Expressive, natural-sounding speech synthesis.',
    costTier: 'cheap',
  },
  // ── STT ──────────────────────────────────────────────────────────────────
  {
    id: 'fal-ai/wizper',
    name: 'Wizper (Whisper v3)',
    type: 'stt',
    description: 'Fast speech-to-text transcription.',
    isPrivate: true,
    costTier: 'cheap',
  },
  {
    id: 'elevenlabs/scribe-v2',
    name: 'ElevenLabs Scribe',
    type: 'stt',
    description: 'High-accuracy speech transcription from ElevenLabs.',
    isAnon: true,
    costTier: 'mid',
  },
  // ── Video ─────────────────────────────────────────────────────────────────
  {
    id: 'kling-v3-4k-text-to-video',
    name: 'Kling V3 4K',
    type: 'video',
    description: 'Native 4K video generation. Cinema-grade output.',
    isAnon: true,
    costTier: 'expensive',
  },
  {
    id: 'wan-2-7-uncensored-text-to-video',
    name: 'Wan 2.7 Uncensored',
    type: 'video',
    description: 'Uncensored text-to-video generation.',
    isAnon: true,
    isUncensored: true,
    costTier: 'expensive',
  },
  {
    id: 'pixverse-c1-text-to-video',
    name: 'PixVerse C1',
    type: 'video',
    description: 'Film-grade text-to-video with native audio, up to 1080p and 15 seconds.',
    isAnon: true,
    costTier: 'expensive',
  },
]

export function getModelsByType(type: VeniceModelType): VeniceModel[] {
  return VENICE_MODEL_CATALOG.filter((m) => m.type === type)
}

export function getModelById(id: string): VeniceModel | undefined {
  return VENICE_MODEL_CATALOG.find((m) => m.id === id)
}

export function groupModelsByType(): Record<VeniceModelType, VeniceModel[]> {
  const groups = {} as Record<VeniceModelType, VeniceModel[]>
  for (const model of VENICE_MODEL_CATALOG) {
    if (!groups[model.type]) groups[model.type] = []
    groups[model.type]!.push(model)
  }
  return groups
}
