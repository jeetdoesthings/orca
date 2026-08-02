# ORCA Backend Fix Audit (Phase 0)

**Status:** Read-only audit complete — no product code changed.  
**Date:** 2026-07-12  
**Authority:** Live `src/` and `docs/architecture/` are source of truth.  
**Source plan:** [`ORCA_Backend_Fix_Plan.md`](../../ORCA_Backend_Fix_Plan.md)  
**Do not proceed to Phase 1 until this report is reviewed.**

---

## 1. Tech stack summary

| Layer | Choice |
|-------|--------|
| Language | TypeScript |
| App framework | Next.js 16 (App Router), React 19 |
| 3D UI | Three.js + React Three Fiber + Drei + postprocessing (custom globe, **not** globe.gl) |
| Graph layout (client) | `d3-force-3d` |
| Auth | NextAuth + Prisma adapter (Spotify OAuth) |
| Database | SQLite via Prisma (`prisma/dev.db`) |
| State (client) | Zustand |
| Tests | Vitest |
| Deployment | Not hardcoded; standard Next (`next build` / `next start`). Prisma generate in build script. |
| Backend organization | Monolith modules under `src/lib/*` + route handlers under `src/app/api/*`. No separate microservice process. |

### Module map (backend)

| Concern | Path |
|---------|------|
| Identity / Spotify sync | `src/lib/spotifySync.ts`, `identity.ts` |
| Candidate universe | `src/lib/candidate/cub.ts`, `ore.ts` |
| Genre relationships | `src/lib/gre/*` |
| Expansion distance | `src/lib/expansion/intelligence.ts` |
| Decision scoring | `src/lib/ocse/*` |
| Pipeline / materialize | `src/lib/frontier/pipeline-runner.ts`, `buildFrontierNodes.ts` |
| Projection | `src/lib/frontier/world-projection.ts` |
| Profile / territory | `src/lib/profile/*` |
| Outcome metrics (TEM) | `src/lib/metrics/tem.ts` |
| Multi-vendor identity | `src/lib/lastfm.ts`, `artists/enrich-identity.ts` |
| Config | `src/lib/config/*` |
| Schema | `prisma/schema.prisma` |

### Canonical product path

```
Spotify sync / Identity
  → CUB (+ORE) → GRE → Expansion Intelligence → OCSE → layout
  → materializeWorld → (optional profile/territory)
  → WPE on GET /api/globe → Frontend
```

Sole stage runner: `buildFrontierNodes` (only via `materializeWorld` in product code).  
Sole world writer: `materializeWorld`.  
Sole projector: `projectWorld`.

---

## 2. Per-stage inventory

| Stage | Code name | Status | Inputs | Outputs | Gaps |
|-------|-----------|--------|--------|---------|------|
| 0 | **Identity Builder** (`processAndStoreUserData`) | Fully working | Spotify OAuth token, userId | `User.globeData`, `profileData`, homeRegion, tasteSummary, Artist metadata + optional REAL audio | Still calls dead `/audio-features`; falls back to SYNTHETIC |
| 1a | **CUB** (`buildCandidateUniverse`) | Partially working | userId, DB listens/memories/GRE state | `Candidate[]` + discoveryConfidence | `accessToken` unused; scene/festival source types unused; growth stages depend on GRE persist which product never runs |
| 1b | **ORE** (`ORCARetrievalEngine`) | Fully working (degraded if related-artists dies) | Seed artists | Multi-source candidates, Artist cache | Primary path still uses Spotify related-artists |
| 2 | **GRE** (`computeGenreRelationships`) | Partially working | Listens, memories, affinities, momentum, prior GRE rows | In-memory `GenreRelationship[]` (7-state) | **Persist is debug-only** — product path never calls `persistGenreRelationships` |
| 3 | **Expansion Intelligence** | Fully working | Centroid, genre profile, GRE, candidate signature/genres/`audioSource` | `expansionDistance`, band, value | Cultural = genre Jaccard only; acoustic dead without REAL features |
| 4 | **OCSE** (`evaluateCandidateUniverse`) | Fully working (history stub) | Candidates + GRE + slider + interaction history | `DecisionProfile[]` (decisionConfidence) | Interaction counters stubbed; no Readiness/Diversity/Confidence-tag DecisionScore from fix plan |
| 5 | **Layout** (inline in `buildFrontierNodes`) | Fully working | Candidates + EI + OCSE | `OrcaNode[]` state=`frontier` | Legacy score helpers dead; some Spotify helpers unused |
| 6 | **Materialize** (`materializeWorld`) | Fully working | userId, options | frontierData, worldStateData, status | — |
| 7 | **Profile + Territory** L3→4→6→7→8 | Working if territory seeded | Nodes, territory memberships | profileData, territory tables | Soft-skips if no Territory catalog; Layer-6 10-state separate from GRE |
| 8 | **WPE** (`projectWorld`) | Fully working | Snapshot nodes + slider | Visibility-adjusted clone | Read-only; never rebuilds |

