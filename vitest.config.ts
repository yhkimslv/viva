import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.{ts,tsx}'],
    pool: 'forks',
    // Avoid starving jsdom and real-Git tests by spawning a worker per CPU.
    maxWorkers: 4
  }
})
