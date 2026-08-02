/**
 * Part 4 — Repeatability check.
 *
 * Rerun persona 1 (mainstream) and persona 5 (non-Western) through the
 * Deep tier three times each and compare the resulting candidate sets.
 * Reports percent overlap across runs.
 */
import type { RepeatabilityResult } from './types';
import { PERSONAS } from './personas';
import { runPipeline } from './pipeline-runner';

function jaccardOverlap(a: string[], b: string[]): number {
  const setA = new Set(a.map((s) => s.toLowerCase()));
  const setB = new Set(b.map((s) => s.toLowerCase()));
  const intersection = [...setA].filter((x) => setB.has(x));
  const union = [...new Set([...setA, ...setB])];
  return union.length > 0 ? intersection.length / union.length : 0;
}

export async function runRepeatability(): Promise<RepeatabilityResult[]> {
  const targetPersonaIds = ['mainstream-pop', 'bollywood-afrobeats'];
  const runCount = 3;
  const results: RepeatabilityResult[] = [];

  for (const personaId of targetPersonaIds) {
    const persona = PERSONAS.find((p) => p.id === personaId);
    if (!persona) continue;

    const runs: Array<{ artistSet: string[] }> = [];
    for (let i = 0; i < runCount; i++) {
      const trace = await runPipeline(persona, 'leap');
      const artists = [
        ...trace.materialized.leap.map((r) => r.artist),
        ...trace.materialized.expansion.map((r) => r.artist),
        ...trace.materialized.comfort.map((r) => r.artist),
      ];
      runs.push({ artistSet: [...new Set(artists)] });
    }

    // Pairwise overlap
    const pairwiseOverlaps: number[] = [];
    for (let i = 0; i < runs.length; i++) {
      for (let j = i + 1; j < runs.length; j++) {
        pairwiseOverlaps.push(
          Math.round(jaccardOverlap(runs[i].artistSet, runs[j].artistSet) * 1000) / 1000,
        );
      }
    }

    const averageOverlap =
      pairwiseOverlaps.length > 0
        ? Math.round((pairwiseOverlaps.reduce((a, b) => a + b, 0) / pairwiseOverlaps.length) * 1000) / 1000
        : 0;

    results.push({
      personaId,
      runCount,
      pairwiseOverlaps,
      averageOverlap,
      runs,
    });
  }

  return results;
}
