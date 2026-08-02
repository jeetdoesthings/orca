/**
 * Expand the selectable Artist catalog for demo globe.
 *
 * Sources:
 *   - ICONIC_SEEDS names (all biomes)
 *   - Last.fm top artists per tag (when API key present)
 *   - Spotify search (enrich-identity)
 *
 * Usage: npx tsx scripts/seed-artist-catalog.ts
 * Env: SPOTIFY_CLIENT_ID/SECRET, LASTFM_API_KEY (optional)
 */

import { PrismaClient } from '@prisma/client';
import { ICONIC_SEEDS } from '../src/lib/lastfm';
import {
  upsertEnrichedArtist,
  normalizeArtistName,
} from '../src/lib/artists/enrich-identity';

const prisma = new PrismaClient();

async function lastFmTopForTag(tag: string, limit = 25): Promise<string[]> {
  const key = process.env.LASTFM_API_KEY;
  if (!key) return [];
  try {
    const params = new URLSearchParams({
      method: 'tag.gettopartists',
      tag,
      limit: String(limit),
      api_key: key,
      format: 'json',
    });
    const res = await fetch(`https://ws.audioscrobbler.com/2.0/?${params}`);
    if (!res.ok) return [];
    const data = await res.json();
    const artists = data?.topartists?.artist || [];
    return artists.map((a: { name: string }) => a.name).filter(Boolean);
  } catch {
    return [];
  }
}

const TAG_MAP: Record<string, string> = {
  'hip-hop': 'hip hop',
  trap: 'trap',
  drill: 'drill',
  edm: 'edm',
  house: 'house',
  techno: 'techno',
  trance: 'trance',
  'drum-and-bass': 'drum and bass',
  pop: 'pop',
  'dance-pop': 'dance pop',
  rock: 'rock',
  'alternative-rock': 'alternative rock',
  'indie-rock': 'indie rock',
  punk: 'punk',
  metal: 'metal',
  rnb: 'rnb',
  soul: 'soul',
  funk: 'funk',
  folk: 'folk',
  country: 'country',
  ambient: 'ambient',
  classical: 'classical',
  jazz: 'jazz',
  latin: 'latin',
  'world-music': 'world',
};

async function main() {
  const names = new Set<string>();

  // 1. ICONIC_SEEDS
  for (const list of Object.values(ICONIC_SEEDS)) {
    for (const n of list) names.add(n);
  }

  // 2. Last.fm top per biome tag
  console.log('[seed-catalog] Fetching Last.fm top artists per genre…');
  for (const [genre, tag] of Object.entries(TAG_MAP)) {
    const tops = await lastFmTopForTag(tag, 20);
    for (const n of tops) names.add(n);
    console.log(`  ${genre}: +${tops.length} (total unique ${names.size})`);
    await new Promise((r) => setTimeout(r, 250));
  }

  console.log(`[seed-catalog] Upserting ${names.size} artists with multi-provider enrich…`);
  let ok = 0;
  let fail = 0;
  let i = 0;
  for (const name of names) {
    i++;
    try {
      await upsertEnrichedArtist({ name });
      ok++;
      if (i % 25 === 0) console.log(`  progress ${i}/${names.size} (ok=${ok} fail=${fail})`);
    } catch (err) {
      fail++;
      console.warn(`  fail ${name}:`, err instanceof Error ? err.message : err);
    }
    // gentle rate limit
    await new Promise((r) => setTimeout(r, 150));
  }

  const total = await prisma.artist.count();
  const withImage = await prisma.artist.count({
    where: { NOT: { OR: [{ imageUrl: null }, { imageUrl: '' }] } },
  });
  const distinctNames = await prisma.artist.findMany({
    select: { normalizedName: true },
    distinct: ['normalizedName'],
  });

  console.log('[seed-catalog] Done.', {
    attempted: names.size,
    ok,
    fail,
    artistRows: total,
    withImage,
    distinctNormalizedNames: distinctNames.length,
    sampleNorm: normalizeArtistName('21 Savage'),
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
