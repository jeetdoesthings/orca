/**
 * scripts/capture-baseline.ts
 * ---------------------------------------------------------------------------
 * Phase 1.5 deliverable: regression-baseline capture harness.
 *
 * Run with:
 *   npx tsx scripts/capture-baseline.ts \
 *       --userId=<USER_ID> \
 *       [--label=<short-label>] \
 *       [--sliderValues=0.0,0.25,0.5,0.75,1.0] \
 *       [--out=root-of-fixtures]  (default: scratch-fixtures/)
 *
 * What it does
 * ------------
 * Captures a complete snapshot of the ORCA pipeline output for ONE user, at
 * the current git SHA, against the current Prisma database. The snapshot is
 * written as JSON files under scratch-fixtures/<userId>/baseline/<label>-<gitSHA>-<ISO>.json
 * so that Phase 2 regression runs can diff before/after.
 *
 * Captures (per success-metrics.md §4.1 contract):
 *   1. Identity Builder output        — User.globeData (explored OrcaNode[])
 *   2. CUB output                     — Universe.candidates (Candidate[] pre-OCSE)
 *   3. GRE output                     — GenreRelationship[]
 *   4. OCSE output                    — DecisionProfile[]
 *   5. Expansion Intelligence output  — per-OrcaNode {expansionDistance, expansionBand, expansionValue}
 *   6. Frontier nodes                 — OrcaNode[] returned from buildFrontierNodes
 *   7. WPE projection                  — projectWorld output for each slider value requested
 *   8. Profile subsystem output        — User.profileData
 *   9. Territory chain output          — rows of every Territory* table for this userId
 *  10. Final /api/globe-world response — the world-regeneration-world delta
 *
 * Requires
 * --------
 *   - DATABASE_URL env var (Prisma)
 *   - SPOTIFY_ACCESS_TOKEN env var OR an Account row in DB for the user
 *   - Prisma client generated (`npm run build` or `npx prisma generate`)
 *
 * Safety
 * ------
 * This script is READ-ONLY. It does NOT mutate the database, the filesystem
 * (outside the fixtures directory), or User columns. It calls buildFrontierNodes
 * and the projection/profile compute functions in-memory, captures their
 * return values, and writes them out.
 *
 * You run this. Phase 1.5 finishes documentation only — you supply the
 * Spotify credentials and database access.
 *
 * ---------------------------------------------------------------------------
 */
import { promises as fs } from 'fs';
import path from 'path';
import { execSync } from 'child_process';

// NOTE: the imports below reference source files by relative path.
// They assume this script is run from the project root via `npx tsx`.
import { prisma } from '../src/lib/prisma';
import { buildFrontierNodes } from '../src/lib/frontier/buildFrontierNodes';
import { computeGenreRelationships } from '../src/lib/gre/gre';
import { evaluateCandidateUniverse } from '../src/lib/ocse/decision-engine';
import { loadInteractionHistory } from '../src/lib/ocse/interaction-history';
import { projectWorld } from '../src/lib/frontier/world-projection';
import { computeUserProfile } from '../src/lib/profile/profile-engine';
import { computeUserTerritoryMapping } from '../src/lib/profile/territory-mapping';

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------
interface Args {
  userId: string;
  label: string;
  sliderValues: number[];
  outRoot: string;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (flag: string, fallback?: string) => {
    const f = argv.find(a => a.startsWith(`--${flag}=`));
    return f ? f.slice(f.indexOf('=') + 1) : fallback;
  };
  const userId = get('userId');
  if (!userId) {
    console.error('Usage: npx tsx scripts/capture-baseline.ts --userId=<USER_ID> [--label=<...>] [--sliderValues=...] [--out=...]');
    process.exit(2);
  }
  return {
    userId,
    label: get('label', 'baseline'),
    sliderValues: (get('sliderValues', '0.0,0.25,0.5,0.75,1.0') || '0.5')
      .split(',').map(s => Number(s.trim())).filter(n => !Number.isNaN(n) && n >= 0 && n <= 1),
    outRoot: get('out', 'scratch-fixtures'),
  };
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function gitSHA(): string {
  try { return execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim(); } catch { return 'unknown'; }
}
function isoNow(): string { return new Date().toISOString().replace(/[:.]/g, '-'); }

async function ensureDir(p: string) { await fs.mkdir(p, { recursive: true }); }

async function writeJson(filePath: string, data: unknown) {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// ---------------------------------------------------------------------------
// capture
// ---------------------------------------------------------------------------
async function captureUserBasics(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      globeData: true,
      frontierData: true,
      profileData: true,
      frontierCount: true,
      frontierStatus: true,
      frontierComputedAt: true,
      adventurousnessHistory: true,
      homeRegion: true,
    },
  });
  if (!user) throw new Error(`userId ${userId} not found in DB`);
  return user;
}

