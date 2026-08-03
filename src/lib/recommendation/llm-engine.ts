/**
 * LLM taste-expansion assessment
 *
 * Verdict: using an LLM is wise for explanation quality, territory framing,
 * and turning deterministic evidence into a coherent musical journey. It is
 * not wise as the primary ranking or sorting mechanism. Ranking should remain
 * deterministic, grounded in retrieved candidates, relationship evidence,
 * availability, novelty, and user-state filters.
 *
 * Risks: the Gemini request currently sits on the materialization critical path,
 * so 3-15s model latency directly blocks frontier construction. Free-tier quota
 * is also tiny. When quota is exhausted, the system silently degrades to the
 * deterministic fallback, which preserves function but changes explanation and
 * ordering behavior without user-visible intent.
 *
 * Recommendation: treat the LLM as optional and cached enrichment, not a blocking
 * dependency for recommendation correctness. The deterministic engine should be
 * able to materialize immediately. LLM calls should be skipped when unavailable
 * or quota-exhausted, capped by a short timeout, grounded against the candidate
 * pool, and cached per identity/candidate/goals signature.
 */
import { createHash } from 'node:crypto';
import type { TasteIdentity } from '@/lib/identity/orca-identity';
import type { RetrievedArtist } from '@/lib/retrieval/types';

export interface LLMRecommendation {
  artistId?: string;
  musicBrainzId?: string;
  spotifyId?: string;
  artist: string;
  rank: number;
  distanceIntent: 'Shore' | 'Shallow' | 'Deep';
  gatewayPath: string[];
  territoryFraming: string;
  explanation: string;
  albumSuggestions: string[];
  evidenceIds: string[];
}

export interface LLMRecommendationResult {
  recommendations: LLMRecommendation[];
  model: string;
  promptVersion: string;
  raw?: unknown;
  validationErrors: string[];
}

export interface GenerateRecommendationInput {
  identity: TasteIdentity;
  knownArtistIds: string[];
  ignoredArtistIds: string[];
  rejectedArtistIds: string[];
  integratedArtistIds: string[];
  currentFrontierIds: string[];
  goals: string[];
  candidatePool: RetrievedArtist[];
  count?: number;
}

const PROMPT_VERSION = 'orca-llm-recommendation-v1';
const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const GEMINI_TIMEOUT_MS = 15_000;
const LLM_CANDIDATE_LIMIT = 50;
const recommendationCache = new Map<string, LLMRecommendationResult>();

