/**
 * Consolidates all audit results into the final report.
 *
 * Produces both structured AuditReport and human-readable text output.
 */
import type {
  AuditReport,
  PipelineStageTrace,
  RetrieverCoverageAudit,
  PrefilterIntegrityAudit,
  HallucinationAudit,
  TierConsistencyAudit,
  HonestyFlagsAudit,
  ExplanationGroundednessAudit,
  GenericnessAudit,
  CrossPersonaOverlapAudit,
  GatewayRubricAudit,
  RepeatabilityResult,
} from './types';
import { PERSONAS } from './personas';

export function buildReport(
  traces: PipelineStageTrace[],
  part2: {
    retrieverCoverage: RetrieverCoverageAudit;
    prefilterIntegrity: PrefilterIntegrityAudit;
    hallucinationRate: HallucinationAudit;
    tierConsistency: TierConsistencyAudit;
    honestyFlags: HonestyFlagsAudit;
    explanationGroundedness: ExplanationGroundednessAudit;
  },
  part3: {
    genericness: GenericnessAudit;
    crossPersonaOverlap: CrossPersonaOverlapAudit;
    gatewayRubric: GatewayRubricAudit;
  },
  part4: {
    repeatability: RepeatabilityResult[];
  },
): AuditReport {
  const tracesPerPersona: Record<string, number> = {};
  for (const t of traces) {
    tracesPerPersona[t.personaId] = (tracesPerPersona[t.personaId] ?? 0) + 1;
  }

  return {
    generatedAt: new Date().toISOString(),
    totalTraces: traces.length,
    tracesPerPersona,
    part2,
    part3,
    part4,
  };
}

// ─── Human-readable report formatter ──────────────────────────────────

const PERSONA_LABELS: Record<string, string> = Object.fromEntries(
  PERSONAS.map((p) => [p.id, p.label]),
);

function pad(s: string, w: number): string {
  return s.length >= w ? s.slice(0, w) : s + ' '.repeat(w - s.length);
}

function pct(n: number): string {
  return (n * 100).toFixed(1) + '%';
}