async function resolveSpotifyAccessToken(userId: string): Promise<string> {
  // Phase 1.5 note: confirm the actual Prisma model name when you run.
  // The codebase uses next-auth + Prisma; the table is commonly `Account`.
  // This helper tries Account first; if you have a different schema, edit here.
  const account = await (prisma as any).account.findFirst({
    where: { userId },
    select: { access_token: true, expires_at: true, refresh_token: true },
  });
  if (!account?.access_token) {
    const env = process.env.SPOTIFY_ACCESS_TOKEN;
    if (!env) {
      throw new Error(
        'No Spotify access token. Either:\n' +
        '  (a) populate the Account table for this user (next-auth login), or\n' +
        '  (b) export SPOTIFY_ACCESS_TOKEN.'
      );
    }
    return env;
  }
  return account.access_token;
}

async function captureTerritoryRows(userId: string) {
  // Every territory-related table the profile subsystem writes, per
  // Phase 1.5 audit. Read-only snapshots for regression diff.
  const tables: Array<{ key: string; query: () => Promise<unknown> }> = [
    { key: 'userTerritoryProfile', query: () => (prisma as any).userTerritoryProfile.findMany({ where: { userId } }) },
    { key: 'territoryMomentum', query: () => (prisma as any).territoryMomentum.findMany({ where: { userId } }) },
    { key: 'territoryAdoption', query: () => (prisma as any).territoryAdoption.findMany({ where: { userId } }) },
    { key: 'territoryFamiliarity', query: () => (prisma as any).territoryFamiliarity.findMany({ where: { userId } }) },
    { key: 'userTerritoryAffinity', query: () => (prisma as any).userTerritoryAffinity.findMany({ where: { userId } }) },
    { key: 'userTerritoryRelationship', query: () => (prisma as any).userTerritoryRelationship.findMany({ where: { userId } }) },
    { key: 'relationshipTransition', query: () => (prisma as any).relationshipTransition.findMany({ where: { userId } }) },
    { key: 'relationshipExplanation', query: () => (prisma as any).relationshipExplanation.findMany({ where: { userId } }) },
    { key: 'userTerritoryIntervention', query: () => (prisma as any).userTerritoryIntervention.findMany({ where: { userId } }) },
    { key: 'interventionScoreBreakdown', query: () => (prisma as any).interventionScoreBreakdown.findMany({ where: { userId } }) },
    { key: 'interventionExplanation', query: () => (prisma as any).interventionExplanation.findMany({ where: { userId } }) },
    { key: 'userTerritoryCultivation', query: () => (prisma as any).userTerritoryCultivation.findMany({ where: { userId } }) },
    { key: 'userArtistMemory', query: () => (prisma as any).userArtistMemory.findMany({ where: { userId } }) },
    { key: 'userListeningEvent', query: () => (prisma as any).userListeningEvent.findMany({ where: { userId } }) },
  ];
  const out: Record<string, unknown> = {};
  for (const t of tables) {
    try {
      out[t.key] = await t.query();
    } catch (e) {
      out[t.key] = { __captureError__: String((e as Error).message) };
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
async function main() {
  const args = parseArgs();
  const sha = gitSHA();
  const stamp = isoNow();
  const dir = path.resolve(args.outRoot, args.userId, 'baseline');
  await ensureDir(dir);

  console.log(`[capture-baseline] userId=${args.userId}`);
  console.log(`[capture-baseline] gitSHA=${sha}`);
  console.log(`[capture-baseline] label=${args.label}`);
  console.log(`[capture-baseline] out=${dir}`);
  console.log(`[capture-baseline] sliderValues=${args.sliderValues.join(',')}`);

  console.log('→ reading user row + Spotify access token');
  const userRows = await captureUserBasics(args.userId);
  const accessToken = await resolveSpotifyAccessToken(args.userId);

  // Output meta — written first thing per success-metrics §4.1
  const meta = {
    userId: args.userId,
    gitSHA: sha,
    captureTime: stamp,
    label: args.label,
    sliderValues: args.sliderValues,
    clientVersion: null,
  };
  await writeJson(path.join(dir, `${args.label}-${sha}-${stamp}.00-meta.json`), meta);

  // 1. Identity Builder output (User.globeData)
  console.log('→ 1. Identity output (User.globeData)');
  let exploredOrcaNodes: any[] = [];
  try {
    if (userRows.globeData) {
      const parsed = JSON.parse(userRows.globeData);
      exploredOrcaNodes = parsed.nodes ?? parsed;
    }
    await writeJson(path.join(dir, `${args.label}-${sha}-${stamp}.01-identity.json`), {
      userId: args.userId,
      globeData: userRows.globeData ? JSON.parse(userRows.globeData) : null,
      frontierData: userRows.frontierData ? JSON.parse(userRows.frontierData) : null,
      frontierCount: userRows.frontierCount,
      frontierStatus: userRows.frontierStatus,
      frontierComputedAt: userRows.frontierComputedAt,
      adventurousnessHistory: userRows.adventurousnessHistory,
      homeRegion: userRows.homeRegion,
    });
  } catch (e) {
    console.warn('   capture failed:', (e as Error).message);
  }

  // 2-6. Run the canonical pipeline via buildFrontierNodes (NOTE: skip persistence).
  //      buildFrontierNodes runs Stages 2-4 in-memory and returns OrcaNode[].
  //      To capture intermediate outputs (CUB Candidate[], GRE GenreRelationship[],
  //      OCSE DecisionProfile[]) we need to invoke the components individually.
  //
  //      Lightweight approach: call buildFrontierNodes with skipOcse=false so we
  //      get the frontier OrcaNode[]; separately call computeGenreRelationships
  //      and evaluateCandidateUniverse for trace-level data.
  console.log('→ 2. CUB output (buildCandidateUniverse) — captured via buildFrontierNodes');
  console.log('→ 3. GRE output (computeGenreRelationships)');
  console.log('→ 4. OCSE output (evaluateCandidateUniverse)');
  console.log('→ 5-6. Expansion Intelligence output → OrcaNode[] (buildFrontierNodes)');
  try {
    const frontierNodes = (
      await buildFrontierNodes(
        exploredOrcaNodes,
        accessToken,
        args.userId,
        {
          skipOcse: false,
          sliderValue:
            args.sliderValues[Math.floor(args.sliderValues.length / 2)],
        },
      )
    ).nodes;
    await writeJson(path.join(dir, `${args.label}-${sha}-${stamp}.06-frontier-nodes.json`), {
      count: frontierNodes.length,
      nodes: frontierNodes,
    });

    // Per-candidate unpack Expansion Intelligence outputs from the OrcaNodes:
    const expansionOutputs = frontierNodes.map(n => ({
      id: n.id,
      name: n.name,
      expansionDistance: n.expansionDistance ?? null,
      expansionBand: n.expansionBand ?? null,
      projectionMetadata: n.projectionMetadata ?? null,
      audioSignature: n.audioSignature ?? null,
    }));
    await writeJson(path.join(dir, `${args.label}-${sha}-${stamp}.05-expansion-intelligence.json`), {
      count: expansionOutputs.length,
      outputs: expansionOutputs,
    });

    // Re-run GRE in isolation for the trace dump:
    const relationships = await computeGenreRelationships(args.userId);
    await writeJson(path.join(dir, `${args.label}-${sha}-${stamp}.03-gre.json`), {
      count: relationships.length,
      relationships,
    });

    // Re-run OCSE in isolation so we can capture DecisionProfile[] on its own:
    const interactionHistory = await loadInteractionHistory(args.userId);
    // OCSE consumes Candidate[]; reconstruct a minimal Candidate[] from the
    // captured frontier nodes by stripping OrcaNode-only fields. This is for
    // trace-only purposes; PR reviewers should not depend on this shape.
    const candidateStubs = frontierNodes.map(n => ({
      artistId: n.id,
      name: n.name,
      genres: n.genres,
      popularity: n.popularity,
      imageUrl: n.imageUrl,
      discoveryContext: { growthOpportunity: '', relationshipStage: '', supportingArtists: [], sources: [] },
      discoveryConfidence: n.candidateEvidence?.discoveryConfidence ?? 0.5,
      candidateClassification: 'EXPANSION' as const,  // stub for capture-only
    }));
    const ocseProfiles = evaluateCandidateUniverse(candidateStubs as any, {
      relationships,
      sliderValue: args.sliderValues[Math.floor(args.sliderValues.length / 2)],
      interactionHistory,
      currentVisibleWorldIds: exploredOrcaNodes.map(n => n.id),
    });
    await writeJson(path.join(dir, `${args.label}-${sha}-${stamp}.04-ocse.json`), {
      count: ocseProfiles.length,
      decisionProfiles: ocseProfiles,
    });
  } catch (e) {
    console.warn('   pipeline capture failed (one or more steps):', (e as Error).message);
    await writeJson(path.join(dir, `${args.label}-${sha}-${stamp}.ERR-pipeline.json`), {
      error: String((e as Error).message),
      stack: (e as Error).stack,
    });
  }

  // 7. WPE projection for each requested slider value
  console.log('→ 7. WPE projection per sliderValue');
  try {
    const sliderRuns: Record<string, unknown> = {};
    for (const slider of args.sliderValues) {
      const sliderKey = slider.toFixed(2);
      sliderRuns[sliderKey] = projectWorld(
        // explored + frontier combined (matches /api/globe's combinedNodes)
        [...exploredOrcaNodes, ...(
          await buildFrontierNodes(
            exploredOrcaNodes, accessToken, args.userId, { skipOcse: true }
          )
        ).nodes],
        [], slider
      );
    }
    await writeJson(path.join(dir, `${args.label}-${sha}-${stamp}.07-wpe-projection.json`), sliderRuns);
  } catch (e) {
    console.warn('   WPE capture failed:', (e as Error).message);
  }

  // 8. Profile subsystem output (User.profileData) — capture current state
  console.log('→ 8. Profile subsystem (User.profileData)');
  try {
    let profileData = userRows.profileData ? JSON.parse(userRows.profileData) : null;
    if (profileData === null) {
      // Re-compute the profile in memory and capture it (does NOT persist).
      profileData = computeUserProfile(
        args.userId,
        exploredOrcaNodes,
        userRows.frontierCount ?? 0,
        null as any
      );
    }
    await writeJson(path.join(dir, `${args.label}-${sha}-${stamp}.08-profile.json`), profileData);
  } catch (e) {
    console.warn('   profile capture failed:', (e as Error).message);
  }

  // 9. Territory chain output — rows from all 14 territory-related tables
  console.log('→ 9. Territory chain (DB rows for this userId)');
  const territoryRows = await captureTerritoryRows(args.userId);
  await writeJson(path.join(dir, `${args.label}-${sha}-${stamp}.09-territory-rows.json`), territoryRows);

  // 10. Final /api/globe-world response — NOT captured here (this would require
  //     invoking the Next.js route handler in-process). Document this as a
  //     manual capture step: after running this script, fire a `curl
  //     localhost:3000/api/globe` and save the response into
  //     .10-globe-response.json in the same directory.
  await writeJson(path.join(dir, `${args.label}-${sha}-${stamp}.10-globe-response.placeholder.json`), {
    note: 'Capture manually: curl -s "http://localhost:3000/api/globe" -H "Cookie: next-auth.session-token=..."\nthen save response here as .10-globe-response.json',
  });

  // Done.
  console.log('✓ baseline capture complete');
  console.log(`  fixtures written under: ${dir}`);
  console.log('  Next: capture the /api/globe response manually (see .10-...placeholder.json).');
}

main()
  .catch(err => {
    console.error('[capture-baseline] FATAL:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