function candidateId(c: RetrievedArtist): string {
  return c.spotifyId || c.musicBrainzId || c.canonicalName;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function recommendationCacheKey(input: GenerateRecommendationInput): string {
  return createHash('sha256')
    .update(stableStringify({
      identity: input.identity,
      candidateIds: input.candidatePool.map(candidateId),
      goals: input.goals,
      count: input.count ?? null,
      promptVersion: PROMPT_VERSION,
      model: DEFAULT_MODEL,
    }))
    .digest('hex');
}

function deterministicFallback(input: GenerateRecommendationInput): LLMRecommendationResult {
  const blocked = new Set([
    ...input.knownArtistIds,
    ...input.ignoredArtistIds,
    ...input.rejectedArtistIds,
    ...input.integratedArtistIds,
    ...input.currentFrontierIds,
  ]);
  const available = input.candidatePool.filter((c) => !blocked.has(candidateId(c)));
  console.log(`[LLM Fallback] ${input.candidatePool.length} pool, ${blocked.size} blocked, ${available.length} available`);
  const recs = available
    .slice(0, input.count ?? 90)
    .map((c, i) => ({
      artistId: candidateId(c),
      musicBrainzId: c.musicBrainzId,
      spotifyId: c.spotifyId,
      artist: c.canonicalName,
      rank: i + 1,
      distanceIntent: i % 5 === 0 ? 'Deep' : i % 2 === 0 ? 'Shallow' : 'Shore',
      gatewayPath: c.relationships.map((r) => r.artistName).slice(0, 3),
      territoryFraming: c.sourceTerritory || c.genres[0] || 'adjacent territory',
      explanation: 'Grounded deterministic fallback from verified retrieval evidence.',
      albumSuggestions: c.releases.map((r) => r.title).slice(0, 2),
      evidenceIds: c.evidence.map((e) => e.id || e.source).filter(Boolean),
    } satisfies LLMRecommendation));
  return {
    recommendations: recs,
    model: 'deterministic-fallback',
    promptVersion: PROMPT_VERSION,
    validationErrors: [],
  };
}

interface RawLLMOutput {
  recommendations?: Array<{
    artistId?: string;
    artist?: string;
    rank?: number;
    distanceIntent?: string;
    gatewayPath?: string[];
    territoryFraming?: string;
    explanation?: string;
    albumSuggestions?: string[];
    evidenceIds?: string[];
    musicBrainzId?: string;
    spotifyId?: string;
  }>;
}

function validateRecommendations(raw: RawLLMOutput, input: GenerateRecommendationInput): {
  recommendations: LLMRecommendation[];
  errors: string[];
} {
  const errors: string[] = [];
  const items = Array.isArray(raw?.recommendations) ? raw.recommendations : [];
  if (!Array.isArray(raw?.recommendations)) errors.push('Missing recommendations array');
  const candidateIds = new Set(input.candidatePool.map(candidateId));
  const candidateNames = new Set(input.candidatePool.map((c) => c.canonicalName.toLowerCase()));
  const blocked = new Set([
    ...input.knownArtistIds,
    ...input.ignoredArtistIds,
    ...input.rejectedArtistIds,
    ...input.integratedArtistIds,
    ...input.currentFrontierIds,
  ]);
  const seen = new Set<string>();
  const recs: LLMRecommendation[] = [];

  for (const item of items) {
    const id = String(item.artistId || item.spotifyId || item.musicBrainzId || '');
    const artist = String(item.artist || '');
    const key = id || artist.toLowerCase();
    if (!artist) errors.push('Recommendation missing artist');
    if (!id && !candidateNames.has(artist.toLowerCase())) {
      errors.push(`Hallucinated artist outside candidate pool: ${artist}`);
      continue;
    }
    if (id && !candidateIds.has(id)) {
      errors.push(`Unknown candidate id: ${id}`);
      continue;
    }
    if (blocked.has(id)) {
      errors.push(`Blocked/known artist returned: ${id}`);
      continue;
    }
    if (seen.has(key)) {
      errors.push(`Duplicate recommendation: ${key}`);
      continue;
    }
    seen.add(key);
    const distanceIntent: 'Shore' | 'Shallow' | 'Deep' =
      item.distanceIntent === 'Shore' || item.distanceIntent === 'Shallow' || item.distanceIntent === 'Deep'
        ? item.distanceIntent
        : 'Shallow';
    recs.push({
      artistId: id || undefined,
      musicBrainzId: item.musicBrainzId ? String(item.musicBrainzId) : undefined,
      spotifyId: item.spotifyId ? String(item.spotifyId) : undefined,
      artist,
      rank: Number.isFinite(Number(item.rank)) ? Number(item.rank) : recs.length + 1,
      distanceIntent,
      gatewayPath: Array.isArray(item.gatewayPath) ? item.gatewayPath.map(String).slice(0, 5) : [],
      territoryFraming: String(item.territoryFraming || ''),
      explanation: String(item.explanation || ''),
      albumSuggestions: Array.isArray(item.albumSuggestions)
        ? item.albumSuggestions.map(String).slice(0, 4)
        : [],
      evidenceIds: Array.isArray(item.evidenceIds) ? item.evidenceIds.map(String) : [],
    });
  }
  return { recommendations: recs, errors };
}

function buildPrompt(input: GenerateRecommendationInput) {
  const candidates = input.candidatePool.slice(0, LLM_CANDIDATE_LIMIT).map((c) => ({
    id: candidateId(c),
    musicBrainzId: c.musicBrainzId,
    spotifyId: c.spotifyId,
    name: c.canonicalName,
    aliases: c.aliases,
    genres: c.genres,
    tags: c.tags,
    releases: c.releases.slice(0, 2),
    relationships: c.relationships.slice(0, 4),
    popularity: c.popularity,
    availability: c.availability,
    evidenceIds: c.evidence.map((e) => e.id || e.source),
  }));
  return JSON.stringify({
    promptVersion: PROMPT_VERSION,
    identity: input.identity,
    goals: input.goals,
    blocked: {
      knownArtistIds: input.knownArtistIds,
      ignoredArtistIds: input.ignoredArtistIds,
      rejectedArtistIds: input.rejectedArtistIds,
      integratedArtistIds: input.integratedArtistIds,
      currentFrontierIds: input.currentFrontierIds,
    },
    candidatePool: candidates,
    output: {
      recommendations: [
        {
          artistId: 'candidate id',
          artist: 'canonical name',
          rank: 1,
          distanceIntent: 'Shore | Shallow | Deep',
          gatewayPath: ['known or related artist names'],
          territoryFraming: 'short territory narrative',
          explanation: 'why this expands taste',
          albumSuggestions: ['album title'],
          evidenceIds: ['source evidence id'],
        },
      ],
    },
  });
}

const SYSTEM_INSTRUCTION = 'Expand musical taste, not engagement. Avoid Spotify recommendations and popularity bias. Never invent artists; choose only from the candidate pool. Avoid already-known, ignored, rejected, or integrated artists. Prefer gateway artists and coherent journeys over isolated similar picks. Include historically important and niche artists when justified. Avoid obvious clones and impossible jumps. Return JSON only.';

// ─── Gemini quota tracker ────────────────────────────────────────────
// Free tier: 20 requests/day. Track per-process to avoid burning quota on
// retries. Once a 429 quota error is received, skip Gemini for the rest
// of the process lifetime.
let geminiQuotaExhausted = false;
let geminiCallCount = 0;

export function resetGeminiQuota(): void {
  geminiQuotaExhausted = false;
  geminiCallCount = 0;
}

export function getGeminiCallStats(): { count: number; exhausted: boolean } {
  return { count: geminiCallCount, exhausted: geminiQuotaExhausted };
}

export function isGeminiQuotaExhausted(): boolean {
  return geminiQuotaExhausted;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const RESPONSE_SCHEMA = {
  type: 'object' as const,
  properties: {
    recommendations: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          artistId: { type: 'string' as const },
          artist: { type: 'string' as const },
          rank: { type: 'number' as const },
          distanceIntent: { type: 'string' as const, enum: ['Shore', 'Shallow', 'Deep'] },
          gatewayPath: { type: 'array' as const, items: { type: 'string' as const } },
          territoryFraming: { type: 'string' as const },
          explanation: { type: 'string' as const },
          albumSuggestions: { type: 'array' as const, items: { type: 'string' as const } },
          evidenceIds: { type: 'array' as const, items: { type: 'string' as const } },
        },
        required: [
          'artistId',
          'artist',
          'rank',
          'distanceIntent',
          'gatewayPath',
          'territoryFraming',
          'explanation',
          'albumSuggestions',
          'evidenceIds',
        ],
      },
    },
  },
  required: ['recommendations'],
};