### Supporting (not stages)

| Component | Status | Notes |
|-----------|--------|-------|
| TEM (`metrics/tem.ts`) | Implemented, **not live ranking** | Retrospective F×D×A×M; closest to fix-plan “TES” |
| Anti-hallucination | Working | Filters ungrounded frontier nodes before write |
| Agency calibration job | **Missing** | Fixed v0 weight table only |
| Identity EMA feedback | **Missing** | No TES-scaled centroid update |
| Cold-start onboarding API flag | **Incomplete** | `ExpansionConfig.coldStartBaseline` exists; no full onboarding + response flag |
| Territory-wide “not for me” | **Missing** | Artist ignore exists; no territory-level reject |
| ANN / all-pairs territory cache | **Missing / partial** | No FAISS/HNSW; adjacency is config-driven |

---

## 3. Confirmed definitions: OCSE and GRE

### OCSE — confirmed (guess was directionally right, name incomplete)

| Item | Value |
|------|--------|
| **Guess in fix plan** | “Open Candidate Scoring Engine” / decision-scoring stage that ranks candidates |
| **Actual** | Product engine at `src/lib/ocse/decision-engine.ts`. Source does not hardcode a single full expansion string; architecture docs treat **OCSE** as the candidate **decision** engine. Role: evaluate each candidate on 6–7 semantic dimensions → `decisionConfidence`; pure reader of `expansionDistance` (EI owns distance). |
| **Guess accuracy** | **Mostly right on role** (scores candidates for recommendation). **Wrong on formula:** not `TES × Readiness × Diversity × Confidence`. Live formula is a **weighted sum** of relationship/growth/novelty/discovery/timing/slider × cooldown. |
| **Does not** | Compute expansion distance, write frontier, layout nodes, or implement Readiness recovery / batch Diversity as specified in fix-plan Part 7 |

### GRE — confirmed (guess was wrong on states)

| Item | Value |
|------|--------|
| **Guess in fix plan** | “Genre Readiness Engine”; 6-state Unexplored→Curious→Exploring→Resident→Dormant→Returning |
| **Actual** | **Genre Relationship Engine** — `src/lib/gre/gre.ts` |
| **7 states** | `UNTUCHED` \| `INTRODUCED` \| `EXPLORING` \| `GROWING` \| `INTEGRATED` \| `CORE_IDENTITY` \| `REDISCOVER` |
| **Guess accuracy** | **Wrong acronym expansion** (not “Readiness”). **Wrong state vocabulary** (7 vs 6; different names). **Right idea** that it tracks relationship-to-genre over time. |
| **Assignment model** | Absolute multi-threshold cascade each run — **not** an edge-triggered transition matrix with min-dwell / hysteresis |
| **Persistence** | Table `UserGenreRelationshipState`. Product path computes GRE but **does not persist** (only debug route does). Layer 6 owns separate 10-state territory relationships. |

Approximate mapping fix-plan → live GRE (for later Parts 8/11, **do not rename enums without product decision**):

