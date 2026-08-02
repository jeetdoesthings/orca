# Configuration Inventory (`docs/architecture/config-inventory.md`)

**Status:** Day 1 partial closeout. P1-3 / P1-4 / P1-7 / P1-9 config modules **exist and are wired**.  
**Authority:** remaining hardcoded rows below are residual hygiene — not proof work is undone. Prefer `src/lib/config/*` over new literals.

**Live config modules:** `cub.ts`, `gre.ts`, `ocse.ts`, `ore.ts`, `expansion.ts`, `genre-adjacency.ts`, `identity.ts`, `world.ts`, `request-runtime.ts` (regenerate + extras only).  
**Deleted:** `world-projection.ts` / `WorldProjectionConfig` (Ticket 3; WPE window formula inlined in `projectWorld`).  
**Deleted:** OCSE fabricated-distance weight keys — formula removed in P0-1 (not “fallback config”).

> Historical line-number tables below may drift. Treat module list above as truth; re-grep `src/` before moving more literals.

---

## 0. Already-configured (do NOT duplicate)

What's already in `src/lib/config/*.ts` — Phase 2 PRs adding new keys must NOT shadow these.

### `src/lib/config/cub.ts` (16 lines)
| Key | Value | Used at |
|-----|-------|---------|
| `genreMatchBoost` | `0.18` | `cub.ts:249` |
| `multiSourceDiversityMultiplier` | `0.12` | `cub.ts:252` |
| `maxPossibleConfidence` | `0.98` | `cub.ts:254` |
| `budgetPerOpportunity` | `150` | CUB search |
| `topOpportunitiesLimit` | `8` | CUB search |

### `src/lib/config/gre.ts` — existing keys (only weights for metrics, NOT for confidence aggregation)
The Phase 1 audit found `cfg.familiarityListenWeight`, `cfg.stabilityBaseOffset`, `cfg.stabilityVelocityWeight`, `cfg.stabilityDeltaWeight`, `cfg.identityCompatibilityWeight`, `cfg.identityMemoryWeight`, `cfg.recencyHalfLifeDays`, `cfg.diversityBaseLogMultiplier`, `cfg.stageCalibrationValues` (per-stage thresholds at `gre.ts:139`). **These cover metric computation but NOT the confidence aggregation at `gre.ts:165-168`** — see §1.

### `src/lib/config/ocse.ts` (33 lines)
| Key | Value | Used at |
|-----|-------|---------|
| `cooldownPenalties.ignoredMultiplier` | `0.5` | `decision-engine.ts:57` |
| `cooldownPenalties.dismissedMultiplier` | `0.3` | `:60` |
| `cooldownPenalties.recentShownLimitHours` | `24.0` | `:67` |
| `cooldownPenalties.recentShownPenalty` | `0.15` | `:68` |
| `cooldownPenalties.extendedShownPenalty` | `0.6` | `:70` |
| `cooldownPenalties.extendedShownLimitHours` | `72.0` | `:69` |
| `dimensionWeights.relationshipSupport` | `0.2` | `:82` |
| `dimensionWeights.growthContribution` | `0.2` | `:83` |
| `dimensionWeights.noveltyContribution` | `0.15` | `:84` |
| `dimensionWeights.discoveryConfidence` | `0.15` | `:85` |
| `dimensionWeights.timingContribution` | `0.15` | `:86` |
| `dimensionWeights.sliderCompatibility` | `0.15` | `:87` |
| `thresholds.highQuality` | `0.65` | `:94` |
| `thresholds.supportsGrowth` | `0.8` | `:97` |
| `thresholds.expandTaste` | `0.7` | `:100` |
| `thresholds.goodTiming` | `0.7` | `:103` |

### `src/lib/config/identity.ts` — confirmed wired (per Phase 1.5 verification) into Identity scoring at `cub.ts:42,104,107,114,130,141` (audit didn't enumerate keys; Phase 2 should run a `Read` of this file before re-using any value).

### `src/lib/config/world.ts` — referenced as `WorldConfig` (e.g. `WorldConfig.visibilityThreshold`, `WorldConfig.confidenceBands.{high,medium}` per `buildFrontierNodes.ts:485-494`).

### ~~`src/lib/config/world-projection.ts`~~ — **DELETED** Ticket 3. WPE uses formula in `projectWorld` (`0.20 + S*0.80` window max).
> **`projectionCheckpoints` is DEAD CODE — never read anywhere** (Phase 1.5 verification). The real WPE formula at `world-projection.ts:34` hardcodes `0.20 + S * 0.80` instead. See §3.