interface GeminiPart {
  text?: string;
}

interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

interface GeminiGenerateContentResponse {
  candidates?: Array<{
    content?: {
      parts?: GeminiPart[];
      role?: string;
    };
    finishReason?: string;
  }>;
  error?: { message?: string; code?: number };
}

async function callGemini(input: GenerateRecommendationInput): Promise<RawLLMOutput> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');
  if (geminiQuotaExhausted) throw new Error('Gemini quota exhausted — deterministic fallback');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_MODEL}:generateContent?key=${apiKey}`;

  const contents: GeminiContent[] = [
    {
      role: 'user',
      parts: [{ text: buildPrompt(input) }],
    },
  ];

  const maxRetries = 0;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = attempt === 1 ? 5_000 : 15_000;
      await sleep(delay);
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
          contents,
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: RESPONSE_SCHEMA,
            temperature: 0.7,
            maxOutputTokens: 16384,
          },
        }),
      }).finally(() => clearTimeout(timeout));

      if (res.status === 429 || res.status === 503) {
        const body = await res.text().catch(() => '');

        // Detect daily quota exhaustion — abort immediately, no retries
        if (body.includes('PerDay') || body.includes('RESOURCE_EXHAUSTED')) {
          geminiQuotaExhausted = true;
          console.warn(`[LLM] Gemini daily quota exhausted after ${geminiCallCount} calls — using deterministic fallback`);
          throw new Error('Gemini daily quota exhausted');
        }

        console.warn(`[LLM] Gemini ${res.status} (attempt ${attempt + 1}/${maxRetries + 1})`);
        lastError = new Error(`Gemini API ${res.status}`);
        continue;
      }

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Gemini API failed: ${res.status} ${body}`);
      }

      const data: GeminiGenerateContentResponse = await res.json();
      if (data.error) throw new Error(`Gemini error: ${data.error.message ?? data.error.code}`);

      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error('Gemini returned empty response');
      geminiCallCount++;
      return JSON.parse(text) as RawLLMOutput;
    } catch (err) {
      if (err instanceof Error && err.message === 'Gemini daily quota exhausted') throw err;
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt === maxRetries) break;
    }
  }

  throw lastError ?? new Error('Gemini call failed after retries');
}

