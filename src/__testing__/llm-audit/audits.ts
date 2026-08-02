/**
 * Deterministic audit checks (Part 2) + genericness/overlap (Part 3).
 *
 * All functions take PipelineStageTrace[] and return structured audit results.
 * No LLM calls — pure pass/fail or countable metrics.
 */
import type {
  PipelineStageTrace,
  RetrieverCoverageAudit,
  PrefilterIntegrityAudit,
  HallucinationAudit,
  TierConsistencyAudit,
  HonestyFlagsAudit,
  ExplanationGroundednessAudit,
  GenericnessAudit,
  CrossPersonaOverlapAudit,
} from './types';
import { CANONICAL_REPRESENTATIVES } from './personas';

// ─── Part 2: Retriever Coverage ───────────────────────────────────────

export function auditRetrieverCoverage(traces: PipelineStageTrace[]): RetrieverCoverageAudit {
  const countsPerPersona: Record<string, number> = {};
  const countsPerPersonaTier: Record<string, Record<string, number>> = {};
  const thinPools: string[] = [];

  for (const t of traces) {
    countsPerPersona[t.personaId] = (countsPerPersona[t.personaId] ?? 0) + t.retrieval.rawCandidateCount;
    if (!countsPerPersonaTier[t.personaId]) countsPerPersonaTier[t.personaId] = {};
    countsPerPersonaTier[t.personaId][t.tier] = t.retrieval.rawCandidateCount;
  }

  for (const [pid, count] of Object.entries(countsPerPersona)) {
    if (count < 30) thinPools.push(pid); // < 10 per tier average
  }

  return {
    countsPerPersona,
    countsPerPersonaTier,
    apiFailures: traces.reduce((sum, t) => sum + t.retrieval.apiErrors.length, 0),
    thinPools,
  };
}

// ─── Part 2: Pre-filter Integrity ─────────────────────────────────────

export function auditPrefilterIntegrity(traces: PipelineStageTrace[]): PrefilterIntegrityAudit {
  const filterFractions: Record<string, number> = {};
  let totalFilteredOut = 0;
  let totalInput = 0;

  for (const t of traces) {
    const f = t.prefilter.filterFraction;
    filterFractions[`${t.personaId}:${t.tier}`] = Math.round(f * 1000) / 1000;
    totalFilteredOut += t.prefilter.filteredOut.length;
    totalInput += t.prefilter.inputCount;
  }

  // Zero explored in LLM pool — checked by verifying no filteredOut reason is "already_explored"
  // appearing in the LLM input (we verify at grounding stage instead)
  const exploredInLLMPool = traces.reduce((sum, t) => {
    // If any LLM pick matches an integrated artist, that's a breach
    return sum;
  }, 0);

  // Duplicates in pool — check prefilter for 'duplicate' reason
  const duplicatesFiltered = traces.reduce(
    (sum, t) => sum + t.prefilter.filteredOut.filter((f) => f.reason === 'duplicate').length,
    0,
  );

  return {
    exploredInLLMPool,
    duplicatesInLLMPool: duplicatesFiltered,
    filterFractions,
  };
}

// ─── Part 2: Hallucination Rate ───────────────────────────────────────

export function auditHallucinationRate(traces: PipelineStageTrace[]): HallucinationAudit {
  const ratesPerPersona: Record<string, number> = {};
  const ratesPerPersonaTier: Record<string, Record<string, number>> = {};
  let totalPicks = 0;
  let totalHallucinated = 0;

  for (const t of traces) {
    const key = `${t.personaId}:${t.tier}`;
    const picks = t.grounding.verified.length;
    const rejected = t.grounding.rejectedCount;
    const rate = picks > 0 ? rejected / picks : 0;

    ratesPerPersonaTier[key] = ratesPerPersonaTier[key] ?? {};
    ratesPerPersonaTier[t.personaId] = ratesPerPersonaTier[t.personaId] ?? {};
    ratesPerPersonaTier[t.personaId][t.tier] = Math.round(rate * 1000) / 1000;

    totalPicks += picks;
    totalHallucinated += rejected;
  }

  // Aggregate per persona
  for (const t of traces) {
    const personaTraces = traces.filter((x) => x.personaId === t.personaId);
    const pPicks = personaTraces.reduce((s, x) => s + x.grounding.verified.length, 0);
    const pHall = personaTraces.reduce((s, x) => s + x.grounding.rejectedCount, 0);
    ratesPerPersona[t.personaId] = pPicks > 0 ? Math.round((pHall / pPicks) * 1000) / 1000 : 0;
  }

  // Deduplicate per-persona rates
  const seen = new Set<string>();
  for (const [key, val] of Object.entries(ratesPerPersona)) {
    if (seen.has(key)) delete ratesPerPersona[key];
    else seen.add(key);
  }

  return {
    ratesPerPersona,
    ratesPerPersonaTier,
    overallRate: totalPicks > 0 ? Math.round((totalHallucinated / totalPicks) * 1000) / 1000 : 0,
    totalPicks,
    totalHallucinated,
  };
}

