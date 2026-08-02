/**
 * Pipeline runner for the LLM audit.
 *
 * Orchestrates: mock identity → REAL retrieval → REAL LLM → grounding → classify → materialize
 * Identity is synthetic (personas). Retrieval hits Prisma local catalog + MusicBrainz.
 * LLM hits Gemini (when API key set) or deterministic fallback.
 * Grounding + distance/OCSE run real pure functions on real upstream output.
 */
import { retrieveCandidatePool } from '@/lib/retrieval/candidate-retriever';
import { generateLLMRecommendations } from '@/lib/recommendation/llm-engine';
import { groundLLMRecommendations } from '@/lib/recommendation/grounding';
import { classifyAndValidateSurface } from '@/lib/recommendation/classify-surface';
import type { AudioSignature, OrcaNode } from '@/lib/graph/types';
import { synthesizeAudioSignature } from '@/lib/audio/resolve-signature';
import type { PersonaDefinition, PersonaTier, PipelineStageTrace } from './types';
import {
  buildMockIdentity,
  buildMockExploredNodes,
} from './mock-factory';

// ─── Name key helper ──────────────────────────────────────────────────

function nameKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// ─── Spotify access token (client credentials) ────────────────────────

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getSpotifyAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.token;
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) return '';

  try {
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=client_credentials&client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}`,
    });
    if (!res.ok) return '';
    const data = await res.json() as { access_token?: string; expires_in?: number };
    if (!data.access_token) return '';
    cachedToken = {
      token: data.access_token,
      expiresAt: Date.now() + ((data.expires_in ?? 3600) - 60) * 1000,
    };
    return data.access_token;
  } catch {
    return '';
  }
}

// ─── Build user centroid from persona ─────────────────────────────────

function buildUserCentroid(persona: PersonaDefinition): AudioSignature {
  const genreStr = persona.homeTerritory.genres.join(' ');
  const { signature } = synthesizeAudioSignature(`centroid-${persona.id}`, [genreStr]);
  return signature;
}

function buildUserGenreProfile(persona: PersonaDefinition): Map<string, number> {
  const map = new Map<string, number>();
  for (const a of persona.exploredArtists) {
    for (const g of a.genres) {
      map.set(g, (map.get(g) ?? 0) + a.weight);
    }
  }
  return map;
}

// ─── Main pipeline runner ─────────────────────────────────────────────

type RetrievalResult = {
  artists: Awaited<ReturnType<typeof retrieveCandidatePool>>['artists'];
  candidates: Awaited<ReturnType<typeof retrieveCandidatePool>>['candidates'];
};

const retrievalCache = new Map<string, RetrievalResult>();

export async function runPipeline(
  persona: PersonaDefinition,
  tier: PersonaTier,
): Promise<PipelineStageTrace> {
  const errors: string[] = [];

  // 1. Identity (synthetic — personas are always synthetic)
  const identity = buildMockIdentity(persona);

  // 2. Retrieval — REAL: Prisma local catalog + MusicBrainz + optional Spotify enrichment
  let rawRetrieved: Awaited<ReturnType<typeof retrieveCandidatePool>>['artists'] = [];
  let retrievalCandidatePool: Awaited<ReturnType<typeof retrieveCandidatePool>>['candidates'] = [];
  const retrievalApiErrors: string[] = [];
  try {
    const cacheKey = persona.id;
    const cached = retrievalCache.get(cacheKey);
    if (cached) {
      rawRetrieved = cached.artists;
      retrievalCandidatePool = cached.candidates;
    } else {
      const accessToken = await getSpotifyAccessToken();
      const limit = persona.coldStart ? 60 : 220;
      const pool = await retrieveCandidatePool(identity, accessToken, [], limit);
      rawRetrieved = pool.artists;
      retrievalCandidatePool = pool.candidates;
      retrievalCache.set(cacheKey, { artists: pool.artists, candidates: pool.candidates });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    retrievalApiErrors.push(msg);
    errors.push(`retrieval: ${msg}`);
  }

  // 3. Pre-filter (identity-level dedup — retrieval already does most of this)
  const knownNames = new Set([
    ...identity.integratedArtists.map((a) => nameKey(a.name)),
    ...identity.currentFrontier.map((a) => nameKey(a.name)),
  ]);
  const blockedIds = new Set([
    ...identity.integratedArtists.map((a) => a.id),
    ...identity.ignoredArtists.map((a) => a.id),
    ...identity.rejectedArtists.map((a) => a.id),
  ]);
  const filteredOut: Array<{ artistId: string; name: string; reason: string }> = [];
  const seen = new Set<string>();
  const filtered = rawRetrieved.filter((r) => {
    const nk = nameKey(r.canonicalName);
    const id = r.spotifyId || r.musicBrainzId || '';
    if (knownNames.has(nk)) { filteredOut.push({ artistId: id, name: r.canonicalName, reason: 'already_explored' }); return false; }
    if (blockedIds.has(id)) { filteredOut.push({ artistId: id, name: r.canonicalName, reason: 'blocked_id' }); return false; }
    if (seen.has(nk)) { filteredOut.push({ artistId: id, name: r.canonicalName, reason: 'duplicate' }); return false; }
    seen.add(nk);
    return true;
  });

  // 4. LLM — REAL: calls Gemini when GEMINI_API_KEY is set, deterministic fallback otherwise
  const tierGoal = tier === 'comfort'
    ? 'Recommend shore-tier artists: same genre, deep cuts, comfort zone expansions.'
    : tier === 'expansion'
      ? 'Recommend expansion-tier artists: adjacent genres, territory neighbors, moderate novelty.'
      : 'Recommend leap-tier artists: far territory, genre-defying jumps, maximum novelty.';

  let llmResult: Awaited<ReturnType<typeof generateLLMRecommendations>> = {
    recommendations: [],
    model: 'not-started',
    promptVersion: 'audit-v2',
    validationErrors: [],
  };
  try {
    llmResult = await generateLLMRecommendations({
      identity,
      knownArtistIds: identity.integratedArtists.map((a) => a.id),
      ignoredArtistIds: identity.ignoredArtists.map((a) => a.id),
      rejectedArtistIds: identity.rejectedArtists.map((a) => a.id),
      integratedArtistIds: identity.integratedArtists.map((a) => a.id),
      currentFrontierIds: identity.currentFrontier.map((a) => a.id),
      goals: [
        tierGoal,
        `Listener explores: ${identity.homeTerritory.genres.slice(0, 6).join(', ')}. Primary genre: ${identity.homeTerritory.primaryGenre ?? 'unknown'}.`,
        `Listener has ${identity.exploredTerritory.artistCount} explored artists. Drift score: ${identity.tasteDrift.driftScore}.`,
      ],
      candidatePool: filtered,
      count: tier === 'comfort' ? 20 : tier === 'expansion' ? 25 : 15,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`llm: ${msg}`);
  }

  // 5. Grounding — REAL pure function on real LLM output
  const recommendations = llmResult.recommendations;
  const knownIds = new Set(identity.integratedArtists.map((a) => a.id));
  const ignoredIds = new Set(identity.ignoredArtists.map((a) => a.id));
  const rejectedIds = new Set(identity.rejectedArtists.map((a) => a.id));
  const integratedIds = new Set(identity.integratedArtists.map((a) => a.id));
  const knownNameSet = new Set(identity.integratedArtists.map((a) => nameKey(a.name)));

  const verified = await groundLLMRecommendations({
    recommendations,
    candidatePool: filtered,
    candidates: retrievalCandidatePool,
    knownIds,
    ignoredIds,
    rejectedIds,
    integratedIds,
    knownNames: knownNameSet,
  });

  // 6. Distance / OCSE — REAL pure function
  const exploredNodes: OrcaNode[] = buildMockExploredNodes(persona);
  const userCentroid = buildUserCentroid(persona);
  const userGenreProfile = buildUserGenreProfile(persona);

  const { candidates: classified, surface } = classifyAndValidateSurface({
    userId: `audit-${persona.id}`,
    identity,
    verified,
    candidates: retrievalCandidatePool,
    exploredArtists: exploredNodes,
    userCentroid,
    userGenreProfile,
    realAudioById: new Map(),
    explicitTier: tier,
  });

  // 7. Materialize — extract surfaces
  const extractMaterialized = (profiles: typeof surface.comfort) =>
    profiles.map((p) => {
      const c = classified.find((x) => x.artistId === p.candidateId);
      return {
        artist: c?.name ?? p.candidateId,
        explanation: p.explanation?.[0] ?? '',
        genres: c?.genres ?? [],
      };
    });

  // Tier-consistency check
  const mismatches = verified
    .filter((v) => v.accepted)
    .map((v) => {
      const c = classified.find((x) => x.artistId === v.canonicalId);
      const dist = c?.expansionDistance ?? 0;
      const intent = v.recommendation.distanceIntent;
      const assignedBucket =
        dist < 0.34 ? 'comfort' : dist < 0.67 ? 'expansion' : 'leap';
      const expectedBucket =
        intent === 'Shore' ? 'comfort' : intent === 'Shallow' ? 'expansion' : 'leap';
      return {
        artist: v.recommendation.artist,
        distanceIntent: intent,
        expansionDistance: dist,
        assignedBucket,
        mismatch: assignedBucket !== expectedBucket,
      };
    });

  return {
    personaId: persona.id,
    tier,
    identity: {
      identity,
      artistCount: identity.integratedArtists.length,
      homeGenres: identity.homeTerritory.genres,
    },
    retrieval: {
      rawRetrieved,
      rawCandidateCount: rawRetrieved.length,
      apiErrors: retrievalApiErrors,
    },
    prefilter: {
      inputCount: rawRetrieved.length,
      outputCount: filtered.length,
      filteredOut,
      filterFraction: rawRetrieved.length > 0 ? filteredOut.length / rawRetrieved.length : 0,
    },
    llm: {
      result: {
        recommendations,
        model: llmResult.model,
        promptVersion: llmResult.promptVersion,
        validationErrors: [...llmResult.validationErrors, ...errors],
      },
      pickCount: recommendations.length,
      validationErrors: [...llmResult.validationErrors, ...errors],
      requestedTier: tier,
    },
    grounding: {
      verified,
      acceptedCount: verified.filter((v) => v.accepted).length,
      rejectedCount: verified.filter((v) => !v.accepted).length,
      rejections: verified
        .filter((v) => !v.accepted)
        .map((v) => ({ artist: v.recommendation.artist, reasons: v.rejectionReasons })),
    },
    distance: {
      surface,
      candidates: classified,
      bucketCounts: {
        comfort: surface.comfort.length,
        expansion: surface.expansion.length,
        leap: surface.leap.length,
      },
      mismatches,
    },
    materialized: {
      comfort: extractMaterialized(surface.comfort),
      expansion: extractMaterialized(surface.expansion),
      leap: extractMaterialized(surface.leap),
    },
  };
}

// ─── Run all 8 personas × 3 tiers ─────────────────────────────────────

/**
 * Run all 8 personas × 3 tiers.
 * runPipeline caches retrieval per persona, so MusicBrainz/Prisma is hit
 * only 8 times total (not 24).
 */
export async function runAllPipelines(): Promise<PipelineStageTrace[]> {
  const tiers: PersonaTier[] = ['comfort', 'expansion', 'leap'];
  const traces: PipelineStageTrace[] = [];

  // Import personas here to avoid circular deps
  const { PERSONAS } = await import('./personas');

  for (const persona of PERSONAS) {
    for (const tier of tiers) {
      const trace = await runPipeline(persona, tier);
      traces.push(trace);
    }
  }

  return traces;
}
