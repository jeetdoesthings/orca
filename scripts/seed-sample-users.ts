/**
 * scripts/seed-sample-users.ts
 * ---------------------------------------------------------------------------
 * Phase 1.5 deliverable: scaffold for the 8 representative user profiles
 * required by success-metrics.md §4.2 for Phase 2 regression validation.
 *
 * THE PROBLEM
 * ------------
 * You can't synthesise a Spotify listening history that meaningfully drives
 * the Identity Builder (which calls real Spotify APIs, reads real track
 * features, etc.). The only honest way to seed a "mainstream pop listener"
 * profile is to create a real Spotify test account and sync from it.
 *
 * WHAT THIS SCRIPT DOES
 * ---------------------
 * Creates the 8 User rows in the DB (with the `profileClass` marker on
 * `User.profileData`) and prints, for each one, the redirect URL needed to
 * log in with a Spotify test account assigned to that class. After you log
 * in with each test account (8 of them) and /api/user/sync runs, the
 * baseline-capture script (scripts/capture-baseline.ts) can be invoked once
 * per user to populate scratch-fixtures/<userId>/baseline/.
 *
 * PREREQUISITES
 * -------------
 *   - DATABASE_URL
 *   - The dev server running on http://localhost:3000 (so Spotify OAuth
 *     callback can complete — requires `npm run dev`)
 *   - Eight real Spotify test accounts assigned to the classes below
 *
 * USAGE
 * -----
 *   npx tsx scripts/seed-sample-users.ts
 *   → creates the 8 User rows, writes `profileClass` marker
 *   → prints the per-user URL `http://localhost:3000/api/auth/signin?callbackUrl=…`
 *   → you log in with each test account; the sync route triggers automatically
 *
 * SAFETY
 * ------
 * Idempotent. If the 8 users already exist (matched by `profileClass`), it
 * does NOT recreate them — only prints login URLs. It does NOT delete or
 * modify existing user rows other than the `profileClass` marker.
 *
 * ---------------------------------------------------------------------------
 */
import { promises as fs } from 'fs';
import path from 'path';
import { prisma } from '../src/lib/prisma';

interface SampleUserClass {
  profileClass: string;
  description: string;
  spotifyListeningPatternHint: string;
}

const SAMPLE_USER_CLASSES: SampleUserClass[] = [
  {
    profileClass: 'mainstream_pop',
    description: 'mainstream pop listener — high familiarity / low adventurousness',
    spotifyListeningPatternHint:
      'Top artists expected: Dua Lipa, Taylor Swift, Olivia Rodrigo, Ed Sheeran. Playlists: Today\'s Top Hits, Hot Hits Global.',
  },
  {
    profileClass: 'underground_electronic',
    description: 'underground electronic — niche genres (techno, dubstep, IDM) low mainstream exposure',
    spotifyListeningPatternHint:
      'Top artists expected: Bicep, Overmono, Four Tet, Burial, Floating Points. Playlists: Bicep\'s Radio, Bonobo\'s Late Night Tales.',
  },
  {
    profileClass: 'hip_hop',
    description: 'hip-hop listener — predominantly hip-hop / rap catalog',
    spotifyListeningPatternHint:
      'Top artists expected: Kendrick Lamar, J. Cole, Drake, Travis Scott, Tyler the Creator.',
  },
  {
    profileClass: 'metal',
    description: 'metal listener — metal and adjacent hard-rock sub-genres',
    spotifyListeningPatternHint:
      'Top artists expected: Metallica, Slipknot, Gojira, Meshuggah, Th\modelhaunting citrone.',
  },
  {
    profileClass: 'jazz_classical',
    description: 'jazz/classical — older catalog, low mainstream pop exposure',
    spotifyListeningPatternHint:
      'Top artists expected: Miles Davis, John Coltrane, Glenn Gould, Bill Evans, Brahms recordings.',
  },
  {
    profileClass: 'mixed_listener',
    description: 'mixed listener — spans at least three distinct genres intentionally',
    spotifyListeningPatternHint:
      'Top artists expected: a mix spanning e.g. Radiohead / Solange / Caribou / Khruangbin / Yo La Tengo (across genres).',
  },
  {
    profileClass: 'sparse_profile',
    description: 'sparse profile — total listening under minimum threshold, weak footprint',
    spotifyListeningPatternHint:
      'Top artists expected: 2-3 artists only, with short total listening time. Used to test low-data fallback paths.',
  },
  {
    profileClass: 'cold_start',
    description: 'cold-start user — no prior listening events at all; engine fallbacks must trigger gracefully',
    spotifyListeningPatternHint:
      'Empty Spotify library / no listening history. Profile should auto-backfill per Identity Builder default seeds.',
  },
];