### `src/lib/profile/affinity-types.ts` — `DEFAULT_COMPATIBILITY_CONFIG` (weights, thresholds, embedding version) consumed by `territory-affinity.ts`. Correctly config-driven; not a Phase 1.5 audit finding.

---

## 1. `gre.ts` (Stage 2)

| File:line | Constant | Current use | Proposed config home | Notes |
|----------|----------|-------------|----------------------|-------|
| `gre.ts:165-168` | `0.5` (floor in `Math.max(0.5, ...)`) | confidence floor | `src/lib/config/gre.ts` → `confidenceFloor` (default `0.0` to honour spec `0.0 - 0.98` range) | **Phase 2 P1-3**. Today the spec range `0.0-0.98` (`backend-contract.md:38`) is unreachable below 0.5. |
| `gre.ts:165-167` | `0.98` (ceiling in `Math.min(0.98, ...)`) | confidence ceiling | `src/lib/config/gre.ts` → `confidenceCeiling` (default `0.98`) | P1-3 |
| `gre.ts:167` | `0.4` (identity weight) | confidence aggregation weight | `src/lib/config/gre.ts` → `confidenceWeights.identity` (default `0.4`) | P1-3 |
| `gre.ts:167` | `0.4` (familiarity weight) | confidence aggregation weight | `src/lib/config/gre.ts` → `confidenceWeights.familiarity` (default `0.4`) | P1-3 |
| `gre.ts:167` | `0.2` (stability weight) | confidence aggregation weight | `src/lib/config/gre.ts` → `confidenceWeights.stability` (default `0.2`) | P1-3 |
| `gre.ts:172` | `0.5` (`(familiarity + identity) / 2` — implicit 0.5/0.5 blend) | `relationshipStrength` summary blend | `src/lib/config/gre.ts` → `summaryWeights.strengthFamiliarity / strengthIdentity` (each `0.5`) | P1-3 |
| `gre.ts:173` | `0.5` (`(recency + stability) / 2`) | `relationshipMomentum` blend | `src/lib/config/gre.ts` → `summaryWeights.momentumRecency / momentumStability` (each `0.5`) | P1-3 |
| `gre.ts:139` | `stageCalibrationValues` thresholds → already config | ✓ already config | (none) | OK |
| `gre.ts:81-83, 94, 104, 112, 121` | familiarity/diversity/identity/recency/stability weights → already config | ✓ already config | (none) | OK |

> Net: GRE has ~7 literals that need config moves — all in P1-3. The rest is already config-driven.

---

## 2. `decision-engine.ts` OCSE (Stage 3)

| File:line | Constant | Current use | Proposed config home | Notes |
|----------|----------|-------------|----------------------|-------|
| `decision-engine.ts:22` | `0.5` (relationshipSupport for `CORE_IDENTITY`) | per-stage constant | `src/lib/config/ocse.ts` → `relationshipSupportByStage.CORE_IDENTITY` | **Phase 2 P1-4** |
| `:23` | `0.9` (`INTEGRATED`) | per-stage constant | `relationshipSupportByStage.INTEGRATED` | P1-4 |
| `:24` | `0.72` (`INTRODUCED`/`REDISCOVER`) | per-stage constant | `relationshipSupportByStage.INTRODUCED_REDISCOVER` | P1-4 |
| `:25` | `0.58` (`EXPLORING`) | per-stage constant | `relationshipSupportByStage.EXPLORING` | P1-4 |
| `:26` | `0.35` (`GROWING`) | per-stage constant | `relationshipSupportByStage.GROWING` | P1-4 |
| `:27` | `0.5` (`UNTUCHED` default — same as CORE_IDENTITY, suspiciously equal) | per-stage default | `relationshipSupportByStage.UNTUCHED` | P1-4 — note: same value as `CORE_IDENTITY`; verify intent |
| `:128` | `0.05` (stageModifier for `CORE_IDENTITY`) | per-stage constant | `src/lib/config/ocse.ts` → `stageModifierByStage.CORE_IDENTITY` | P1-4 |
| `:129` | `0.2` (`INTEGRATED`) | per-stage constant | `stageModifierByStage.INTEGRATED` | P1-4 |
| `:130` | `0.45` (`INTRODUCED`/`REDISCOVER`) | per-stage constant | `stageModifierByStage.INTRODUCED_REDISCOVER` | P1-4 |
| `:131` | `0.68` (`EXPLORING`) | per-stage constant | `stageModifierByStage.EXPLORING` | P1-4 |
| `:132` | `0.75` (`GROWING`) | per-stage constant | `stageModifierByStage.GROWING` | P1-4 |
| `:133` | `0.95` (`UNTUCHED`) | per-stage constant | `stageModifierByStage.UNTUCHED` | P1-4 |
| `:135` | `100` (denominator of `obscurity = 1.0 - popularity/100`) | popularity normalisation | `src/lib/config/ocse.ts` → `popularityScale` (default `100`) | P1-4 — Spotify popularity is 0-100 so this is right; still config-driven for clarity |
| ~~`:137`–`:141` fabricated expansionDistance weights~~ | **DELETED P0-1** | formula removed; no fallbackExpansionDistance config |