export function formatReportText(report: AuditReport): string {
  const lines: string[] = [];
  const hr = '═'.repeat(60);
  const hr2 = '─'.repeat(60);

  lines.push(hr);
  lines.push('  ORCA LLM TASTE-EXPANSION AUDIT REPORT');
  lines.push(`  Generated: ${report.generatedAt}`);
  lines.push(`  Total traces: ${report.totalTraces}`);
  lines.push(hr);
  lines.push('');

  // ── PART 2 ──
  lines.push('PART 2: DETERMINISTIC AUDITS');
  lines.push(hr2);
  lines.push('');

  // 1. Retriever coverage
  lines.push('1. RETRIEVER COVERAGE');
  for (const [pid, count] of Object.entries(report.part2.retrieverCoverage.countsPerPersona)) {
    const label = pad(PERSONA_LABELS[pid] ?? pid, 30);
    const flag = report.part2.retrieverCoverage.thinPools.includes(pid) ? '  ⚠ THIN POOL' : '';
    lines.push(`   ${label} ${count} candidates${flag}`);
  }
  if (report.part2.retrieverCoverage.apiFailures > 0) {
    lines.push(`   ⚠ API failures: ${report.part2.retrieverCoverage.apiFailures}`);
  }
  lines.push('');

  // 2. Pre-filter integrity
  lines.push('2. PRE-FILTER INTEGRITY');
  lines.push(`   Explored artists reaching LLM pool: ${report.part2.prefilterIntegrity.exploredInLLMPool} ${report.part2.prefilterIntegrity.exploredInLLMPool === 0 ? '✓' : '✗'}`);
  lines.push(`   Duplicates in LLM pool: ${report.part2.prefilterIntegrity.duplicatesInLLMPool} ${report.part2.prefilterIntegrity.duplicatesInLLMPool === 0 ? '✓' : '✗'}`);
  lines.push('   Filter fractions:');
  for (const [key, frac] of Object.entries(report.part2.prefilterIntegrity.filterFractions)) {
    lines.push(`     ${pad(key, 30)} ${(frac * 100).toFixed(1)}%`);
  }
  lines.push('');

  // 3. Hallucination rate (top-line)
  lines.push('3. GROUNDING HALLUCINATION RATE  ← TOP-LINE NUMBER');
  for (const [pid, rate] of Object.entries(report.part2.hallucinationRate.ratesPerPersona)) {
    const label = pad(PERSONA_LABELS[pid] ?? pid, 30);
    const flag = rate > 0.05 ? '  ⚠' : rate > 0 ? '  !' : '  ✓';
    lines.push(`   ${label} ${pct(rate)}${flag}`);
  }
  lines.push(`   ${pad('Overall', 30)} ${pct(report.part2.hallucinationRate.overallRate)}`);
  lines.push(`   Total picks: ${report.part2.hallucinationRate.totalPicks}, Hallucinated: ${report.part2.hallucinationRate.totalHallucinated}`);
  lines.push('');

  // 4. Tier consistency
  lines.push('4. TIER-CONSISTENCY MISMATCH');
  lines.push(`   Overall mismatch rate: ${pct(report.part2.tierConsistency.mismatchRateOverall)}`);
  lines.push('   Per intent:');
  for (const [intent, rate] of Object.entries(report.part2.tierConsistency.mismatchRatePerIntent)) {
    lines.push(`     ${pad(intent, 15)} ${pct(rate)}`);
  }
  lines.push('   Per persona:');
  for (const [pid, rate] of Object.entries(report.part2.tierConsistency.mismatchRatePerPersona)) {
    const label = PERSONA_LABELS[pid] ?? pid;
    lines.push(`     ${pad(label, 25)} ${pct(rate)}`);
  }
  if (report.part2.tierConsistency.mismatches.length > 0) {
    lines.push(`   Sample mismatches (${Math.min(5, report.part2.tierConsistency.mismatches.length)} of ${report.part2.tierConsistency.mismatches.length}):`);
    for (const m of report.part2.tierConsistency.mismatches.slice(0, 5)) {
      lines.push(`     ${m.artist} (${PERSONA_LABELS[m.persona] ?? m.persona}): ${m.distanceIntent} → d=${m.expansionDistance.toFixed(3)} → ${m.reason}`);
    }
  }
  lines.push('');

  // 5. Honesty flags
  lines.push('5. HONESTY FLAGS');
  lines.push(`   shoreBucketFallback: ${report.part2.honestyFlags.shoreBucketFallbackCount}/${report.part2.honestyFlags.totalTraces}`);
  lines.push(`   distanceVarianceCollapsed: ${report.part2.honestyFlags.distanceVarianceCollapsedCount}/${report.part2.honestyFlags.totalTraces}`);
  lines.push(`   leapBucketFallback: ${report.part2.honestyFlags.leapBucketFallbackCount}/${report.part2.honestyFlags.totalTraces}`);
  lines.push('');

  // 6. Explanation groundedness
  lines.push('6. EXPLANATION GROUNDEDNESS');
  lines.push(`   Total checked: ${report.part2.explanationGroundedness.totalChecked}`);
  lines.push(`   Generic explanations: ${report.part2.explanationGroundedness.genericCount} (${pct(report.part2.explanationGroundedness.genericRate)})`);
  if (report.part2.explanationGroundedness.genericExamples.length > 0) {
    lines.push('   Examples:');
    for (const ex of report.part2.explanationGroundedness.genericExamples.slice(0, 3)) {
      lines.push(`     [${PERSONA_LABELS[ex.persona] ?? ex.persona}] ${ex.artist}: "${ex.explanation.slice(0, 80)}..."`);
    }
  }
  lines.push('');

  // ── PART 3 ──
  lines.push('PART 3: LLM-QUALITY AUDITS');
  lines.push(hr2);
  lines.push('');

  // A. Genericness
  lines.push('A. GENERICNESS SCORES (mode collapse risk)');
  lines.push('   Lower is better (0 = no canonical picks, 1 = all canonical)');
  for (const [pid, data] of Object.entries(report.part3.genericness.perPersona)) {
    const label = pad(PERSONA_LABELS[pid] ?? pid, 25);
    const flag = data.genericnessScore > 0.4 ? '  ⚠' : '';
    lines.push(`   ${label} ${data.genericnessScore.toFixed(3)} (${data.canonicalCount}/${data.deepPickCount} canonical)${flag}`);
    if (data.canonicalPicks.length > 0) {
      lines.push(`     Canonical: ${data.canonicalPicks.join(', ')}`);
    }
  }
  lines.push('');

  // B. Cross-persona overlap
  lines.push('B. CROSS-PERSONA OVERLAP');
  lines.push('   Flag for human review — no automatic threshold');
  for (const pair of report.part3.crossPersonaOverlap.pairs) {
    const flag = pair.overlapPercent > 0.3 ? '  ⚠ HIGH' : '';
    lines.push(`   ${pair.personaA} vs ${pair.personaB}:`);
    lines.push(`     Comparison: ${pair.comparison}`);
    lines.push(`     Overlap: ${pct(pair.overlapPercent)}${flag}`);
    if (pair.intersection.length > 0) {
      lines.push(`     Shared: ${pair.intersection.join(', ')}`);
    }
  }
  lines.push('');

  // C. Gateway rubric
  lines.push('C. GATEWAY RUBRIC (Q1-Q4, 1-5 scale)');
  const rubric = report.part3.gatewayRubric;

  // Source breakdown — never hide which scores are real vs fallback
  const llmCount = rubric.perRecommendation.filter((r) => r.source === 'llm-judge').length;
  const heuristicCount = rubric.perRecommendation.filter((r) => r.source === 'heuristic').length;
  lines.push(`   Total scored: ${rubric.perRecommendation.length}`);
  lines.push(`   Source breakdown: ${llmCount} LLM-judge, ${heuristicCount} heuristic`);
  if (heuristicCount > 0 && llmCount === 0) {
    lines.push('   ⚠ ALL scores are heuristic — no LLM judge was used');
  } else if (heuristicCount > 0 && llmCount > 0) {
    lines.push('   ⚠ MIXED sources — averages combine LLM and heuristic scores');
  }
  lines.push('');
  lines.push('   Question averages:');
  lines.push(`     Q1 Representativeness:  ${rubric.averages.representativeness.toFixed(2)}`);
  lines.push(`     Q2 Accessibility:       ${rubric.averages.accessibility.toFixed(2)}`);
  lines.push(`     Q3 Not diluted:         ${rubric.averages.notDiluted.toFixed(2)}`);
  lines.push(`     Q4 Specific reasoning:  ${rubric.averages.specificReasoning.toFixed(2)}`);
  lines.push('');

  // Per-persona rubric breakdown with source flag
  const byPersona = new Map<string, typeof rubric.perRecommendation>();
  for (const r of rubric.perRecommendation) {
    const arr = byPersona.get(r.persona) ?? [];
    arr.push(r);
    byPersona.set(r.persona, arr);
  }
  lines.push('   Per-persona breakdown:');
  for (const [pid, recs] of byPersona) {
    const label = pad(PERSONA_LABELS[pid] ?? pid, 25);
    const avg = (key: 'representativeness' | 'accessibility' | 'notDiluted' | 'specificReasoning') =>
      recs.length > 0
        ? (recs.reduce((s, r) => s + r.score[key], 0) / recs.length).toFixed(2)
        : 'N/A';
    const personaLlm = recs.filter((r) => r.source === 'llm-judge').length;
    const personaHeuristic = recs.filter((r) => r.source === 'heuristic').length;
    const srcTag = personaHeuristic === 0 ? 'LLM' : personaLlm === 0 ? 'HEURISTIC' : 'MIXED';
    lines.push(`     ${label} Q1=${avg('representativeness')} Q2=${avg('accessibility')} Q3=${avg('notDiluted')} Q4=${avg('specificReasoning')} [${srcTag}]`);
  }
  lines.push('');

  // ── PART 4 ──
  lines.push('PART 4: REPEATABILITY');
  lines.push(hr2);
  lines.push('');
  for (const r of report.part4.repeatability) {
    const label = pad(PERSONA_LABELS[r.personaId] ?? r.personaId, 25);
    lines.push(`   ${label} ${r.runCount} runs, avg overlap: ${pct(r.averageOverlap)}`);
    lines.push(`     Pairwise overlaps: [${r.pairwiseOverlaps.map((o) => pct(o)).join(', ')}]`);
  }
  lines.push('');
  lines.push('   Note: Deterministic fallback produces identical results across runs.');
  lines.push('   Real variance testing requires Gemini API key.');
  lines.push('');

  // ── Summary ──
  lines.push(hr);
  lines.push('  SUMMARY');
  lines.push(hr2);
  lines.push(`  Hallucination rate:  ${pct(report.part2.hallucinationRate.overallRate)}`);
  lines.push(`  Tier mismatch:       ${pct(report.part2.tierConsistency.mismatchRateOverall)}`);
  lines.push(`  Genericness (niche):  ${Object.values(report.part3.genericness.perPersona).map((d) => d.genericnessScore.toFixed(2)).join(', ')}`);
  lines.push(`  Rubric Q1-Q4:        ${rubric.averages.representativeness.toFixed(1)} / ${rubric.averages.accessibility.toFixed(1)} / ${rubric.averages.notDiluted.toFixed(1)} / ${rubric.averages.specificReasoning.toFixed(1)}`);
  lines.push(`  Repeatability:        ${report.part4.repeatability.map((r) => pct(r.averageOverlap)).join(', ')}`);
  lines.push(hr);

  return lines.join('\n');
}