| Fix-plan | Live GRE |
|----------|----------|
| Unexplored | `UNTUCHED` |
| Curious | `INTRODUCED` |
| Exploring | `EXPLORING` / `GROWING` |
| Resident | `INTEGRATED` / `CORE_IDENTITY` |
| Dormant / Returning | `REDISCOVER` |

---

## 4. External API inventory

### Spotify

| Endpoint | File(s) | Purpose | Live / restricted |
|----------|---------|---------|-------------------|
| `POST /api/token` | lastfm.ts, nextauth, artist-details, image | Auth | **Live** |
| `GET /v1/me` | spotifySync | Profile | **Live** (user OAuth) |
| `GET /v1/me/top/artists` | spotifySync | Identity seeds | **Live** |
| `GET /v1/me/player/recently-played` | spotifySync | Identity | **Live** |
| `GET /v1/me/tracks` | spotifySync | Library | **Live** |
| **`GET /v1/audio-features?ids=`** | **spotifySync.ts** | REAL audio signatures | **Restricted/dead for this use case (Nov 2024 / Mar 2026)** |
| **`GET /v1/artists/{id}/related-artists`** | lastfm.ts, buildFrontierNodes, ORE SpotifyProvider | Candidate expansion | **Restricted/dead for this use case** |
| `GET /v1/artists`, `/artists/{id}` | enrich-identity, sync | Metadata | **Live** |
| `GET /v1/search?type=artist` | lastfm, frontier, details, image | Name resolve | **Live** |
| `GET /v1/artists/{id}/top-tracks` | artist-details, preview | UI + preview_url | **Live** (previews often null) |
| `GET /v1/artists/{id}/albums` | artist-details | UI | **Live** |
| `/audio-analysis` | — | — | **Not called** |
| `/recommendations` | — | — | **Not called** |

**Impact of dead endpoints:**

1. **audio-features:** Sync still calls it. On failure → `resolveAudioSignature` → **SYNTHETIC**. EI then **drops acoustic** from expansion distance (P1-10 honesty). Acoustic component effectively offline for most/all users.
2. **related-artists:** ORE still prefers it; code already treats 401/403 as catalog restricted. Degrades to Last.fm / MusicBrainz / local graph / adjacency.

### Last.fm

| Method | Purpose | Status |
|--------|---------|--------|
| `artist.getInfo` | Tags, bio, listeners | Live (API key, rate-limited 5/s) |
| `artist.getSimilar` | ORE / frontier similar | Live |
| `artist.getTopAlbums` / `getTopTracks` | Details panel fallback | Live |

### Deezer

| Endpoint | Purpose | Status |
|----------|---------|--------|
| `api.deezer.com/search/artist` | Image / identity only | Live — **not** used for preview audio embeddings yet |

### MusicBrainz

| Endpoint | Purpose | Status |
|----------|---------|--------|
| `/ws/2/artist/?query=…` | Search | Live (1 req/s) |
| `/ws/2/artist/{id}?inc=url-rels` | Wiki links / images | Live |
| `/ws/2/artist/{id}?inc=artist-rels+label-rels` | ORE collab graph | Live |

### Wikipedia / Wikidata / Commons

Image enrichment only (enrich-identity, image routes). Live.

### Apple Music / MusicKit

**None.**

### Synthetic / placeholder audio (workaround)

| Mechanism | Location | Behavior |
|-----------|----------|----------|
| `synthesizeAudioSignature` | `src/lib/audio/resolve-signature.ts` | Hash(artistId) + genre keywords → 6-dim signature; source = `SYNTHETIC` |
| `NEUTRAL_AUDIO_SIGNATURE` | same | Mid defaults for `MISSING` |
| Honesty | EI `computeExpansionDistanceFromInputs` | Non-`REAL` → acoustic weight removed, obscurity + microSpread |
| Preview UI | `audioPreview.ts` | No-ops (“Spotify preview disabled”) |

**Conclusion:** Synthetic audio is the **production path**, not a rare fallback. Phase 1 must treat it as architecture to replace, not a temporary demo hack.

---

## 5. Exact current formulas (quoted)

### 5.1 Familiarity (GRE — genre-level exposure)

