import { z } from 'zod'
import { config } from 'dotenv'

config()

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),

  DATABASE_URL: z.string().default('./nexario.db'),

  PRIVATE_KEY: z
    .string()
    .startsWith('0x')
    .describe('Backend wallet private key — signs delegations, registers agents'),
  ORACLE_PRIVATE_KEY: z
    .string()
    .startsWith('0x')
    .optional()
    .describe('Oracle wallet private key — writes reputation feedback on-chain'),

  SEPOLIA_RPC_URL: z
    .string()
    .url()
    .describe('Ethereum Sepolia RPC endpoint'),

  BASE_SEPOLIA_RPC_URL: z
    .string()
    .url()
    .optional()
    .describe('Base Sepolia RPC — for multichain fee payment'),

  MAINNET_RPC_URL: z
    .string()
    .url()
    .default('https://ethereum-rpc.publicnode.com')
    .describe('Ethereum mainnet RPC — for 1Shot relay execution'),

  VENICE_API_KEY: z
    .string()
    .min(1)
    .describe('Venice AI API key for agent inference'),
  ZERO_EX_API_KEY: z
    .string()
    .optional()
    .describe('0x Swap API key for DEX quotes on Base'),

  VENICE_WALLET_PRIVATE_KEY: z
    .string()
    .startsWith('0x')
    .optional()
    .describe('Separate wallet for Venice x402 payments — uses x402 wallet auth'),

  ONESHOT_RELAYER_URL: z
    .string()
    .url()
    .default('https://relayer.1shotapi.com/relayers')
    .describe('1Shot permissionless relayer endpoint'),

  ONESHOT_WEBHOOK_PUBLIC_KEY: z
    .string()
    .optional()
    .describe('Ed25519 public key for verifying 1Shot webhook signatures'),

  TELEGRAM_BOT_TOKEN: z
    .string()
    .optional()
    .describe('Telegraf bot token from @BotFather'),

  TELEGRAM_WEBHOOK_URL: z
    .string()
    .url()
    .optional()
    .describe('Public HTTPS URL for Telegram webhook delivery'),

  NEXARIO_API_KEY: z
    .string()
    .min(16)
    .default('nexario-dev-key-change-in-prod')
    .describe('API key required for POST /api/task'),

  DELEGATION_MANAGER_ADDRESS: z
    .string()
    .startsWith('0x')
    .describe('MetaMask DelegationManager contract address on target chain'),

  AGENT_REGISTRY_ADDRESS: z
    .string()
    .startsWith('0x')
    .optional()
    .describe('NexarioAgentRegistry contract address — set after deploy'),

  REPUTATION_REGISTRY_ADDRESS: z
    .string()
    .startsWith('0x')
    .optional()
    .describe('NexarioReputationRegistry contract address — set after deploy'),

  ETHERSCAN_API_KEY: z
    .string()
    .optional()
    .describe('Etherscan API key for contract verification'),

  LOG_LEVEL: z
    .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal'])
    .default('info'),
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  console.error('❌  Invalid environment variables:')
  for (const issue of parsed.error.issues) {
    console.error(`   ${issue.path.join('.')}: ${issue.message}`)
  }
  process.exit(1)
}

export const env = parsed.data

export type Env = typeof env
