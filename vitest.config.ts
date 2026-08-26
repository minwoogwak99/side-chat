import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

const harnessRoot = resolve(__dirname, '../../deepseek-harness')

export default defineConfig({
  // Node by default; the selection spec opts into jsdom with its per-file
  // `@vitest-environment jsdom` pragma.
  resolve: {
    alias: {
      // The published `./client` export is the browser bundle (a
      // window.__ModuleLoader__ wrapper); tests evaluate the TS sources.
      '@deepseek-ai/dsh-client-runtime/client': resolve(
        harnessRoot, 'packages/client/runtime/src/client/index.ts',
      ),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.spec.ts'],
  },
})