Config (`src/lib/config/gre.ts`):

```ts
familiarityListenWeight: 0.015,
familiarityMemoryWeight: 0.12,
familiarityUniqueWeight: 0.08,
```

Compute (`src/lib/gre/gre.ts`):

```ts
const familiarity = Math.min(
  1.0,
  listenCount * cfg.familiarityListenWeight +
  memoryCount * cfg.familiarityMemoryWeight +
  uniqueExploredCount * cfg.familiarityUniqueWeight
);
```

**Not** `plays / expected_plays`. **Not** Bayesian `observed/(observed+k)` (fix-plan Part 2).

Other familiarity formulas exist in territory mapping / TCE (separate scopes).

### 5.2 ExpansionDistance (live ranking “foreignness”)

Weights (`src/lib/config/expansion.ts`):

```ts
distanceWeights: {
  acoustic: 0.35,
  cultural: 0.25,
  identity: 0.25,
  familiarity: 0.15
}
```

**Acoustic** — Euclidean on 6 dims / √6:

```ts
// intelligence.ts
const raw = euclideanDistance(userVec, artistVec);
return clamp01(raw / Math.sqrt(6));
```

**Cultural** — genre-weight overlap (not linguistic/scene/era):

```ts
// intelligence.ts
return 1.0 - clamp01(sharedWeight / totalArtistWeight);
// empty signal → 1.0
```

**Identity distance** — from GRE metrics:

```ts
const establishedness =
  ew.familiarity * familiarity + ew.identity * identity + ew.recency * recency;
return 1.0 - clamp01(establishedness);
```

**Composite (REAL only):**

```ts
return clamp01(
  dw.acoustic * acoustic +
  dw.cultural * cultural +
  dw.identity * identity +
  dw.familiarity * (1.0 - familiarity),
);
```

**Non-REAL:** acoustic dropped; cultural/identity/familiarity + obscurity (from popularity) + microSpread renormalized.

### 5.3 TEM Foreignness / Durability / Agency / TES-style score

TEM is **retrospective**, not live ranking.

**Foreignness:**

```ts
// tem.ts
const exposurePenalty = Math.min(1.0, exposureCount / 50.0);
const recencyPenalty = Math.max(0.0, 1.0 - daysSinceLastExposure / 180);
return Math.max(0.0, 1.0 - (exposurePenalty * 0.7 + recencyPenalty * 0.3));
// no baseline events → 1.0
```

**Durability:** 9 windows over 90 days; later windows weight `1.2^i`; AUTOPLAY/SKIP excluded; intensity `log10(1+count)/log10(10)`.

**Agency v0 weights:**

```ts
agencyWeights: {
  SEARCH: 1.0, ARTIST_PAGE: 0.9, PLAYLIST_CREATED: 0.85, LIBRARY_SAVE: 0.8,
  VOLUNTARY_REVISIT: 0.6, RECOMMENDATION: 0.3, AUTOPLAY: 0.1, BACKGROUND: 0.05,
  PLAY: 0.5, COMPLETE: 0.5, SAVE: 0.8, PLAYLIST_ADD: 0.85, REPLAY: 0.6, SKIP: 0.0,
}
// mean of weights over non-SKIP events; default missing type → 0.5
```

**Territory Expansion Score (TES analog):**

```ts
return foreignness * durability * agency * meaningfulness;
```

User-level TEM: `1 - exp(-totalScoreSum * 0.5)`.  
**No immutable snapshot table; no pending vs confirmed-zero durability states.**

### 5.4 OCSE decisionConfidence

```ts
// decision-engine.ts
let decisionConfidence = (
  relationshipSupport * 0.2 +
  growthContribution * 0.2 +
  noveltyContribution * 0.15 +
  discoveryConfidence * 0.15 +
  timingContribution * 0.15 +
  sliderCompatibility * 0.15
) * cooldownMultiplier;
// clamp [0,1], round 2 decimals
```

