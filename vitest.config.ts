import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/tests/**/*.test.ts'],
    setupFiles: ['./src/tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json'],
      include: ['src/lib/**', 'src/sdk/**', 'src/agents/**'],
      exclude: ['src/tests/**'],
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
    // Tell Vitest to resolve .js imports to .ts files
    extensions: ['.ts', '.js'],
  },
})