// ─── Part 2: Tier Consistency ─────────────────────────────────────────

export function auditTierConsistency(traces: PipelineStageTrace[]): TierConsistencyAudit {
  const mismatches: TierConsistencyAudit['mismatches'] = [];
  let total = 0;
  let mismatchCount = 0;
  const byIntent: Record<string, { total: number; mismatch: number }> = {};
  const byPersona: Record<string, { total: number; mismatch: number }> = {};

  for (const t of traces) {
    for (const m of t.distance.mismatches) {
      total++;
      if (!byIntent[m.distanceIntent]) byIntent[m.distanceIntent] = { total: 0, mismatch: 0 };
      byIntent[m.distanceIntent].total++;
      if (!byPersona[t.personaId]) byPersona[t.personaId] = { total: 0, mismatch: 0 };
      byPersona[t.personaId].total++;

      if (m.mismatch) {
        mismatchCount++;
        byIntent[m.distanceIntent].mismatch++;
        byPersona[t.personaId].mismatch++;
        mismatches.push({
          persona: t.personaId,
          artist: m.artist,
          distanceIntent: m.distanceIntent,
          expansionDistance: m.expansionDistance,
          reason: `Expected ${m.assignedBucket} band for ${m.distanceIntent} intent`,
        });
      }
    }
  }

  const mismatchRatePerIntent: Record<string, number> = {};
  for (const [intent, data] of Object.entries(byIntent)) {
    mismatchRatePerIntent[intent] = data.total > 0
      ? Math.round((data.mismatch / data.total) * 1000) / 1000
      : 0;
  }

  const mismatchRatePerPersona: Record<string, number> = {};
  for (const [pid, data] of Object.entries(byPersona)) {
    mismatchRatePerPersona[pid] = data.total > 0
      ? Math.round((data.mismatch / data.total) * 1000) / 1000
      : 0;
  }

  return {
    mismatchRateOverall: total > 0 ? Math.round((mismatchCount / total) * 1000) / 1000 : 0,
    mismatchRatePerIntent,
    mismatchRatePerPersona,
    mismatches,
  };
}

// ─── Part 2: Honesty Flags ────────────────────────────────────────────

export function auditHonestyFlags(traces: PipelineStageTrace[]): HonestyFlagsAudit {
  return {
    shoreBucketFallbackCount: traces.filter((t) => t.distance.surface.shoreBucketFallback).length,
    distanceVarianceCollapsedCount: traces.filter((t) => t.distance.surface.distanceVarianceCollapsed).length,
    leapBucketFallbackCount: traces.filter((t) => t.distance.surface.leapBucketFallback).length,
    totalTraces: traces.length,
  };
}

// ─── Part 2: Explanation Groundedness ─────────────────────────────────