Dimensions: GRE stage support, growth (visible-world), novelty = `1 - familiarity`, CUB discoveryConfidence, timing = avg(stability, recency), slider fit; cooldowns for integrate/ignore/dismiss/recent-shown.

**Missing vs fix plan Part 7:** Readiness recovery, batch Diversity, confidence-tag term, weighted geometric mean, TES as factor.

### 5.5 GRE stage assignment (thresholds, not transition edges)

Priority cascade (`gre.ts` + `GreConfig.stageCalibrationValues`):

1. CORE_IDENTITY if fam>0.68 & div>0.48 & id>0.65 & rec>0.45  
2. INTEGRATED if fam>0.48 & div>0.38 & id>0.45 & rec>0.35  
3. GROWING if rec>0.5 & fam>0.22 & stab>0.5  
4. EXPLORING if rec>0.45 & div>0.3 & fam≤0.42  
5. REDISCOVER if fam>0.45 & rec≤0.25  
6. INTRODUCED if fam>0.08 **or** rec>0.2  
7. else UNTUCHED  

**Missing:** directed transition rules, min durable expansions, inactivity dwell, hard rejection → Dormant, hysteresis.

Other GRE metrics:

| Metric | Formula |
|--------|---------|
| Diversity | `min(1, uniqueArtists / max(1, log2(listenCount+1) * 2.2))` |
| Identity | `min(1, compat*0.6 + avgMemoryPersistence*0.4)` |
| Recency | `min(1, exp(-daysSinceLast / 25))` |
| Stability | `clamp01(0.5 + velocity*6 + delta*2.5)` |
| Confidence | `clamp(0.4*id + 0.4*fam + 0.2*stab, 0, 0.98)` |

---

## 6. Design system values

### Ocean-named tokens (`shallows`, `chalk`, `lagoon`, `tide`)

**None in code.** Ocean language is marketing copy only.

### Landing palette (`src/app/landing/landing.css`)

| Token | Hex |
|-------|-----|
| `--orca-base` | `#FBFCFE` |
| `--orca-ink` | `#0B0F1A` |
| `--orca-accent` | `#1D3FBF` |
| `--orca-accent-tint` | `#E7ECFA` |
| `--orca-muted` | `#5B6478` |

### App shell (`globals.css`)

| Use | Value |
|-----|--------|
| Body bg | `#F7F7F5` |
| Text | `rgba(0,0,0,0.87)` |
| HUD ink | `#111118` |
| Loading gradient | `#ffffff` → `#F7F7F5` → `#ECEDE8` |

### Typography

| Surface | Stack |
|---------|--------|
| App / globe | **Inter** (200–600), system fallbacks |
| Landing display | **Cabinet Grotesk** |
| Landing body | **Inter Tight** |
| Landing mono | **Geist Mono** |

### Globe implementation

| Check | Result |
|-------|--------|
| globe.gl | **Not installed / not used** |
| Hand-built SVG globe | **Not used** |
| **Actual** | Custom **Three.js + R3F** glass sphere (`GlobeShell.tsx` shaders + `Orca.tsx` Canvas + `NodeField` / edges / particles) |
| Layout physics | Client `d3-force-3d` in graph layout; server frontier layout is anchor-based in `buildFrontierNodes` |

Fix-plan note about “SVG substituted for globe.gl” is **stale** relative to current code.

Genre node colors: soft cinematic palette in `genre-normaliser.ts` (e.g. hip-hop `#C95C8A`, house `#5FB5D4`, pop `#B7A8D6`).

---

## 7. Prioritized: broken vs incomplete vs missing

### Broken / actively failing by design dependency

| Priority | Item | Evidence |
|----------|------|----------|
| **P0** | Spotify `/audio-features` still called; REAL path dead | `spotifySync.ts` |
| **P0** | Spotify `/related-artists` still primary retrieval | ORE, lastfm.ts, frontier helpers |
| **P0** | Acoustic expansion weight offline (almost always SYNTHETIC/MISSING) | resolve-signature + EI honesty path |
| **P1** | GRE computed but **not persisted** on product path → CUB growth stages stay cold | only debug route persists |

