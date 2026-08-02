# `scripts/` — Phase 1.5 regression harness

This directory contains three scaffolding scripts for Phase 2 regression testing. They are **read-only** — none of them mutate the database or the filesystem outside the `scratch-fixtures/` directory.

## Run order

You set up the regression baseline yourself (per the conversation's plan). The intended workflow:

1. **`npm run dev`** so Spotify OAuth can complete.
2. **`npx tsx scripts/seed-sample-users.ts`** — creates 8 `User` rows with `profileClass` markers in `profileData`. Prints a manifest at `scratch-fixtures/sample-users-manifest.json` and the per-class login URLs you visit to attach Spotify test accounts.
3. For each of the 8 classes: log in with the matching Spotify test account, let `/api/user/sync` run, then **`npx tsx scripts/capture-baseline.ts --userId=<that user's id> --label=baseline-prephase2`**.
4. Capture the `/api/globe` response by hand (the script leaves a `.placeholder` file with instructions) and save it as `.10-globe-response.json`.
5. After a Phase 2 PR merges on the same git tree, re-run step 3 with `--label=postphase2-<PR-sha>`.
6. **`npx tsx scripts/diff-baselines.ts --baseline=scratch-fixtures/<userId>/baseline/baseline-prephase2-... --candidate=scratch-fixtures/<userId>/baseline/postphase2-...-... [--expect=path]`** for the diff.

## `--expect` paths per PR

Each Phase 2 PR declares the field paths it expects to change (per `success-metrics.md §4.3`). Examples:

- **P0-1** (pipeline reorder + threaded expansion fields):
  `--expect=expansionDistance` `--expect=decisionConfidence` `--expect=audioSource`
- **P1-3** (GRE confidence floor → config):
  `--expect=confidence`
- **P1-7** (CUB canonical, ORE aggregate removed):
  `--expect=discoveryConfidence`
- **P1-8** (Spotify cache wired):
  no field diff — runtime-only change (we don't capture API call counts in this script; add a per-engine counter if you want)
- **P2-14** (dead code removed):
  no diff at all

## Safety

- `scripts/capture-baseline.ts` is **read-only**. It calls `buildFrontierNodes`, `computeGenreRelationships`, `evaluateCandidateUniverse`, `projectWorld`, `computeUserProfile`, `computeUserTerritoryMapping` in-memory and watches their return values; it does **not** persist anything to `User.frontierData`, `User.profileData`, or the FS `world-state-*.json` file.
- `scripts/seed-sample-users.ts` only inserts new rows and only modifies `User.profileData` to include the `profileClass` marker. Idempotent — re-running it does NOT recreate existing matched rows.
- `scripts/diff-baselines.ts` reads only.

## Prerequisites

- **DATABASE_URL** must point at the dev DB (`prisma/dev.db` or connection string).
- **`npx tsx`** — install once globally (`npm i -g tsx`) or use `npx tsx`.
- **`prisma generate`** must have been run so `@prisma/client` has runtime types matching the current schema.
- To capture Spotify averages correctly, the test users must have been synced through `/api/user/sync` at least once. Otherwise `User.globeData` will be empty and `capture-baseline.ts` step 1 returns null.

## Known limitations

- The script captures **`computeUserProfile` output as in-memory** if `User.profileData` is null. This will give you a *fresh* profile every run, not the stored one. If you want the stored one, ensure `User.profileData` is already populated first.
- The territory-chain writes to the DB when invoked normally via `computeUserTerritoryMapping`. The capture script does **not** invoke the territory chain — it only reads already-written rows. So if you want fresh territory rows in `.09-territory-rows.json`, run `computeAndStoreFrontier` via `POST /api/user/explore` *manually* (or just let sync fire) before re-running capture.
- `OrcaNode.candidateEvidence` is captured but sub-fields that don't survive JSON-round-trip (e.g., `Date` objects) will appear as ISO strings.
- The `.10-globe-response.json` capture is manual because invoking the Next.js handler in-process requires its full request context. The variants in `withEnvOverrides` and `worldState.snapshotVersion` handling make automated capture brittle.
