/**
 * LLM-as-judge for gateway rubric (Part 3).
 *
 * When GEMINI_API_KEY is set: calls Gemini with a structured judge prompt.
 * When not set: heuristic scoring based on candidate metadata.
 *
 * Q1: Representativeness (1-5) — genuinely representative entry point?
 * Q2: Accessibility (1-5) — accessible enough for first exposure?
 * Q3: Not diluted (1-5) — avoids "safe for outsiders" crossover?
 * Q4: Specific reasoning (1-5) — references persona's actual taste?
 */
import type { PipelineStageTrace, RubricScore, GatewayRubricAudit } from './types';

// ─── Heuristic scoring (no LLM) ──────────────────────────────────────

function heuristicScore(
  rec: { artist: string; genres: string[]; explanation: string },
  trace: PipelineStageTrace,
): RubricScore {
  const explanation = rec.explanation.toLowerCase();
  const genres = rec.genres.map((g) => g.toLowerCase());
  const homeGenres = trace.identity.homeGenres.map((g) => g.toLowerCase());

  // Q1: Representativeness — check if genres overlap with target territory
  // Higher score if artist is in the right genre cluster
  const genreOverlap = genres.filter((g) =>
    homeGenres.some((hg) => hg === g || hg.includes(g) || g.includes(hg)),
  ).length;
  const q1 = genreOverlap > 0 ? Math.min(5, 3 + genreOverlap) : 2;

  // Q2: Accessibility — check if Spotify available + popularity in reasonable range
  // (pop info not directly in materialized trace, use genres as proxy)
  const isAccessible = genres.some((g) =>
    ['pop', 'indie', 'electronic', 'rock', 'rnb', 'soul', 'hip hop'].includes(g),
  );
  const q2 = isAccessible ? 4 : 3;

  // Q3: Not diluted — check if explanation references crossover terms
  const crossoverTerms = ['mainstream', 'popular', 'crossover', 'accessible version', 'safe'];
  const hasCrossover = crossoverTerms.some((t) => explanation.includes(t));
  const q3 = hasCrossover ? 2 : 4;

  // Q4: Specific reasoning — check if explanation references specific persona data
  const specificTerms = [
    ...homeGenres,
    trace.identity.identity.homeTerritory.primaryGenre ?? '',
    'your', 'your taste', 'your listening', 'from your',
    'connection to', 'bridge from', 'expands from',
  ];
  const specificityCount = specificTerms.filter((t) => explanation.includes(t.toLowerCase())).length;
  const q4 = Math.min(5, 2 + specificityCount);

  return {
    representativeness: Math.max(1, Math.min(5, q1)),
    accessibility: Math.max(1, Math.min(5, q2)),
    notDiluted: Math.max(1, Math.min(5, q3)),
    specificReasoning: Math.max(1, Math.min(5, q4)),
  };
}

// ─── LLM judge via Gemini ─────────────────────────────────────────────

// Track quota exhaustion within judge to avoid hammering Gemini with 429s
let judgeQuotaExhausted = false;

const JUDGE_SYSTEM = `You are an independent music recommendation evaluator. You are NOT the system that generated the recommendation. Score each recommendation on four criteria, each 1-5. Be strict and specific. Return JSON only.`;

function buildJudgePrompt(
  rec: { artist: string; genres: string[]; explanation: string; territoryFraming: string },
  trace: PipelineStageTrace,
): string {
  return JSON.stringify({
    task: 'Score this music recommendation on four criteria (1-5 each).',
    persona: {
      homeGenres: trace.identity.homeGenres,
      primaryGenre: trace.identity.identity.homeTerritory.primaryGenre,
      exploredCount: trace.identity.artistCount,
      driftScore: trace.identity.identity.tasteDrift.driftScore,
    },
    recommendation: {
      artist: rec.artist,
      genres: rec.genres,
      explanation: rec.explanation,
      territoryFraming: rec.territoryFraming,
    },
    questions: {
      Q1_representativeness: 'Is this a genuinely representative entry point into its stated territory, not an outlier?',
      Q2_accessibility: 'Is it accessible enough to be a reasonable first exposure, rather than requiring prior context?',
      Q3_not_diluted: 'Does it avoid being a diluted/crossover/"safe for outsiders" version of the target scene?',
      Q4_specific_reasoning: 'Does the reasoning reference something specific about the persona\'s actual taste profile?',
    },
    output: {
      Q1: 'number 1-5',
      Q2: 'number 1-5',
      Q3: 'number 1-5',
      Q4: 'number 1-5',
    },
  });
}

