/**
 * scripts/diff-baselines.ts
 * ---------------------------------------------------------------------------
 * Phase 1.5 deliverable: regression-diff harness.
 *
 * Given two baseline snapshots (one pre-Phase 2 PR, one post-Phase 2 PR)
 * for the same userId + label, walks the JSON files side-by-side and reports
 * which fields changed, added, removed. Honours the "expected-diff"
 * declaration in success-metrics.md §4.3 — you can pass --expect flags to
 * mark certain fields as acceptable changes so the script's exit code can
 * be green even on real change.
 *
 * USAGE
 * -----
 *   npx tsx scripts/diff-baselines.ts \
 *      --baseline=scratch-fixtures/<userId>/baseline/baseline-<oldSHA>-<oldStamp> \
 *      --candidate=scratch-fixtures/<userId>/baseline/baseline-<newSHA>-<newStamp> \
 *      [--expect=field.path] [--expect=field.path] ...
 *
 * Exit codes:
 *   0 — all changes are within --expect list (or no changes found)
 *   1 — unexpected changes detected; review report
 *   2 — usage error / missing files
 *
 * ---------------------------------------------------------------------------
 */
import { promises as fs } from 'fs';
import path from 'path';

interface Args {
  baseline: string;
  candidate: string;
  expects: string[];
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (f: string) => {
    const found = argv.find(a => a.startsWith(`--${f}=`));
    return found ? found.slice(found.indexOf('=') + 1) : null;
  };
  const all = (f: string) =>
    argv.filter(a => a.startsWith(`--${f}=`)).map(a => a.slice(a.indexOf('=') + 1));
  const baseline = get('baseline');
  const candidate = get('candidate');
  if (!baseline || !candidate) {
    console.error('Usage: npx tsx scripts/diff-baselines.ts --baseline=<dir> --candidate=<dir> [--expect=path]');
    process.exit(2);
  }
  return { baseline, candidate, expects: all('expect') };
}

// Files in a baseline dir, ordered by stage number prefix:
const BASELINE_FILES = [
  '00-meta', '01-identity', '03-gre', '04-ocse',
  '05-expansion-intelligence', '06-frontier-nodes',
  '07-wpe-projection', '08-profile', '09-territory-rows',
];

async function loadDir(dir: string): Promise<Map<string, any>> {
  const files = (await fs.readdir(dir))
    .filter(f => f.endsWith('.json'));
  const m = new Map<string, any>();
  for (const f of files) {
    // Strip the leading <label>-<sha>-<stamp>. prefix to find the canonical stage name
    const stageMatch = f.match(/\.(\d{2}-[a-z-]+|placeholder)\.json$/i);
    const stageName = stageMatch ? stageMatch[1] : f;
    try {
      const content = JSON.parse(await fs.readFile(path.join(dir, f), 'utf-8'));
      m.set(stageName, content);
    } catch (e) {
      m.set(stageName, { __loadError__: String((e as Error).message), __raw__: await fs.readFile(path.join(dir, f), 'utf-8') });
    }
  }
  return m;
}

interface Change { path: string; before: unknown; after: unknown; kind: 'ADD' | 'REMOVE' | 'CHANGE'; }

function diff(prev: any, next: any, prefix: string, out: Change[]) {
  if (typeof prev !== typeof next || (prev && typeof prev !== 'object') || (next && typeof next !== 'object')) {
    if (prev !== next) out.push({ path: prefix, before: prev, after: next, kind: 'CHANGE' });
    return;
  }
  if (Array.isArray(prev) && Array.isArray(next)) {
    const max = Math.max(prev.length, next.length);
    for (let i = 0; i < max; i++) {
      if (i >= prev.length) out.push({ path: `${prefix}[${i}]`, before: undefined, after: next[i], kind: 'ADD' });
      else if (i >= next.length) out.push({ path: `${prefix}[${i}]`, before: prev[i], after: undefined, kind: 'REMOVE' });
      else diff(prev[i], next[i], `${prefix}[${i}]`, out);
    }
    return;
  }
  if (prev && next) {
    for (const k of Object.keys(next)) {
      if (!(k in prev)) out.push({ path: `${prefix}.${k}`, before: undefined, after: next[k], kind: 'ADD' });
      else diff(prev[k], next[k], `${prefix}.${k}`, out);
    }
    for (const k of Object.keys(prev)) {
      if (!(k in next)) out.push({ path: `${prefix}.${k}`, before: prev[k], after: undefined, kind: 'REMOVE' });
    }
  }
}

async function main() {
  const args = parseArgs();
  const baselineDir = path.resolve(args.baseline);
  const candidateDir = path.resolve(args.candidate);
  const [bl, ca] = await Promise.all([loadDir(baselineDir), loadDir(candidateDir)]);
  let totalUnexpected = 0;
  let totalExpected = 0;
  console.log('[diff-baselines] baseline', baselineDir);
  console.log('[diff-baselines] candidate', candidateDir);
  console.log('[diff-baselines] expected change paths:', args.expects.length ? args.expects.join(', ') : '(none)');
  console.log('');
  for (const stage of BASELINE_FILES) {
    const pf = bl.get(stage);
    const cf = ca.get(stage);
    if (!pf || !cf) {
      console.log(`  ${stage}: ${pf ? 'only-baseline' : cf ? 'only-candidate' : 'both-missing'} — skipping`);
      continue;
    }
    const changes: Change[] = [];
    diff(pf, cf, '$', changes);
    if (changes.length === 0) { console.log(`  ${stage}: identical`); continue; }
    let unexpected = 0;
    for (const c of changes) {
      const isExpected = args.expects.some(p => c.path.includes(p));
      if (isExpected) totalExpected++;
      else { unexpected++; totalUnexpected++; }
      const marker = isExpected ? '  EXPECTED' : '⚠ UNEXPECTED';
      console.log(`  ${stage}${marker} ${c.kind} ${c.path}`);
      if (!isExpected && (c.kind === 'CHANGE' || c.kind === 'REMOVE')) {
        console.log(`      before: ${JSON.stringify(c.before).slice(0, 200)}`);
      }
      if (!isExpected && (c.kind === 'CHANGE' || c.kind === 'ADD')) {
        console.log(`      after:  ${JSON.stringify(c.after).slice(0, 200)}`);
      }
    }
  }
  console.log('');
  console.log(`[diff-baselines] summary: ${totalUnexpected} unexpected, ${totalExpected} expected.`);
  if (totalUnexpected > 0) {
    console.log('[diff-baselines] review the unexpected changes above before approving the PR.');
    process.exit(1);
  }
  console.log('[diff-baselines] green.');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(2); });
