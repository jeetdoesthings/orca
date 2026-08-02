import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { readFileSync } from 'node:fs';

// Load .env into process.env for live Gemini + Spotify credentials.
try {
  const envContent = readFileSync(path.resolve(process.cwd(), '.env'), 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
} catch { /* .env optional */ }

/**
 * Dedicated vitest config for the LLM audit.
 *
 * The default vitest.config.ts excludes the audit directory because it hits
 * live MusicBrainz + Gemini and takes ~10–15 minutes. Use this config
 * when you want to run the audit explicitly:
 *
 *   npx vitest run --config vitest.audit.config.ts
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(process.cwd(), 'src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/__testing__/llm-audit/**/*.test.ts'],
    hookTimeout: 900_000,
  },
});
