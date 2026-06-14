import { vi } from 'vitest'

// Must satisfy zod schema in env.ts
process.env['NODE_ENV'] = 'test'
process.env['PRIVATE_KEY'] = '0x' + 'a'.repeat(64)
process.env['SEPOLIA_RPC_URL'] = 'https://rpc.sepolia.org'
process.env['VENICE_API_KEY'] = 'test-venice-key-minimum-length'
process.env['NEXARIO_API_KEY'] = 'nexario-test-api-key-32chars!!'
process.env['DELEGATION_MANAGER_ADDRESS'] = '0x' + '0'.repeat(40)
process.env['DATABASE_URL'] = './test.db'
process.env['LOG_LEVEL'] = 'info'
process.env['ONESHOT_RELAYER_URL'] = 'https://relayer.1shotapi.com/relayers'

// Mock better-sqlite3 for in-memory tests
vi.mock('better-sqlite3', () => {
  const mockDb = {
    pragma: vi.fn(),
    prepare: vi.fn(() => ({
      run: vi.fn(),
      get: vi.fn(),
      all: vi.fn(() => []),
    })),
    exec: vi.fn(),
    close: vi.fn(),
  }
  return { default: vi.fn(() => mockDb) }
})
