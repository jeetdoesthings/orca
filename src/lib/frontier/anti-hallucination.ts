/**
 * Anti-hallucination gate for frontier materialization (§3.6 analog).
 *
 * Runs after buildFrontierNodes and before frontierData is written.
 * Drops candidates that fail structural identity checks so the UI never
 * shows invented ids, nameless stubs, or pure default-pop tags with no
 * catalog grounding.
 *
 * Product ranking (EI distance / OCSE) is unchanged — this is a hard filter.
 */

import type { OrcaNode } from '@/lib/graph/types';
import { prisma } from '@/lib/prisma';

const MUSICBRAINZ_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Spotify base62 (~22), MusicBrainz UUID, or ORCA-prefixed multi-provider ids. */
export function isValidArtistIdFormat(id: string): boolean {
  if (!id || typeof id !== 'string') return false;
  if (
    id.startsWith('spotify-') ||
    id.startsWith('lastfm-') ||
    id.startsWith('musicbrainz-') ||
    id.startsWith('deezer-')
  ) {
    return id.length >= 8 && id.length <= 80;
  }
  // MusicBrainz artist MBIDs (stored bare in Artist.id for some catalog rows)
  if (MUSICBRAINZ_UUID.test(id)) return true;
  // Spotify catalog ids are typically 22 base62 chars; allow a small band.
  return /^[0-9A-Za-z]{15,30}$/.test(id);
}

export function isMusicBrainzUuid(id: string): boolean {
  return MUSICBRAINZ_UUID.test(id);
}

export function hasDisplayName(node: Pick<OrcaNode, 'name'>): boolean {
  const n = (node.name || '').trim();
  if (n.length < 1) return false;
  // Reject placeholder-ish names that slipped through generation
  const lower = n.toLowerCase();
  if (lower === 'unknown' || lower === 'unknown artist' || lower === 'null' || lower === 'undefined') {
    return false;
  }
  return true;
}

/**
 * Genre tags count as grounded when:
 * - non-empty after trim, AND
 * - not the single lazy default "pop" with zero other evidence, OR
 * - pop is allowed if the node has a real image / high popularity (likely real pop act).
 *
 * Pure default-pop with no image and low popularity is treated as ungrounded.
 */
export function hasGroundedGenres(
  node: Pick<OrcaNode, 'genres' | 'imageUrl' | 'popularity'>,
): boolean {
  const genres = (node.genres || []).map((g) => String(g).trim().toLowerCase()).filter(Boolean);
  if (genres.length === 0) return false;

  const onlyPop = genres.every((g) => g === 'pop');
  if (!onlyPop) return true;

  // only "pop": require some other grounding signal
  const hasImage = Boolean(node.imageUrl && node.imageUrl.length > 8);
  const popularEnough = (node.popularity ?? 0) >= 40;
  return hasImage || popularEnough;
}

export type HallucinationRejectReason =
  | 'invalid_id'
  | 'missing_name'
  | 'ungrounded_genres'
  | 'not_in_catalog';

export interface HallucinationCheckResult {
  accepted: OrcaNode[];
  rejected: Array<{ id: string; name?: string; reasons: HallucinationRejectReason[] }>;
}

/**
 * Pure structural checks (no DB). Used by unit tests and as the first pass.
 */
export function filterHallucinatedNodesPure(nodes: OrcaNode[]): HallucinationCheckResult {
  const accepted: OrcaNode[] = [];
  const rejected: HallucinationCheckResult['rejected'] = [];

  for (const node of nodes) {
    const reasons: HallucinationRejectReason[] = [];
    if (!isValidArtistIdFormat(node.id)) reasons.push('invalid_id');
    if (!hasDisplayName(node)) reasons.push('missing_name');
    if (!hasGroundedGenres(node)) reasons.push('ungrounded_genres');

    if (reasons.length > 0) {
      rejected.push({ id: node.id, name: node.name, reasons });
    } else {
      accepted.push(node);
    }
  }

  return { accepted, rejected };
}

/**
 * Full gate: pure structural + catalog existence for ids that look real.
 *
 * Catalog rule:
 * - Prefixed demo/multi-provider ids (spotify-, lastfm-, …) may exist only in memory —
 *   they pass if pure checks pass (demo path).
 * - Bare Spotify-shaped ids must exist in Artist table (by id or spotifyId)
 *   OR already carry a non-empty imageUrl from a live provider response.
 */
export async function filterHallucinatedNodes(nodes: OrcaNode[]): Promise<HallucinationCheckResult> {
  const first = filterHallucinatedNodesPure(nodes);
  if (first.accepted.length === 0) return first;

  // Catalog-check bare Spotify ids + MusicBrainz UUIDs (hyphenated).
  const catalogIds = first.accepted
    .map((n) => n.id)
    .filter(
      (id) =>
        (!id.includes('-') && /^[0-9A-Za-z]{15,30}$/.test(id)) ||
        MUSICBRAINZ_UUID.test(id),
    );

  if (catalogIds.length === 0) return first;

  const catalog = await prisma.artist.findMany({
    where: {
      OR: [
        { id: { in: catalogIds } },
        { spotifyId: { in: catalogIds } },
      ],
    },
    select: { id: true, spotifyId: true },
  });

  const known = new Set<string>();
  for (const row of catalog) {
    known.add(row.id);
    if (row.spotifyId) known.add(row.spotifyId);
  }

  const accepted: OrcaNode[] = [];
  const rejected = [...first.rejected];

  for (const node of first.accepted) {
    const needsCatalog =
      (!node.id.includes('-') && /^[0-9A-Za-z]{15,30}$/.test(node.id)) ||
      MUSICBRAINZ_UUID.test(node.id);
    if (!needsCatalog) {
      accepted.push(node);
      continue;
    }
    if (known.has(node.id)) {
      accepted.push(node);
      continue;
    }
    // Live API path: image already resolved from Spotify/Last.fm this request
    if (node.imageUrl && node.imageUrl.length > 8) {
      accepted.push(node);
      continue;
    }
    rejected.push({ id: node.id, name: node.name, reasons: ['not_in_catalog'] });
  }

  return { accepted, rejected };
}