export async function generateLLMRecommendations(
  input: GenerateRecommendationInput,
): Promise<LLMRecommendationResult> {
  if (!process.env.GEMINI_API_KEY) return deterministicFallback(input);
  if (geminiQuotaExhausted) return deterministicFallback(input);

  const cacheKey = recommendationCacheKey(input);
  const cached = recommendationCache.get(cacheKey);
  if (cached) {
    return {
      ...cached,
      recommendations: cached.recommendations.map((rec) => ({ ...rec })),
      validationErrors: [...cached.validationErrors],
    };
  }

  try {
    const first = await callGemini(input);
    const firstValidation = validateRecommendations(first, input);
    if (firstValidation.errors.length === 0) {
      const result = {
        recommendations: firstValidation.recommendations,
        model: DEFAULT_MODEL,
        promptVersion: PROMPT_VERSION,
        raw: first,
        validationErrors: [],
      };
      recommendationCache.set(cacheKey, result);
      return result;
    }

    try {
      const retry = await callGemini({
        ...input,
        goals: [
          ...input.goals,
          `Fix these validation errors and return only valid candidate-pool artists: ${firstValidation.errors.join('; ')}`,
        ],
      });
      const retryValidation = validateRecommendations(retry, input);
      if (retryValidation.errors.length === 0) {
        const result = {
          recommendations: retryValidation.recommendations,
          model: DEFAULT_MODEL,
          promptVersion: PROMPT_VERSION,
          raw: retry,
          validationErrors: firstValidation.errors,
        };
        recommendationCache.set(cacheKey, result);
        return result;
      }
      return {
        ...deterministicFallback(input),
        validationErrors: [...firstValidation.errors, ...retryValidation.errors],
      };
    } catch (retryErr) {
      return {
        ...deterministicFallback(input),
        validationErrors: [
          ...firstValidation.errors,
          retryErr instanceof Error ? retryErr.message : String(retryErr),
        ],
      };
    }
  } catch (err) {
    console.warn('[LLM] Gemini call failed, using deterministic fallback:', err instanceof Error ? err.message : err);
    return {
      ...deterministicFallback(input),
      validationErrors: [err instanceof Error ? err.message : String(err)],
    };
  }
}

export const __test__ = { validateRecommendations, deterministicFallback, candidateId };
