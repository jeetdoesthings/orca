/**
 * LLM Taste-Expansion Audit — main vitest entry point.
 *
 * Runs: Part 1 (pipeline traces) → Part 2 (deterministic audits) →
 * Part 3 (LLM-quality audits) → Part 4 (repeatability) → Final report.
 *
 * Run: npx vitest run src/__testing__/llm-audit/audit.test.ts
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { runAllPipelines } from './pipeline-runner';
import { runRepeatability } from './repeatability';
import {
  auditRetrieverCoverage,
  auditPrefilterIntegrity,
  auditHallucinationRate,
  auditTierConsistency,
  auditHonestyFlags,
  auditExplanationGroundedness,
  auditGenericness,
  auditCrossPersonaOverlap,
} from './audits';
import { auditGatewayRubric } from './judge';
import { buildReport, formatReportText } from './report';

describe('LLM Taste-Expansion Audit', () => {
  let traces: Awaited<ReturnType<typeof runAllPipelines>>;
  let repeatabilityResults: Awaited<ReturnType<typeof runRepeatability>>;
  let gatewayRubric: Awaited<ReturnType<typeof auditGatewayRubric>>;

  beforeAll(async () => {
    traces = await runAllPipelines();
    expect(traces.length).toBe(24);

    for (const t of traces) {
      expect(t.retrieval.rawCandidateCount).toBeGreaterThan(0);
      expect(t.llm.pickCount).toBeGreaterThan(0);
    }

    gatewayRubric = await auditGatewayRubric(traces);
    repeatabilityResults = await runRepeatability();
  }, 900_000);

  it('Part 2a: retriever coverage — no empty pools', () => {
    const coverage = auditRetrieverCoverage(traces);
    expect(Object.keys(coverage.countsPerPersona).length).toBe(8);
    for (const [, count] of Object.entries(coverage.countsPerPersona)) {
      expect(count).toBeGreaterThan(0);
    }
  });

  it('Part 2b: pre-filter integrity — zero explored in LLM pool', () => {
    const pf = auditPrefilterIntegrity(traces);
    expect(pf.exploredInLLMPool).toBe(0);
    expect(pf.duplicatesInLLMPool).toBe(0);
  });

  it('Part 2c: hallucination rate — prominent top-line number', () => {
    const h = auditHallucinationRate(traces);
    expect(h.totalPicks).toBeGreaterThan(0);
    expect(typeof h.overallRate).toBe('number');
    expect(h.overallRate).toBeGreaterThanOrEqual(0);
    expect(h.overallRate).toBeLessThanOrEqual(1);
  });

  it('Part 2d: tier-consistency — mismatch rate tracked', () => {
    const tc = auditTierConsistency(traces);
    expect(typeof tc.mismatchRateOverall).toBe('number');
    expect(tc.mismatchRateOverall).toBeGreaterThanOrEqual(0);
    expect(tc.mismatchRateOverall).toBeLessThanOrEqual(1);
  });

  it('Part 2e: honesty flags — tracked', () => {
    const hf = auditHonestyFlags(traces);
    expect(hf.totalTraces).toBe(24);
    expect(typeof hf.shoreBucketFallbackCount).toBe('number');
  });

  it('Part 2f: explanation groundedness — rate tracked', () => {
    const eg = auditExplanationGroundedness(traces);
    expect(eg.totalChecked).toBeGreaterThan(0);
    expect(typeof eg.genericRate).toBe('number');
    expect(eg.genericRate).toBeGreaterThanOrEqual(0);
    expect(eg.genericRate).toBeLessThanOrEqual(1);
  });

  it('Part 3a: genericness — scores for niche personas', () => {
    const g = auditGenericness(traces);
    expect(Object.keys(g.perPersona).length).toBeGreaterThanOrEqual(2);
    for (const [, data] of Object.entries(g.perPersona)) {
      expect(typeof data.genericnessScore).toBe('number');
      expect(data.genericnessScore).toBeGreaterThanOrEqual(0);
      expect(data.genericnessScore).toBeLessThanOrEqual(1);
    }
  });

  it('Part 3b: cross-persona overlap — pairs reported', () => {
    const o = auditCrossPersonaOverlap(traces);
    expect(o.pairs.length).toBe(2);
    for (const pair of o.pairs) {
      expect(typeof pair.overlapPercent).toBe('number');
      expect(pair.overlapPercent).toBeGreaterThanOrEqual(0);
      expect(pair.overlapPercent).toBeLessThanOrEqual(1);
    }
  });

  it('Part 3c: gateway rubric — Q1-Q4 scored', () => {
    expect(gatewayRubric.perRecommendation.length).toBeGreaterThan(0);
    expect(typeof gatewayRubric.averages.representativeness).toBe('number');
    expect(typeof gatewayRubric.averages.accessibility).toBe('number');
    expect(typeof gatewayRubric.averages.notDiluted).toBe('number');
    expect(typeof gatewayRubric.averages.specificReasoning).toBe('number');
  });

  it('Part 4: repeatability — persona 1 & 5 × 3 runs', () => {
    expect(repeatabilityResults.length).toBe(2);
    for (const r of repeatabilityResults) {
      expect(r.runCount).toBe(3);
      expect(typeof r.averageOverlap).toBe('number');
      expect(r.averageOverlap).toBeGreaterThanOrEqual(0);
      expect(r.averageOverlap).toBeLessThanOrEqual(1);
    }
  });

  it('Final: consolidated report is valid', () => {
    const report = buildReport(
      traces,
      {
        retrieverCoverage: auditRetrieverCoverage(traces),
        prefilterIntegrity: auditPrefilterIntegrity(traces),
        hallucinationRate: auditHallucinationRate(traces),
        tierConsistency: auditTierConsistency(traces),
        honestyFlags: auditHonestyFlags(traces),
        explanationGroundedness: auditExplanationGroundedness(traces),
      },
      {
        genericness: auditGenericness(traces),
        crossPersonaOverlap: auditCrossPersonaOverlap(traces),
        gatewayRubric,
      },
      {
        repeatability: repeatabilityResults,
      },
    );

    expect(report.totalTraces).toBe(24);
    expect(report.generatedAt).toBeTruthy();
    expect(Object.keys(report.tracesPerPersona).length).toBe(8);

    const text = formatReportText(report);
    expect(text.length).toBeGreaterThan(200);
    expect(text).toContain('ORCA LLM TASTE-EXPANSION AUDIT REPORT');
    expect(text).toContain('HALLUCINATION RATE');
    expect(text).toContain('GENERICNESS');

    console.log('\n' + text);
  });
});
