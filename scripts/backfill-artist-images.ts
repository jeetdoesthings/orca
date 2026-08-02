/**
 * Backfill Artist.imageUrl (and empty rawGenres) via enrich cascade.
 * Deezer is primary free bulk image source.
 *
 * Usage:
 *   DATABASE_URL=file:./prisma/dev.db npx tsx scripts/backfill-artist-images.ts
 *   DATABASE_URL=... npx tsx scripts/backfill-artist-images.ts --limit 100
 */
import { PrismaClient } from '@prisma/client';
import {
  enrichArtistIdentity,
  isWeakImageUrl,
  normalizeArtistName,
} from '../src/lib/artists/enrich-identity';

const prisma = new PrismaClient();

function parseLimit(): number {
  const idx = process.argv.indexOf('--limit');
  if (idx >= 0 && process.argv[idx + 1]) {
    const n = parseInt(process.argv[idx + 1], 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 500;
}

async function main() {
  const limit = parseLimit();
  const all = await prisma.artist.findMany({
    select: {
      id: true,
      displayName: true,
      spotifyId: true,
      imageUrl: true,
      rawGenres: true,
      popularity: true,
    },
    orderBy: { popularity: 'desc' },
  });

  const weak = all.filter((a) => isWeakImageUrl(a.imageUrl));
  const beforeStrong = all.length - weak.length;
  console.log(
    `[backfill-images] total=${all.length} strong=${beforeStrong} weak=${weak.length} processing up to ${limit}`,
  );

  const slice = weak.slice(0, limit);
  let fixed = 0;
  let failed = 0;

  for (let i = 0; i < slice.length; i++) {
    const row = slice[i];
    let genres: string[] = [];
    try {
      genres = JSON.parse(row.rawGenres || '[]');
    } catch {
      genres = [];
    }
    if (!Array.isArray(genres)) genres = [];

    try {
      const enr = await enrichArtistIdentity({
        name: row.displayName,
        spotifyId: row.spotifyId,
        genres,
        imageUrl: row.imageUrl,
        popularity: row.popularity,
      });

      const nextImage =
        enr.imageUrl && !isWeakImageUrl(enr.imageUrl) ? enr.imageUrl : row.imageUrl;
      const nextGenres = enr.genres.length > 0 ? enr.genres : genres;

      if (nextImage && !isWeakImageUrl(nextImage)) {
        await prisma.artist.update({
          where: { id: row.id },
          data: {
            imageUrl: nextImage,
            rawGenres: JSON.stringify(nextGenres),
            popularity: enr.popularity ?? row.popularity,
            normalizedName: normalizeArtistName(row.displayName),
            ...(enr.spotifyId && !row.spotifyId ? { spotifyId: enr.spotifyId } : {}),
          },
        });
        fixed++;
        console.log(`  ✓ ${row.displayName} ← ${enr.sources.join(',') || 'enrich'}`);
      } else {
        failed++;
        console.log(`  ✗ ${row.displayName} (no image)`);
      }
    } catch (err) {
      failed++;
      console.warn(`  ✗ ${row.displayName}:`, err instanceof Error ? err.message : err);
    }

    // Soft rate limit for Deezer (~50/5s → stay well under)
    if ((i + 1) % 8 === 0) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  const after = await prisma.artist.findMany({ select: { imageUrl: true } });
  const afterStrong = after.filter((a) => !isWeakImageUrl(a.imageUrl)).length;
  console.log(
    `[backfill-images] done fixed=${fixed} failed=${failed} coverage=${afterStrong}/${after.length} (${Math.round((afterStrong / Math.max(1, after.length)) * 100)}%)`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
