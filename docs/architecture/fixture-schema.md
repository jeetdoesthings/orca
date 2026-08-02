# Regression Fixture Schema (`docs/architecture/fixture-schema.md`)

**Status:** Day 1 — still binding for harness scripts. Globe path is pure read (no env overrides).  
**Authority:** machine-checkable contract for `scripts/capture-baseline.ts` + `diff-baselines.ts`.

> `success-metrics.md §4.1` lists *what* to capture in prose. This doc defines the *shape*: file names, directory layout, per-stage JSON envelopes, the snapshot-tag block, and the `--expect` mask semantics that `diff-baselines.ts` honours. If `capture-baseline.ts` and this doc disagree, **this doc is authoritative** and the script has a bug.

---

## 1. Directory layout

All baseline output lives under a single root (default `scratch-fixtures/`, gitignored).

```
scratch-fixtures/
├── sample-users-manifest.json          ← written by seed-sample-users.ts
└── <userId>/
    └── baseline/
        ├── <label>-<gitSHA>-<ISO> .00-meta.json
        ├── <label>-<gitSHA>-<ISO> .01-identity.json
        ├── <label>-<gitSHA>-<ISO> .03-gre.json
        ├── <label>-<gitSHA>-<ISO> .04-ocse.json
        ├── <label>-<gitSHA>-<ISO> .05-expansion-intelligence.json
        ├── <label>-<gitSHA>-<ISO> .06-frontier-nodes.json
        ├── <label>-<gitSHA>-<ISO> .07-wpe-projection.json
        ├── <label>-<gitSHA>-<ISO> .08-profile.json
        ├── <label>-<gitSHA>-<ISO> .09-territory-rows.json
        └── <label>-<gitSHA>-<ISO> .10-globe-response.placeholder.json
```

### 1.1 Filename grammar

```
<label>-<gitSHA>-<ISO>.<stage>.json
```

- `<label>` — free-form slug passed via `--label` (e.g. `baseline-prephase2`, `postphase2-abc1234`). **No dots or spaces** (the stage suffix is parsed by splitting on `.`).
- `<gitSHA>` — `git rev-parse HEAD` at capture time. `unknown` if git is unavailable.
- `<ISO>` — `new Date().toISOString()` with `:` and `.` replaced by `-` (filesystem-safe), e.g. `2026-07-05T15-23-01-234Z`.
- `<stage>` — two-digit zero-padded index + hyphenated stage name (see §2). The regex `\.(\d{2}-[a-z-]+|placeholder)\.json$` in `diff-baselines.ts` extracts this; any deviation breaks diff matching.

> **Stage `02` is intentionally absent.** CUB's `Candidate[]` is not captured as a standalone file today — `capture-baseline.ts` reconstructs candidate stubs from frontier nodes for the OCSE trace (see §4.4). Phase 2 P1-7 (CUB canonical) may add a real `.02-cub.json`; until then the index skips 02.

### 1.2 The two-capture convention

For regression diffing you need **two** snapshots per user, both with the same `<userId>`:

1. **baseline** — captured on the pre-Phase-2 tree (label e.g. `baseline-prephase2`).
2. **candidate** — captured after a Phase 2 PR merges (label e.g. `postphase2-<pr-sha>`).

`diff-baselines.ts` takes `--baseline=<dir>` and `--candidate=<dir>` pointing at the two snapshot directories. It does **not** cross-compare users.

---

## 2. Stage inventory and the common envelope

Every stage file is a single JSON object. Stages `01`–`09` share no common wrapper; each has its own top-level shape (defined per-stage in §3). Stage `00` is the meta block and is shared structure.

### 2.1 Snapshot tag block (stage `00-meta.json`)

Required on every capture. `diff-baselines.ts` reads it to confirm baseline and candidate were captured against comparable state.

```jsonc
{
  "userId": "<string>",
  "gitSHA": "<40-char hex | 'unknown'>",
  "captureTime": "<ISO 8601, filesystem-safe>",
  "label": "<string>",
  "sliderValues": [<number 0..1>, ...],
  "clientVersion": "<string | null>"
}
```

- `sliderValues` — the values WPE was projected against (stage 07). Defaults to `[0, 0.25, 0.5, 0.75, 1.0]`.
- `clientVersion` — whatever the frontend reported at capture time. `null` if the capture did not round-trip through the client.