### Incomplete (exists but underspecified or stubbed)

| Priority | Item |
|----------|------|
| **P1** | Cultural distance = genre Jaccard only (no language / scene / era) |
| **P1** | Familiarity = linear GRE exposure, not pre-rec Bayesian formula; risk of overlap with TEM durability |
| **P1** | OCSE interaction history counters stubbed |
| **P2** | TEM exists but not wired as immutable TES snapshots + durability stream |
| **P2** | Agency weights fixed v0; no recalibration infra |
| **P2** | GRE absolute thresholds only — no transition graph / rejection → dormant |
| **P2** | Confidence tags REAL/SYNTHETIC/MISSING ≠ fix-plan real_audio/tag_inferred/cold_start_default; ArtistEmbedding.confidence is a float, different family |
| **P3** | Cold-start baseline constant only; no onboarding + API flag |
| **P3** | Deezer/MB used for identity images, not Tier-1 audio embeddings |

### Entirely missing (fix-plan Parts)

| Part | Capability |
|------|------------|
| 1 | Tiered Deezer preview → embedding model → permanent cache; MusicBrainz lineage backbone |
| 5 | Raw interaction event log + offlineable Agency recalibration job |
| 6 | Immutable TES snapshots; durability pending/zero/positive; freeze foreignness at rec time |
| 7 | Readiness / batch Diversity / tag Confidence / geometric mean DecisionScore |
| 8 | Directed GRE transition rules + OCSE Readiness wiring |
| 9 | Identity EMA centroid update scaled by TES |
| 10 | Cold-start onboarding flow + wider frontier + response flag |
| 11 | Territory-wide “not for me” action |
| 12 | ANN index; structure-invalidated all-pairs territory paths |
| 13 | Full lifecycle integration suite + CI forbidlist for dead Spotify endpoints |

### Already solid (do not rewrite casually)

- Day 1 pipeline discipline: one runner, one materializer, one projector  
- EI owns expansionDistance; OCSE pure reader (INV-5 / RULE-10)  
- GRE vs Layer 6 table split (P0-2)  
- CUB sole discoveryConfidence  
- Config modules for GRE/OCSE/Expansion weights  
- Multi-provider ORE fallback ladder (Last.fm, MB, adjacency)  
- Vitest coverage for EI honesty + OCSE pure-reader contracts  

---

## 8. Implications for Phase 1+

1. **Start with audio + confidence tags** (Part 1): remove/guard audio-features and related-artists; introduce permanent embeddings + three-valued confidence tags; map REAL/SYNTHETIC/MISSING carefully.  
2. **Wire GRE persist onto product materialize** early (small fix, unblocks CUB growth + later GRE transitions).  
3. **Do not rename GRE’s 7 states** to the fix plan’s 6 without a product decision.  
4. **TEM ≈ TES** for outcome immutability work; live ranking remains EI + OCSE.  
5. **Cultural distance is not “missing”** — it is **weak**; Part 3 extends it.  
6. **Frontend globe/design is out of scope** for backend fix; cold-start flag is the main API surface addition for FE.

---

## 9. Deliverable checklist (Part 0)

| Required section | Status |
|------------------|--------|
| Tech stack summary | §1 |
| Per-stage inventory table | §2 |
| Confirmed/corrected OCSE and GRE | §3 |
| External API inventory + live/dead | §4 |
| Exact formulas quoted | §5 |
| Design system + globe status | §6 |
| Prioritized broken / incomplete / missing | §7 |

**Stop here.** No code fixes until this audit is reviewed and Phase 1 is authorized.

---

## 10. Phase 1 implementation note (post-audit)

Phase 1 (Part 1) landed after this audit was reviewed:

- Spotify `/audio-features` and `/related-artists` **removed/guarded** (no live HTTP).
- Confidence tags `real_audio | tag_inferred | cold_start_default` threaded through resolve/EI/OCSE.
- `TrackEmbedding` write-once cache + Deezer preview client + HTTP embedder (`ORCA_EMBEDDING_URL`).
- Runbook: `src/lib/audio/README.md`.
