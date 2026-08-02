import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * vitest configuration.
 *
 * Test files live alongside source and use the .test.ts suffix. The @/* path
 * alias mirrors tsconfig.json so imports resolve identically in tests and app.
 *
 * Default environment is `node` (the ORCA engines under test are pure TS, not
 * DOM). Tests needing DOM APIs can override via the
 * `// @vitest-environment jsdom` pragma.
 *
 * process.cwd() is the vitest invocation root (repo root under npm scripts),
 * so path.resolve(process.cwd(), 'src') resolves the alias without depending
 * on import.meta.url or __dirname, which are unreliable under vite's config
 * bundling.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(process.cwd(), 'src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: [
      '**/node_modules/**',
      '**/.git/**',
      // LLM audit hits live MusicBrainz + Gemini; run explicitly when needed.
      'src/__testing__/llm-audit/**/*.test.ts',
    ],
    hookTimeout: 900_000,
  },
});
