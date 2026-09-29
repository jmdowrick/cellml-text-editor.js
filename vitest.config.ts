import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vitest/config'

// Separate from vite.config.ts, so the dev-server and bundle plugins stay out of the tests.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'happy-dom',
    include: ['src/**/__tests__/**/*.test.ts'],
  },
})
