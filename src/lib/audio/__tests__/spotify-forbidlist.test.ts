/**
 * Part 1 safety: no product code may call dead Spotify catalog endpoints.
 * Scans source under src/ for forbidden path strings in fetch/spotifyFetch calls.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const SRC = path.join(process.cwd(), 'src');

const FORBIDDEN = [
  '/audio-features',
  '/audio-analysis',
  '/related-artists',
  '/v1/recommendations',
];

function walkTsFiles(dir: string, out: string[] = []): string[] {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules' || ent.name === '__tests__') continue;
      walkTsFiles(p, out);
    } else if (/\.(ts|tsx)$/.test(ent.name)) {
      out.push(p);
    }
  }
  return out;
}

describe('Spotify dead-endpoint forbidlist (Part 1)', () => {
  it('does not call restricted catalog endpoints', () => {
    const files = walkTsFiles(SRC);
    const violations: string[] = [];

    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8');
      // Allow comments / strings that document removal (no live template for fetch)
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
          continue;
        }
        // JSDoc / block comments mid-line still skipped if only documentation
        if (trimmed.includes('permanently restricted') || trimmed.includes('Do NOT') || trimmed.includes('Do not re-')) {
          continue;
        }
        for (const frag of FORBIDDEN) {
          if (!line.includes(frag)) continue;
          // Live call patterns only
          if (
            /fetch\s*\(|spotifyFetch\s*\(|`https:\/\/api\.spotify\.com/.test(line) ||
            /spotify\.com\/v1.*\$\{/.test(line)
          ) {
            violations.push(`${path.relative(process.cwd(), file)}:${i + 1}: ${trimmed.slice(0, 120)}`);
          }
        }
      }
    }

    expect(violations, violations.join('\n')).toEqual([]);
  });
});