> Net: remaining OCSE per-stage rows above may already live in OcseConfig post P1-4 — re-grep before moving. Fabricated-distance block is closed.

---

## 3. WPE projection window (Stage 8)

| Constant | Current use | Status |
|----------|-------------|--------|
| `0.20 + S * 0.80` | `projectWorld` / `calculateProjectionWindow` | live formula; WorldProjectionConfig **deleted** Ticket 3 |
| Client duplicate (if still in OrcaHUD) | same window | residual P2-11 — share helper or trust server stats only |

> Net: dead projectionCheckpoints gone. Residual = optional client/server formula share.

---

## 4. `intelligence.ts` Expansion Intelligence (Stage 4)

| File:line | Constant | Current use | Proposed config home | Notes |
|----------|----------|-------------|----------------------|-------|
| `intelligence.ts:160` | `0.35` (acoustic weight in `expansionDistance` composite) | composite weight | `src/lib/config/expansion.ts` → `compositeWeights.acoustic` (default `0.35`) | **Phase 2 P1-9 — new file** |
| `:161` | `0.25` (cultural weight) | composite weight | `compositeWeights.cultural` (default `0.25`) | P1-9 |
| `:162` | `0.25` (identity weight) | composite weight | `compositeWeights.identity` (default `0.25`) | P1-9 |
| `:163` | `0.15` (familiarity weight; the formula uses `1.0 - familiarity`) | composite weight | `compositeWeights.familiarity` (default `0.15`) | P1-9 — **and see `confidence.md` §6 / `data-contracts.md §2.4` — `familiarity` duplicates the value used inside `identityDistance`, so this is the worst-documented weight** |
| `acousticDistance` (~lines 51-77) | 6-D Euclidean sub-weights (currently each axis implicit-weighted equal `1/6`) | acoustic feature space weighting | `src/lib/config/expansion.ts` → `acousticWeights.{energy,valence,danceability,acousticness,instrumentalness,tempo}` (each default `1.0` before normalisation; or normalised weights summing to 1) | P1-9 — Phase 2 should check inside this function for any hardcoded axis multiplier |
| `culturalDistance` (~lines 92-113) | weighted Jaccard sub-weights | genre-cultural distance weighting | `src/lib/config/expansion.ts` → `culturalWeights.{...}` | P1-9 — same caveat |
| `identityDistance` (~lines 126-135) | `0.4 * familiarity + 0.3 * identity + 0.3 * recency` (establishedness blend) | identity distance establishedness blend | `src/lib/config/expansion.ts` → `identityWeights.{familiarity,identity,recency}` (defaults `0.4 / 0.3 / 0.3`) | **P1-9 — these are HARDCODED today** (per Phase 1.5 audit: `establishedness = 0.4 * familiarity + 0.3 * identity + 0.3 * recency`) |

> Net: Expansion Intelligence has ~12+ literals that need config moves — all in P1-9 with new file `src/lib/config/expansion.ts`. P1-9 also documents the *familiarity duplication* design choice (the value flows into both identity and the standalone familiarity term — see `data-contracts.md §2.4` + `confidence.md §6`).

---

## 5. `ore.ts` ORE (Stage 1 retrieval)