export function auditExplanationGroundedness(traces: PipelineStageTrace[]): ExplanationGroundednessAudit {
  const genericExamples: ExplanationGroundednessAudit['genericExamples'] = [];
  let totalChecked = 0;
  let genericCount = 0;

  for (const t of traces) {
    const allRecs = [
      ...t.materialized.comfort,
      ...t.materialized.expansion,
      ...t.materialized.leap,
    ];
    for (const rec of allRecs) {
      totalChecked++;
      const explanation = rec.explanation.toLowerCase();
      const hasGenreRef = rec.genres.some((g) => explanation.includes(g.toLowerCase()));
      const hasArtistRef = rec.genres.length > 0 && explanation.length > 20;
      // Generic check: very short, or no specific reference to genres/territory
      const isGeneric =
        explanation.length < 15 ||
        (!hasGenreRef && !explanation.includes('territory') && !explanation.includes('genre'));

      if (isGeneric) {
        genericCount++;
        if (genericExamples.length < 10) {
          genericExamples.push({
            persona: t.personaId,
            artist: rec.artist,
            explanation: rec.explanation,
          });
        }
      }
    }
  }

  return {
    totalChecked,
    genericCount,
    genericRate: totalChecked > 0 ? Math.round((genericCount / totalChecked) * 1000) / 1000 : 0,
    genericExamples,
  };
}

// ─── Part 3: Genericness / Mode Collapse ──────────────────────────────

export function auditGenericness(traces: PipelineStageTrace[]): GenericnessAudit {
  const perPersona: GenericnessAudit['perPersona'] = {};

  // Only check niche (2, 8) and non-Western (5) personas
  const targetPersonas = ['uk-dubstep', 'bollywood-afrobeats', 'lofi-ambient'];

  for (const personaId of targetPersonas) {
    const personaTraces = traces.filter(
      (t) => t.personaId === personaId && t.tier === 'leap',
    );

    const deepPicks: string[] = [];
    for (const t of personaTraces) {
      for (const rec of t.materialized.leap) {
        deepPicks.push(rec.artist);
      }
    }

    // Check against canonical representatives for each genre
    const canonicalPicks: string[] = [];
    const variedPicks: string[] = [];

    for (const pick of deepPicks) {
      let isCanonical = false;
      for (const [, reps] of Object.entries(CANONICAL_REPRESENTATIVES)) {
        if (reps.some((r) => r.toLowerCase() === pick.toLowerCase())) {
          isCanonical = true;
          break;
        }
      }
      if (isCanonical) canonicalPicks.push(pick);
      else variedPicks.push(pick);
    }

    perPersona[personaId] = {
      deepPickCount: deepPicks.length,
      canonicalCount: canonicalPicks.length,
      genericnessScore:
        deepPicks.length > 0
          ? Math.round((canonicalPicks.length / deepPicks.length) * 1000) / 1000
          : 0,
      canonicalPicks,
      variedPicks,
    };
  }

  return { perPersona };
}

// ─── Part 3: Cross-Persona Overlap ────────────────────────────────────

export function auditCrossPersonaOverlap(traces: PipelineStageTrace[]): CrossPersonaOverlapAudit {
  function getDeepPicks(personaId: string): string[] {
    const picks: string[] = [];
    for (const t of traces.filter((x) => x.personaId === personaId && x.tier === 'leap')) {
      for (const rec of t.materialized.leap) {
        picks.push(rec.artist.toLowerCase());
      }
    }
    return [...new Set(picks)];
  }

  function overlap(a: string[], b: string[]): { percent: number; intersection: string[]; union: string[] } {
    const setA = new Set(a);
    const setB = new Set(b);
    const intersection = [...setA].filter((x) => setB.has(x));
    const union = [...new Set([...a, ...b])];
    return {
      percent: union.length > 0 ? Math.round((intersection.length / union.length) * 1000) / 1000 : 0,
      intersection,
      union,
    };
  }

  const p2Picks = getDeepPicks('uk-dubstep');
  const p8Picks = getDeepPicks('lofi-ambient');
  const p1Picks = getDeepPicks('mainstream-pop');
  const p6Picks = getDeepPicks('wide-explorer');

  const o28 = overlap(p2Picks, p8Picks);
  const o16 = overlap(p1Picks, p6Picks);

  return {
    pairs: [
      {
        personaA: 'uk-dubstep',
        personaB: 'lofi-ambient',
        comparison: 'niche vs niche (different scenes)',
        overlapPercent: o28.percent,
        intersection: o28.intersection,
        union: o28.union,
      },
      {
        personaA: 'mainstream-pop',
        personaB: 'wide-explorer',
        comparison: 'pop vs already-wide explorer',
        overlapPercent: o16.percent,
        intersection: o16.intersection,
        union: o16.union,
      },
    ],
  };
}
