/**
 * Merge Artist rows that share the same normalized name.
 * Keeps highest-quality row (spotify + genres + image + popularity).
 *
 * Usage: npx tsx scripts/dedupe-artists.ts
 */
import { PrismaClient } from '@prisma/client';
import {
  artistQualityScore,
  normalizeArtistName,
  splitCollabName,
} from '../src/lib/artists/enrich-identity';

const prisma = new PrismaClient();

async function main() {
  const all = await prisma.artist.findMany();

  // Map every row by normalized name so collab parts can resolve in memory.
  const byKey = new Map<string, (typeof all)[number]>();
  for (const a of all) {
    const k = normalizeArtistName(a.normalizedName || a.displayName);
    if (k && !byKey.has(k)) byKey.set(k, a);
  }

  // Collaboration rows ("21 Savage & Metro Boomin") group under the first part
  // that resolves to an existing solo artist row ("21 Savage"). Real bands
  // ("Chase & Status" — no solo "Chase" row) keep their own key.
  const collabKeyCache = new Map<string, string>();
  const groupKeyFor = (a: (typeof all)[number]): string => {
    const own = normalizeArtistName(a.normalizedName || a.displayName);
    if (!own) return '';
    const cached = collabKeyCache.get(a.id);
    if (cached !== undefined) return cached;
    let resolved = own;
    const parts = splitCollabName(a.displayName);
    if (parts.length >= 2) {
      for (const part of parts) {
        const pk = normalizeArtistName(part);
        const target = pk && byKey.get(pk);
        if (target && target.id !== a.id) {
          resolved = pk;
          break;
        }
      }
    }
    collabKeyCache.set(a.id, resolved);
    return resolved;
  };

  const groups = new Map<string, typeof all>();
  for (const a of all) {
    const key = groupKeyFor(a);
    if (!key) continue;
    const g = groups.get(key) || [];
    g.push(a);
    groups.set(key, g);
  }

  let merged = 0;
  let deleted = 0;

  for (const [, rows] of groups) {
    if (rows.length < 2) continue;
    rows.sort((a, b) => {
      // Collab rows ("X & Y") must never win over a solo row — the solo name
      // is the canonical artist the user knows.
      const collabPenalty = (r: (typeof rows)[0]) =>
        splitCollabName(r.displayName).length >= 2 ? 1000 : 0;
      return (
        artistQualityScore({
          spotifyId: b.spotifyId,
          rawGenres: b.rawGenres,
          imageUrl: b.imageUrl,
          popularity: b.popularity,
        }) -
          collabPenalty(b) -
          (artistQualityScore({
            spotifyId: a.spotifyId,
            rawGenres: a.rawGenres,
            imageUrl: a.imageUrl,
            popularity: a.popularity,
          }) -
            collabPenalty(a))
      );
    });
    const winner = rows[0];
    const losers = rows.slice(1);

    // Merge best fields onto winner
    let bestGenres = winner.rawGenres;
    let bestImage = winner.imageUrl;
    let bestSpotify = winner.spotifyId;
    let bestPop = winner.popularity;
    for (const l of losers) {
      try {
        const wg = JSON.parse(bestGenres || '[]');
        const lg = JSON.parse(l.rawGenres || '[]');
        if (Array.isArray(lg) && lg.length > (Array.isArray(wg) ? wg.length : 0)) {
          bestGenres = l.rawGenres;
        }
      } catch {
        /* ignore */
      }
      if ((!bestImage || bestImage.includes('/i/u/30/')) && l.imageUrl) {
        bestImage = l.imageUrl;
      }
      if (!bestSpotify && l.spotifyId) bestSpotify = l.spotifyId;
      if ((l.popularity || 0) > (bestPop || 0)) bestPop = l.popularity;
    }

    await prisma.artist.update({
      where: { id: winner.id },
      data: {
        rawGenres: bestGenres,
        imageUrl: bestImage,
        spotifyId: bestSpotify,
        popularity: bestPop,
        normalizedName: normalizeArtistName(winner.displayName),
      },
    });

    for (const l of losers) {
      try {
        await prisma.artist.delete({ where: { id: l.id } });
        deleted++;
      } catch (err) {
        console.warn(`Could not delete ${l.id} (${l.displayName}):`, err);
      }
    }
    merged++;
    console.log(`Merged ${rows.length} → ${winner.displayName} (${winner.id})`);
  }

  const remaining = await prisma.artist.count();
  console.log({ mergedGroups: merged, deletedRows: deleted, artistRows: remaining });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
