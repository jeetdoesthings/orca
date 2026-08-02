/**
 * Cold-start onboarding + wider frontier policy (Backend Fix Part 10).
 *
 * - Short self-select (genres / seed artists) → rough Identity centroid
 * - Cold-start users get wider, lower-confidence-tolerant candidate pool
 * - API responses include coldStart: true while learning
 */

import { prisma } from '@/lib/prisma';
import type { AudioSignature } from '@/lib/graph/types';
import { ExpansionConfig } from '@/lib/config/expansion';
import { IdentityConfig } from '@/lib/config/identity';
import { synthesizeAudioSignature } from '@/lib/audio/resolve-signature';
import { GENRE_ERA_CENTER } from '@/lib/expansion/cultural-distance';
import { normaliseGenre } from '@/lib/graph/genre-normaliser';
import type { ConfidenceTag } from '@/lib/audio/confidence-tags';
import { normalizeConfidenceTag } from '@/lib/audio/confidence-tags';

export interface ColdStartAssessment {
  coldStart: boolean;
  /** Explored / identity seed artist count */
  identityArtistCount: number;
  /** True when onboarding picks present even if few listens */
  hasOnboarding: boolean;
  reason: string;
}

export interface OnboardingPick {
  /** Genre keys (e.g. house, hip-hop) and/or free labels */
  genres?: string[];
  /** Seed artist names or ids for rough centroid */
  artists?: Array<{ id?: string; name: string; genres?: string[] }>;
}

/**
 * Detect cold-start: little/no listening history and/or only onboarding seeds.
 */
export function assessColdStart(opts: {
  exploredArtistCount: number;
  listeningEventCount?: number;
  profileData?: string | null;
}): ColdStartAssessment {
  const thr = ExpansionConfig.coldStart;
  const hasOnboarding = profileHasOnboarding(opts.profileData);
  const listens = opts.listeningEventCount ?? 0;
  const artists = opts.exploredArtistCount;

  if (artists < thr.minIdentityArtists && listens < thr.minListeningEvents) {
    return {
      coldStart: true,
      identityArtistCount: artists,
      hasOnboarding,
      reason:
        artists === 0 && !hasOnboarding
          ? 'no_identity'
          : 'thin_identity',
    };
  }

  return {
    coldStart: false,
    identityArtistCount: artists,
    hasOnboarding,
    reason: 'established',
  };
}

export function profileHasOnboarding(profileData?: string | null): boolean {
  if (!profileData) return false;
  try {
    const p = JSON.parse(profileData) as { onboarding?: unknown; coldStart?: boolean };
    return Boolean(p.onboarding) || p.coldStart === true;
  } catch {
    return false;
  }
}

/**
 * Build rough centroid from a handful of genre/artist picks (not a quiz).
 */
export function centroidFromOnboardingPicks(picks: OnboardingPick): {
  centroid: AudioSignature;
  genres: string[];
  confidenceTag: ConfidenceTag;
} {
  const genres = (picks.genres ?? [])
    .map((g) => {
      try {
        return normaliseGenre([g]);
      } catch {
        return g.toLowerCase();
      }
    })
    .filter(Boolean);

  const artistGenres = (picks.artists ?? []).flatMap((a) => a.genres ?? []);
  const allGenres = [...new Set([...genres, ...artistGenres])];

  if (allGenres.length === 0 && (picks.artists?.length ?? 0) === 0) {
    return {
      centroid: {
        energy: 0.5,
        valence: 0.5,
        danceability: 0.5,
        acousticness: 0.5,
        instrumentalness: 0.1,
        tempo: 120,
      },
      genres: [],
      confidenceTag: 'low_confidence',
    };
  }

  // Average synthetic signatures from genres + artist names as keys
  const sigs: AudioSignature[] = [];
  for (const g of allGenres.slice(0, 8)) {
    sigs.push(synthesizeAudioSignature(`onboard-genre-${g}`, [g]).signature);
  }
  for (const a of (picks.artists ?? []).slice(0, 8)) {
    const id = a.id || `onboard-${a.name}`;
    const g = a.genres?.length ? a.genres : allGenres.length ? allGenres : ['pop'];
    sigs.push(synthesizeAudioSignature(id, g).signature);
  }

  const n = Math.max(1, sigs.length);
  const centroid: AudioSignature = {
    energy: sigs.reduce((s, x) => s + x.energy, 0) / n,
    valence: sigs.reduce((s, x) => s + x.valence, 0) / n,
    danceability: sigs.reduce((s, x) => s + x.danceability, 0) / n,
    acousticness: sigs.reduce((s, x) => s + x.acousticness, 0) / n,
    instrumentalness: sigs.reduce((s, x) => s + x.instrumentalness, 0) / n,
    tempo: sigs.reduce((s, x) => s + x.tempo, 0) / n,
  };

  return {
    centroid,
    genres: allGenres,
    confidenceTag: 'partial_confidence',
  };
}