| File:line | Constant | Current use | Proposed config home | Notes |
|----------|----------|-------------|----------------------|-------|
| `ore.ts:166, 170` | `0.95` (LASTFM_SIMILAR per-source confidence) | per-source confidence (Family A per `confidence.md §5.2`) | `src/lib/config/ore.ts` → `sourceConfidence.LASTFM_SIMILAR` | **Phase 2 P1-9 — new file** |
| `:219, 223` | `0.9` (SPOTIFY_METADATA) | per-source confidence | `sourceConfidence.SPOTIFY_METADATA` | P1-9 |
| `:277` | `0.7` (LASTFM fallback match strength) | per-source confidence fallback | `sourceConfidence.LASTFM_FALLBACK` | P1-9 |
| `:281` | `0.8` (SCENE_EXPANSION — verify which source type) | per-source confidence | `sourceConfidence.SCENE_EXPANSION` | P1-9 |
| `:344, 348` | `0.75` (GENRE_EXPANSION) | per-source confidence | `sourceConfidence.GENRE_EXPANSION` | P1-9 |
| `:411` | `0.7` and `0.15` in `0.7 + (sourcesCount - 1) * 0.15` | ORE aggregate confidence (DUPLICATE of CUB's C4 — per `confidence.md §3.1`, ORE stops computing aggregate confidence) | **DELETE under P1-7** — not config; the formula is being removed | P1-7 |
| `:470, 474` | `0.6` (HIDDEN_POTENTIAL) | per-source confidence | `sourceConfidence.HIDDEN_POTENTIAL` | P1-9 |
| `:583, 585` | `1.0` (SEED artist) | per-source confidence | `sourceConfidence.SEED` | P1-9 |
| `:618, 622` | `0.8` (NEIGHBOR_NETWORK or similar) | per-source confidence | `sourceConfidence.NEIGHBOR_NETWORK` (verify key name) | P1-9 |
| `:656, 660` | `0.7` (label/collab network) | per-source confidence | `sourceConfidence.{LABEL,COLLAB}_NETWORK` (verify) | P1-9 |
| `:692, 696` | `0.65` (USER_HISTORY or similar) | per-source confidence | `sourceConfidence.USER_HISTORY` (verify) | P1-9 |

> Net: ORE has ~11 per-source confidence literals + 1 aggregate-meaning-to-be-deleted. All within P1-9 (or P1-7 for the deletion). Needs a final pass through `ore.ts:160-700` to map every source type to a confidence value and a config key name.

---

## 6. `buildFrontierNodes.ts` (Stage 1.5/2/4 — geometry + synthetic audio)

| File:line | Constant | Current use | Proposed config home | Notes |
|----------|----------|-------------|----------------------|-------|
| `:412` | `0.3` (`weight` for frontier nodes) | candidate node default weight | `src/lib/config/world.ts` → `frontier.nodeWeight` (default `0.3`) | **Phase 2 P1 — new key** |
| `:434` | `0.4` (`pullFactor` toward explored neighbours) | frontier-node layout pull toward adjacency | `src/lib/config/world.ts` → `frontier.adjacencyPullFactor` (default `0.4`) | P1 — new key |
| `:440` | `1.65` (globe radius) and `1.008` (multiplier) | frontier-node target radius | `src/lib/config/world.ts` → `frontier.globeRadius` (= `1.65`), `frontier.radiusMultiplier` (= `1.008`) | P1 — these also appear duplicated in `graph/layout.ts` (per Phase 1.5 audit) — share a single config constant across both |
| `:456-462` | `0.45, 0.3, 0.25, 0.2, 0.5, 0.25, 0.3, 0.2, 0.35, 0.2, 0.65, 75, 80, 25, 0.55, 0.15, 0.01, 0.99, 0.1` (synthetic AudioSignature coefficients and clamps) | synthesised audio signature hash→signature mapping | `src/lib/config/expansion.ts` → `syntheticAudio.{...}` (defaults matching today) **OR** remove this code entirely (P1-10 prefers reading real audio features from Artist record) | **Phase 2 P1-10** — preferable: read real AudioSignature from synced Artist record; fall back to these constants ONLY when no real data exists, and tag the node with `audioSource: 'SYNTHETIC'` |
| `:449` | hash from `artist.id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)` | deterministic-per-artist seed | (keep as-is; just tag fallback) | P1-10 |
| `:464-464` | `''` (imageUrl fallback chain `?? images[1] ... ?  ''`) | n/a | n/a | OK |
| `:544` | `500` (slice cap on returned frontier nodes) | frontier node count cap | `src/lib/config/world.ts` → `frontier.maxNodes` (default `500`) | P1 — new key |

> Net: `buildFrontierNodes.ts` has ~16 geometry + ~7 synthetic-audio literals. Geometry moves to `src/lib/config/world.ts` under new `frontier.*` keys (P1 — modest scope). Synthetic audio is the largest: ~20 magic numbers but mitigate against by P1-10 (read real data first, fall back only when missing).

> **Cross-file duplication flagged per Phase 1.5 audit:** the same synthetic AudioSignature block is duplicated at `spotifySync.ts:650-671`. P1-10 fixes both in the same pass.

---

## 7. `cub.ts` and `ore.ts` (Stage 1 — `GENRE_ADJACENCY`)

| File:line | Constant | Current use | Proposed config home | Notes |
|----------|----------|-------------|----------------------|-------|
| `ore.ts:5-17` | `GENRE_ADJACENCY` (11-key genre map, copy-pasted verbatim) | genre neighbourhood for ORE/CUB retrieval and discovery | `src/lib/config/genre-adjacency.ts` → NEW shared module | **Phase 2 P1-7** — both files import from a single source |
| `cub.ts:54-66` | `GENRE_ADJACENCY` (identical 11-key map) | same — used in classifyCandidate logic | import from same new module | P1-7 |

> Net: 2 copies of 1 map, both byte-for-byte identical (Phase 1.5 verification confirmed 11 keys including `house: ['uk-garage','techno','tech-house','ambient','dance-pop']` matched verbatim). P1-7 deduplicates into a new shared config module.

---

## 8. `profile/territory-relationship.ts` (Stage 7 Layer 6 — state-machine thresholds)

Per Phase 1.5 audit, the 10-state machine at `territory-relationship.ts:225-251` uses a threshold matrix. Phase 2 should extract this into config:

| Block | File:line (approx) | What | Proposed config home | Notes |
|-------|---------------------|------|----------------------|-------|
| 10-state transition thresholds | `:225-251` | state-machine gating values | `src/lib/config/territory-relationship.ts` → NEW | Phase 2 P1-9 (extension) — Phase 2 should do a focused read of `:225-251` plus the helpers `calculateRelationship`, `calculateLongitudinalConfidence`, `calculateMomentumScore` (`:482-540`) to extract thresholds |
| Stage → scalar mappers used by `profile-engine.ts:416` `calculateIdentityValue` lookup (`STABILIZED → 95, RESIDENT → 75, else → 30`) | (check `profile-engine.ts:416` and the helpers it imports) | identity-score lookup table | `src/lib/config/territory-relationship.ts` → `identityValueByState` map (or similar) | Phase 2 — minor |

> Net: `territory-relationship.ts` has at least 1 large threshold block plus several scalar mappers. Phase 2 P1-9 scoped to include a Layer 6 sweep.

---

## 9. `ore.ts` and `cub.ts` (Stage 1 — `SYSTEM_GENRES`)

| File:line | Constant | Current use | Proposed config home | Notes |
|----------|----------|-------------|----------------------|-------|
| `gre.ts:12-24` | `SYSTEM_GENRES` (11-element array) | the 11 genres GRE knows + that ORE/CUB adjacency map keys cover | `src/lib/config/genre-adjacency.ts` → re-export `SYSTEM_GENRES` next to `GENRE_ADJACENCY` (single source of truth) | P1-7 — Phase 1.5 audit flagged this duplication `gre.ts:12-24 + ore.ts:5-17` |

---

## 10. Summary tally

| Engine | # literals to move to config | Phase 2 plan items | Difficulty |
|--------|------------------------------|--------------------|-----------| 
| GRE (`gre.ts`) | 7 | P1-3 | S |
| OCSE (`decision-engine.ts`) | residual after P1-4 (fabricate-distance **deleted**) | P1-4 done; re-grep | residual |
| WPE (`world-projection.ts` + `OrcaHUD.tsx:193` + dead `projectionCheckpoints`) | 3 (2 formula literals + 1 dead table) | P2-11 | S |
| Expansion Intelligence (`intelligence.ts`) | ~12 (composite + sub-weights) | P1-9 | M |
| ORE (`ore.ts` per-source confidences; aggregate to be deleted) | ~11 + 1 delete | P1-7, P1-9 | M |
| CUB (`cub.ts` — already mostly config-driven) | 0 to add (maxBase is `Math.max(...sources.confidence)` — derived from C2) | (none) | (none) |
| buildFrontierNodes (geometry + synthetic audio) | ~16 geometry literals + 20 synthetic-audio literals | P1-10 + a new P1 for frontier geometry | M |
| `GENRE_ADJACENCY` / `SYSTEM_GENRES` duplicate | 11 keys × 2 copies → 1 shared module | P1-7 | S |
| `territory-relationship.ts` state machine | 1 threshold block + helpers | P1-9 (scoped to Layer 6) | M |

> **Bundle estimate for Phase 2 P1-3 + P1-4 + P1-9 + P1-7 + P1-10 + P2-11:** ~70 hardcoded constants moved into config, ~3 new config files (`ore.ts`, `expansion.ts`, `genre-adjacency.ts`), ~2 dead-or-stub items removed (ORE aggregate confidence, projectionCheckpoints). All in the **S-M per-bundle** difficulty band.

End of `config-inventory.md`.
