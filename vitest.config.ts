import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Node by default; the selection spec opts into jsdom with its per-file
  // `@vitest-environment jsdom` pragma.
  test: {
    environment: 'node',
    include: ['tests/**/*.spec.ts'],
  },
})