> `diff-baselines.ts` does **not** fail if `gitSHA` differs between baseline and candidate (it is expected to differ — that's the point of the diff). It does fail if `userId` differs.

---

## 3. Per-stage JSON shapes

The shapes below describe what `capture-baseline.ts` writes today. Field-level ownership and lifecycle of the *underlying* values are defined in `data-contracts.md`; this section only describes the JSON envelope.

### 3.1 `01-identity.json` — Identity Builder output

```jsonc
{
  "userId": "<string>",
  "globeData": <parsed User.globeData JSON | null>,
  "frontierData": <parsed User.frontierData JSON | null>,
  "frontierCount": <number | null>,
  "frontierStatus": "<string | null>",
  "frontierComputedAt": "<ISO | null>",
  "adventurousnessHistory": <JSON | null>,
  "homeRegion": "<string | null>"
}
```

`globeData` is the explored `OrcaNode[]` (Identity Builder's persisted output per `data-contracts.md §2`). `null` if the user has never synced.

### 3.2 `03-gre.json` — GRE in-memory output

```jsonc
{
  "count": <number>,
  "relationships": [<GenreRelationship>, ...]
}
```

Each `GenreRelationship` matches the type at `src/lib/gre/gre.ts` (metrics + stage + summary + confidence). This is the **in-memory** output of `computeGenreRelationships(userId)` — not the persisted debug-route output. Per `pipeline.md §6.1`, GRE persistence is dormant on the canonical path; this capture reflects what OCSE and Expansion Intelligence actually see.

### 3.3 `04-ocse.json` — OCSE DecisionProfile[]

```jsonc
{
  "count": <number>,
  "decisionProfiles": [<DecisionProfile>, ...]
}
```

> **Capture caveat:** `capture-baseline.ts` reconstructs `Candidate[]` stubs from the frontier nodes to drive OCSE in isolation (see script lines 286–295). The stubs set `candidateClassification: 'EXPANSION'` and synthesize a minimal `discoveryContext`. This means stage 04's `decisionConfidence` distribution is **approximately** what the live pipeline produces, but the per-candidate `relationshipSupport` may differ from a real run because the stub does not carry the full `discoveryContext`. Phase 2 P1-5/P1-7 may improve this by capturing CUB's real `Candidate[]` (stage 02, currently absent).

### 3.4 `05-expansion-intelligence.json` — per-node expansion outputs

```jsonc
{
  "count": <number>,
  "outputs": [
    {
      "id": "<string>",
      "name": "<string>",
      "expansionDistance": <number | null>,
      "expansionBand": "<string | null>",
      "projectionMetadata": { "expansionDistance": <number>, "expansionBand": "<string>" } | null,
      "audioSignature": <AudioSignature | null>
    }, ...
  ]
}
```

This is the per-node unpacking of the canonical `expansionDistance` / `expansionBand` (Expansion Intelligence outputs per `data-contracts.md §2.8`). **INV-5 invariant:** `expansionDistance === projectionMetadata.expansionDistance` must hold for every entry; a divergence here is the single most important regression signal for Phase 2 P0-1.

### 3.5 `06-frontier-nodes.json` — buildFrontierNodes return value

```jsonc
{
  "count": <number>,
  "nodes": [<OrcaNode>, ...]
}
```

The full `OrcaNode[]` returned by `buildFrontierNodes` (post-500-cap). This is the authoritative frontier snapshot. Every field-level ownership question in `data-contracts.md §2` is checkable against this file.

### 3.6 `07-wpe-projection.json` — WPE output per slider value

```jsonc
{
  "0.00": <WorldProjectionSnapshot>,
  "0.25": <WorldProjectionSnapshot>,
  "0.50": <WorldProjectionSnapshot>,
  "0.75": <WorldProjectionSnapshot>,
  "1.00": <WorldProjectionSnapshot>
}
```

Keys are `slider.toFixed(2)`. Each value is the `projectWorld` return for that slider against combinedNodes (explored + frontier). Per `pipeline.md §6.3`, WPE mutates only `reachable` and `visible` on cloned nodes; this capture reflects the clone, not the stored node.

### 3.7 `08-profile.json` — Profile subsystem output

The parsed contents of `User.profileData` (the `UserProfile` object per `data-contracts.md §5`). If `User.profileData` is null at capture time, `capture-baseline.ts` recomputes via `computeUserProfile` in-memory (see `scripts/README.md` "Known limitations") — this produces a fresh profile, not the stored one, so for a meaningful diff ensure `User.profileData` is populated first.

### 3.8 `09-territory-rows.json` — Territory chain DB rows

```jsonc
{
  "userTerritoryProfile": [<row>, ...],
  "territoryMomentum": [<row>, ...],
  "territoryAdoption": [<row>, ...],
  "territoryFamiliarity": [<row>, ...],
  "userTerritoryAffinity": [<row>, ...],
  "userTerritoryRelationship": [<row>, ...],
  "relationshipTransition": [<row>, ...],
  "relationshipExplanation": [<row>, ...],
  "userTerritoryIntervention": [<row>, ...],
  "interventionScoreBreakdown": [<row>, ...],
  "interventionExplanation": [<row>, ...],
  "userTerritoryCultivation": [<row>, ...],
  "userArtistMemory": [<row>, ...],
  "userListeningEvent": [<row>, ...]
}
```

Read-only snapshots of the 14 territory-related tables filtered by `userId`. If a table read fails (e.g. schema mismatch), the value becomes `{ "__captureError__": "<message>" }` rather than failing the whole capture.

> **Vocabulary contamination site:** the `userTerritoryRelationship` array may contain rows from both GRE's 7-state vocabulary (keyed by raw genre) and Layer 6's 10-state vocabulary (keyed by `Territory_v2_*`). Per `data-contracts.md §3`, this is the pre-Phase-2 state; Phase 2 P0-2 cleans it. Diffs on this sub-key are expected to be noisy until P0-2 lands.

### 3.9 `10-globe-response.placeholder.json` — manual capture slot

Not a real capture. `capture-baseline.ts` writes a placeholder with instructions for manually saving the `/api/globe` response. The convention is: after running the script, `curl` the globe endpoint and save the response as `<label>-<gitSHA>-<ISO>.10-globe-response.json` in the same directory. `diff-baselines.ts`'s `BASELINE_FILES` array does not include stage `10` today (the file is often absent), so it is skipped silently.

---

## 4. `--expect` mask semantics (the diff contract)

`diff-baselines.ts` walks every stage file side-by-side and reports each `ADD` / `REMOVE` / `CHANGE` by JSON path. The `--expect=path.to.field` flag marks certain paths as **declared-acceptable** so a Phase 2 PR's expected changes don't fail the diff.

### 4.1 Path syntax

- Dot-notation for object keys: `decisionConfidence`, `projectionMetadata.expansionDistance`.
- Bracket-index for array elements: `nodes[0].reachable`, `decisionProfiles[3].expansionDistance`.
- The match is a **substring `includes` test**, not exact equality (see `diff-baselines.ts:128`: `args.expects.some(p => c.path.includes(p))`). So `--expect=expansionDistance` suppresses changes at `$`.nodes[5].expansionDistance` AND `$.decisionProfiles[5].expansionDistance` AND `$.outputs[5].projectionMetadata.expansionDistance`.

> **Implication:** a narrow `--expect=confidence` will suppress every path containing the substring "confidence" — `decisionConfidence`, `discoveryConfidence`, `stateConfidence`, `confidenceBand`, `confidenceProfile`. Phase 2 PRs should prefer the most specific field name that covers the declared change (e.g. `--expect=decisionConfidence` rather than `--expect=confidence`) to avoid accidentally hiding a regression in a sibling field.

### 4.2 Exit codes

| Code | Meaning |
|------|---------|
| `0` | All changes are within the `--expect` list, OR no changes found. Green. |
| `1` | One or more unexpected changes detected. Review the report. |
| `2` | Usage error / missing files. |

### 4.3 Declared-diff rules per Phase 2 PR

Each Phase 2 PR MUST declare its expected field paths in its description, mirroring `success-metrics.md §4.3`. The `scripts/README.md` "–expect paths per PR" table is the canonical mapping; reproduced and extended here:

| PR | Expected diff paths | Notes |
|----|---------------------|-------|
| **P0-1** (pipeline reorder + threaded expansion fields) | `--expect=expansionDistance` `--expect=decisionConfidence` `--expect=audioSource` | The biggest expected diff: real distance reaches OCSE; `audioSource` field appears on `OrcaNode`. All other paths unchanged. |
| **P0-2** (GRE/Layer 6 ownership per `decisions/gre-vs-layer6.md`) | `--expect=userTerritoryRelationship` `--expect=stateConfidence` `--expect=relationshipTransition` | Vocabulary contamination eliminated. `09-territory-rows.json` will look very different — that's the point. |
| **P1-3** (GRE confidence floor → config) | `--expect=confidence` (specifically GRE `GenreRelationship.confidence` — use `--expect=relationships` if too broad) | Distribution widens below 0.5. |
| **P1-4** (OCSE per-stage constants → config) | `--expect=relationshipSupport` `--expect=stageModifier` | Per-stage constants move; downstream `decisionConfidence` distribution may shift slightly. |
| **P1-7** (CUB canonical, ORE aggregate removed) | `--expect=discoveryConfidence` | ORE's `relationshipConfidence` removed; CUB is sole aggregator. |
| **P1-8** (Spotify cache wired) | no field diff | Runtime-only change (API call counts). Add a per-engine counter to the harness if you want this visible. |
| **P1-9** (per-source confidences + expansion weights → config) | `--expect=confidence` (per-source) `--expect=acousticDistance` `--expect=culturalDistance` `--expect=identityDistance` | Many small numeric shifts as constants move. |
| **P1-10** (audioSource honesty flag) | `--expect=audioSource` `--expect=audioSignature` | New field populated; synthetic fallback tagged. |
| **P1-13** (`/api/orca/expand` routes through pipeline) | (no fixture diff — this is a route-level change; verify via integration test per M6) | |
| **P2-11** (`projectionCheckpoints` resolution) | `--expect=projectionWindow` `--expect=visible` `--expect=reachable` | WPE window formula may shift at interior slider positions. |
| **P2-14** (dead code removed) | no diff at all | Pure deletion; if the diff shows anything, the deletion changed behaviour and must be investigated. |

> A Phase 2 PR is **not** green until `diff-baselines.ts` exits 0 against the declared `--expect` flags for every one of the 8 sample users. An unexpected change is a blocking review fail per `architecture-rules.md` cheat sheet.

---

## 5. Coverage gaps and known limitations

Documented so Phase 2 reviewers don't mistake absence for correctness:

1. **Stage `02` (CUB `Candidate[]`) is not captured as a standalone file.** The script reconstructs stubs from frontier nodes for the OCSE trace (§3.3). This means the diff cannot directly catch a regression in CUB's merge logic. Phase 2 P1-7 should add a real `.02-cub.json` capturing `universe.candidates` pre-OCSE.
2. **Stage `10` (`/api/globe` response) is manual.** Globe is pure projection (no rebuild, no `process.env` mutation). In-process handler still needs request context (`snapshotVersion`, session); harness may leave a placeholder. Diff may skip this stage.
3. **`08-profile.json` may be a fresh recompute.** If `User.profileData` is null, the script recomputes in-memory; this gives a different result every run for an unsynced user. Populate `User.profileData` before capturing.
4. **`09-territory-rows.json` only captures already-written rows.** The script does not invoke the territory chain; if you want fresh territory rows, run `POST /api/user/explore` (or let sync fire) before re-capturing.
5. **Date objects don't round-trip cleanly.** Sub-fields of `OrcaNode.candidateEvidence` containing `Date` objects appear as ISO strings in the JSON. The diff treats these as strings; a regression that changes a `Date` to a different ISO string will surface as a CHANGE.
6. **No array-order normalization.** The diff compares arrays index-by-index. If a Phase 2 PR changes sort order without changing content, every shifted element shows as a CHANGE. Phase 2 PRs that legitimately reorder (e.g. a new sort) MUST declare `--expect=nodes` or sort-stable the output before capture.

---

## 6. Phase 2 binding rules for fixtures

1. **Never commit `scratch-fixtures/`.** It is gitignored (per `.gitignore`). Baselines are per-developer, per-database; committing them creates false-conflict noise.
2. **Every Phase 2 PR description links to its declared `--expect` paths.** Reviewers reproduce the diff locally against their own baselines.
3. **Adding a new captured stage requires updating this doc, `capture-baseline.ts`, `diff-baselines.ts` `BASELINE_FILES`, and `scripts/README.md`.** The four are coupled; touching one without the others creates a silent diff skip.
4. **The fixture schema is frozen for Phase 2.** Renaming a stage file or changing the filename grammar breaks every existing baseline. If a rename is unavoidable, bump a `schemaVersion` field into `00-meta.json` and have `diff-baselines.ts` refuse to compare across versions.

End of `fixture-schema.md`.