/**
 * Confidence tags allowed in frontier for cold-start vs established users.
 * Cold-start accepts low_confidence metadata; established prefer high/partial.
 */
export function allowedConfidenceTags(coldStart: boolean): ConfidenceTag[] {
  if (coldStart) {
    return ['high_confidence', 'partial_confidence', 'low_confidence'];
  }
  return ExpansionConfig.coldStart.establishedAllowedTags.map(normalizeConfidenceTag);
}

/**
 * Whether a candidate confidence tag is allowed under current cold-start policy.
 */
export function isConfidenceAllowedForUser(
  coldStart: boolean,
  tag: string | null | undefined,
): boolean {
  const t = normalizeConfidenceTag(tag ?? 'low_confidence');
  return allowedConfidenceTags(coldStart).includes(t);
}

/**
 * Min frontier size — higher for cold-start (wider pool).
 */
export function minFrontierForUser(coldStart: boolean): number {
  if (coldStart) return ExpansionConfig.coldStart.minFrontierCandidates;
  return ExpansionConfig.minFrontierCandidates;
}

/**
 * Persist onboarding picks into profileData + rough globe seeds.
 * Returns coldStart flag for response.
 */
export async function applyOnboardingPicks(opts: {
  userId: string;
  picks: OnboardingPick;
}): Promise<{
  coldStart: true;
  genres: string[];
  artistCount: number;
  centroid: AudioSignature;
}> {
  const maxG = IdentityConfig.coldStartMaxGenrePicks;
  const maxA = IdentityConfig.coldStartMaxArtistPicks;
  const picks: OnboardingPick = {
    genres: (opts.picks.genres ?? []).slice(0, maxG),
    artists: (opts.picks.artists ?? []).slice(0, maxA),
  };

  const { centroid, genres, confidenceTag } = centroidFromOnboardingPicks(picks);

  // Seed explored nodes from picks (enough for materialize to run)
  const nodes = [];
  for (let i = 0; i < genres.length; i++) {
    const g = genres[i];
    const id = `onboard-genre-seed-${g}`;
    const { signature, source } = synthesizeAudioSignature(id, [g]);
    const era = GENRE_ERA_CENTER[g];
    nodes.push({
      id,
      name: g.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      genres: [g],
      popularity: 40,
      imageUrl: '',
      weight: 0.4 + 0.1 * (1 - i / Math.max(1, genres.length)),
      state: 'explored' as const,
      audioSignature: signature,
      audioSource: source,
      confidenceTag: source,
    });
    void era;
  }
  for (const a of picks.artists ?? []) {
    const id = a.id || `onboard-artist-${a.name.toLowerCase().replace(/\s+/g, '-')}`;
    const g =
      a.genres && a.genres.length > 0
        ? a.genres
        : genres.length > 0
          ? [genres[0]]
          : ['pop'];
    const { signature, source } = synthesizeAudioSignature(id, g);
    nodes.push({
      id,
      name: a.name,
      genres: g,
      popularity: 45,
      imageUrl: '',
      weight: 0.5,
      state: 'explored' as const,
      audioSignature: signature,
      audioSource: source,
      confidenceTag: source,
    });
  }

  // Ensure at least one node so pipeline can run
  if (nodes.length === 0) {
    const { signature, source } = synthesizeAudioSignature('onboard-fallback-pop', ['pop']);
    nodes.push({
      id: 'onboard-fallback-pop',
      name: 'Pop',
      genres: ['pop'],
      popularity: 50,
      imageUrl: '',
      weight: 0.4,
      state: 'explored' as const,
      audioSignature: signature,
      audioSource: source,
      confidenceTag: source,
    });
  }

  const user =
    (await prisma.user.findUnique({ where: { id: opts.userId } })) ??
    (await prisma.user.findUnique({ where: { spotifyId: opts.userId } }));

  if (!user) {
    // Create lightweight user if missing (demo / early onboarding)
    await prisma.user.create({
      data: {
        id: opts.userId,
        spotifyId: opts.userId.startsWith('onboard-') ? opts.userId : `onboard-${opts.userId}`,
        syncStatus: 'COMPLETE',
        globeData: JSON.stringify({ nodes, edges: [] }),
        profileData: JSON.stringify({
          coldStart: true,
          onboarding: {
            genres: picks.genres ?? [],
            artists: (picks.artists ?? []).map((a) => a.name),
            completedAt: new Date().toISOString(),
          },
          audioCentroid: centroid,
          audioCentroidMeta: {
            version: 1,
            updateCount: 0,
            lastUpdatedAt: new Date().toISOString(),
            source: 'onboarding',
            confidenceTag,
          },
        }),
        tasteSummary: `Getting started with ${genres.slice(0, 3).join(', ') || 'new tastes'}`,
      },
    });
  } else {
    let profile: Record<string, unknown> = {};
    try {
      profile = user.profileData ? JSON.parse(user.profileData) : {};
    } catch {
      profile = {};
    }
    profile.coldStart = true;
    profile.onboarding = {
      genres: picks.genres ?? [],
      artists: (picks.artists ?? []).map((a) => a.name),
      completedAt: new Date().toISOString(),
    };
    profile.audioCentroid = centroid;
    profile.audioCentroidMeta = {
      version: 1,
      updateCount: 0,
      lastUpdatedAt: new Date().toISOString(),
      source: 'onboarding',
      confidenceTag,
    };

    await prisma.user.update({
      where: { id: user.id },
      data: {
        globeData: JSON.stringify({ nodes, edges: [] }),
        profileData: JSON.stringify(profile),
        syncStatus: 'COMPLETE',
        tasteSummary: `Getting started with ${genres.slice(0, 3).join(', ') || 'new tastes'}`,
        frontierStatus: 'PENDING',
      },
    });
  }

  return {
    coldStart: true,
    genres,
    artistCount: nodes.length,
    centroid,
  };
}

