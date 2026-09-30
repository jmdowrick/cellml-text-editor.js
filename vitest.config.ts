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
    // The corpus tests run whole module libraries under jsdom; with the suite in parallel, 5s is too tight.
    testTimeout: 30_000,
  },
})