async function ensureSampleUsers() {
  const results: Array<{ profileClass: string; userId: string | null; loginUrl: string; isNew: boolean }> = [];
  for (const cls of SAMPLE_USER_CLASSES) {
    const existing = await (prisma as any).user.findFirst({
      where: { profileClass: cls.profileClass },
      select: { id: true },
    });
    if (existing) {
      results.push({
        profileClass: cls.profileClass,
        userId: existing.id,
        loginUrl: `http://localhost:3000/api/auth/signin?callbackUrl=http://localhost:3000/api/user/sync`,
        isNew: false,
      });
      continue;
    }
    // ProfileClass field is assumed to live on User.profileData JSON. If your
    // Prisma schema has a dedicated column instead, edit this insert.
    const created = await prisma.user.create({
      data: { profileData: JSON.stringify({ profileClass: cls.profileClass }) } as any,
    });
    results.push({
      profileClass: cls.profileClass,
      userId: created.id,
      loginUrl: `http://localhost:3000/api/auth/signin?callbackUrl=http://localhost:3000/api/user/sync`,
      isNew: true,
    });
  }
  return results;
}

async function writeManifest(out: typeof SAMPLE_USER_CLASSES, results: Awaited<ReturnType<typeof ensureSampleUsers>>) {
  const manifest = {
    createdAt: new Date().toISOString(),
    classes: SAMPLE_USER_CLASSES.map((cls, i) => ({
      ...cls,
      ...results[i],
    })),
  };
  const outDir = 'scratch-fixtures';
  await fs.mkdir(outDir, { recursive: true });
  const filePath = path.join(outDir, 'sample-users-manifest.json');
  await fs.writeFile(filePath, JSON.stringify(manifest, null, 2), 'utf-8');
  console.log(`  manifest: ${filePath}`);
}

async function main() {
  console.log('[seed-sample-users] creating / verifying 8 sample user rows');
  const results = await ensureSampleUsers();
  await writeManifest(SAMPLE_USER_CLASSES, results);
  console.log('\n8 sample users ready. Login URLs (open in browser one at a time, log in with the matching Spotify test account):');
  for (const r of results) {
    console.log(`\n  ${r.profileClass}${r.isNew ? ' (NEW)' : ' (existing)'}: ${r.userId}`);
    console.log(`    loginURL: ${r.loginUrl}`);
    const cls = SAMPLE_USER_CLASSES.find(c => c.profileClass === r.profileClass);
    if (cls) {
      console.log(`    hint:      ${cls.spotifyListeningPatternHint}`);
    }
  }
  console.log('\nNext steps:');
  console.log('  1. For each class, log in with the matching Spotify test account at the loginURL.');
  console.log('  2. After the Spotify sync fires /api/user/sync, the user\'s globeData and profileData populate.');
  console.log('  3. Run scripts/capture-baseline.ts --userId=<the userId above> --label=baseline-postrun-2026-07-05');
  console.log('  4. Repeat per class until you have 8 baseline snapshots.');
  console.log('  5. Phase 2 PRs re-run capture-baseline against the SAME userId values after their merge.');
  console.log('     Diff against the baseline manifests pass/fail per the expected-diff rule of success-metrics.md §4.3.');
}

main().catch(e => { console.error(e); process.exit(1); }).finally(async () => { await prisma.$disconnect(); });