/**
 * Assess cold-start for a user id (spotifyId or cuid).
 */
export async function assessUserColdStart(userId: string): Promise<ColdStartAssessment> {
  const user =
    (await prisma.user.findUnique({
      where: { id: userId },
      select: { globeData: true, profileData: true, spotifyId: true },
    })) ??
    (await prisma.user.findUnique({
      where: { spotifyId: userId },
      select: { globeData: true, profileData: true, spotifyId: true },
    }));

  if (!user) {
    return {
      coldStart: true,
      identityArtistCount: 0,
      hasOnboarding: false,
      reason: 'no_user',
    };
  }

  let explored = 0;
  try {
    const g = user.globeData ? JSON.parse(user.globeData) : null;
    explored = Array.isArray(g?.nodes) ? g.nodes.length : 0;
  } catch {
    explored = 0;
  }

  let listens = 0;
  try {
    const sid = user.spotifyId ?? userId;
    listens = await prisma.userListeningEvent.count({
      where: { OR: [{ userId: sid }, { userId }] },
    });
  } catch {
    listens = 0;
  }

  const assessment = assessColdStart({
    exploredArtistCount: explored,
    listeningEventCount: listens,
    profileData: user.profileData,
  });

  // Explicit profile flag forces cold-start framing until cleared
  if (profileHasOnboarding(user.profileData) && explored < ExpansionConfig.coldStart.minIdentityArtists * 2) {
    return { ...assessment, coldStart: true, hasOnboarding: true, reason: assessment.reason === 'established' ? 'onboarding_active' : assessment.reason };
  }

  return assessment;
}