async function llmJudgeScore(
  rec: { artist: string; genres: string[]; explanation: string; territoryFraming: string },
  trace: PipelineStageTrace,
): Promise<RubricScore | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'your-gemini-api-key-here') return null;
  if (judgeQuotaExhausted) return null;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: JUDGE_SYSTEM }] },
        contents: [{ role: 'user', parts: [{ text: buildJudgePrompt(rec, trace) }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.1,
          maxOutputTokens: 500,
        },
      }),
    });

    if (res.status === 429 || res.status === 503) {
      judgeQuotaExhausted = true;
      return null;
    }
    if (!res.ok) return null;
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return null;

    const parsed = JSON.parse(text);
    return {
      representativeness: clamp15(parsed.Q1),
      accessibility: clamp15(parsed.Q2),
      notDiluted: clamp15(parsed.Q3),
      specificReasoning: clamp15(parsed.Q4),
    };
  } catch {
    return null;
  }
}

function clamp15(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 3;
  return Math.max(1, Math.min(5, Math.round(n)));
}

// ─── Main audit runner ────────────────────────────────────────────────

export async function auditGatewayRubric(
  traces: PipelineStageTrace[],
): Promise<GatewayRubricAudit> {
  const perRecommendation: GatewayRubricAudit['perRecommendation'] = [];
  const hasLLM = !!(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'your-gemini-api-key-here');

  for (const t of traces) {
    // Only score leap/expansion tier recs
    const recsToScore = [
      ...t.materialized.leap.map((r) => ({ ...r, tier: 'leap' })),
      ...t.materialized.expansion.map((r) => ({ ...r, tier: 'expansion' })),
    ];

    for (const rec of recsToScore) {
      let score: RubricScore;
      let source: 'llm-judge' | 'heuristic';

      if (hasLLM) {
        const llmScore = await llmJudgeScore(
          {
            artist: rec.artist,
            genres: rec.genres,
            explanation: rec.explanation,
            territoryFraming: rec.genres[0] ?? '',
          },
          t,
        );
        if (llmScore) {
          score = llmScore;
          source = 'llm-judge';
        } else {
          score = heuristicScore(rec, t);
          source = 'heuristic';
        }
      } else {
        score = heuristicScore(rec, t);
        source = 'heuristic';
      }

      perRecommendation.push({
        persona: t.personaId,
        tier: rec.tier,
        artist: rec.artist,
        score,
        source,
      });
    }
  }

  // Compute averages
  const n = perRecommendation.length || 1;
  const sums = { representativeness: 0, accessibility: 0, notDiluted: 0, specificReasoning: 0 };
  for (const r of perRecommendation) {
    sums.representativeness += r.score.representativeness;
    sums.accessibility += r.score.accessibility;
    sums.notDiluted += r.score.notDiluted;
    sums.specificReasoning += r.score.specificReasoning;
  }

  const averages: RubricScore = {
    representativeness: Math.round((sums.representativeness / n) * 100) / 100,
    accessibility: Math.round((sums.accessibility / n) * 100) / 100,
    notDiluted: Math.round((sums.notDiluted / n) * 100) / 100,
    specificReasoning: Math.round((sums.specificReasoning / n) * 100) / 100,
  };

  const perQuestionAverages = {
    representativeness: averages.representativeness,
    accessibility: averages.accessibility,
    notDiluted: averages.notDiluted,
    specificReasoning: averages.specificReasoning,
  };

  return {
    perRecommendation,
    averages,
    perQuestionAverages,
  };
}
