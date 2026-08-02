# Confidence Specification (`docs/architecture/confidence.md`)

**Status:** Day 1 complete for ownership of contested confidences. Part 1 audio tags added.  
**Authority:** binding disambiguation. `expansionDistance` is **not** a confidence (RULE-11).

**Resolved:**
- CUB sole `discoveryConfidence` (P1-7).
- EI owns `expansionDistance`; OCSE pure reader (P0-1).
- GRE `stateConfidence` on `UserGenreRelationshipState`; Layer 6 on territory table (P0-2).
- GRE confidence floor/weights → GreConfig (P1-3).
- `calculateIdentityValue` dead code deleted (Ticket 3).
- **Part 1 audio confidence tags:** `real_audio` | `tag_inferred` | `cold_start_default` (`src/lib/audio/confidence-tags.ts`). Legacy REAL/SYNTHETIC/MISSING normalize to these. Acoustic distance only when `real_audio`.

> Remaining text disambiguates families. Historical “duplicate today” language below may lag; prefer resolved list above when conflict.

---

## 1. Inventory: every "confidence" in the system

| ID | Name | File:line (owner) | Pipeline stage | Range | Persisted? | Canonical? |
|----|------|-------------------|----------------|-------|------------|-----------|
| C1 | `GreConfig` (none) — but **GRE `confidence`** is computed but never published as a config field | `gre.ts:165-168` (compute) | Stage 2 (GRE) | `0.5 - 0.98` (today) · `0.0 - 0.98` (spec `:38`) | transient (in `GenreRelationship.confidence`) | **Yes** (the GRE-side spec range), but the floor is hardcoded |
| C2 | **ORE `EvidenceSource.confidence`** | `ore.ts:20,166,170,219,223,...` | Stage 1 (ORE) | `0.0 - 1.0` | within `Candidate.discoveryContext.sources[*]` | Yes (per-source evidence) |
| C3 | **ORE per-source evidence only** | `ore.ts` | Stage 1 (ORE) | `0.0 - 1.0` | within sources | Per-source only — **not** aggregate discoveryConfidence (P1-7) |
| C4 | **CUB `discoveryConfidence`** (canonical) | `cub.ts` `calculateDiscoveryConfidence` | Stage 1 (CUB) | `0.0 - 0.98` | on Candidate | **Yes sole** (P1-7) |
| C5 | **OCSE `decisionConfidence`** | `decision-engine.ts` | OCSE (after EI) | `0.0 - 1.0` | DecisionProfile | **Yes** decision-quality |
| C6 | **Expansion Intelligence `expansionDistance`** (NOT confidence) | `intelligence.ts` | EI before OCSE | `0.0 - 1.0` | Candidate + OrcaNode | Distance only — §6 |
| C7 | **Territory `stateConfidence`** | Layer 6 only | post-materialize territory | varies | `userTerritoryRelationship` | **Resolved P0-2** — GRE uses own table |
| C7b | **GRE genre `stateConfidence`** | GRE | GRE persist | varies | `UserGenreRelationshipState` | **Resolved P0-2** |
| C8 | **Profile subsystem confidence fields** — `confidenceProfile`, `territoryAffinityConfidence`, `territoryFamiliarityConfidence`, `cultivationConfidence`, `interventionConfidence` | various in `src/lib/profile/*` | Stage 6 / 7 | `0 - 1` | persisted as JSON or in respective territory tables | Yes (each scoped to its own table) |

> Identity computes no confidence. `calculateIdentityValue` deleted (Ticket 3).  
> Expansion Intelligence emits distance/band/value only — not confidence.

---

## 2. Confidence families (grouped by purpose)

The 8 confidence concepts cluster into 5 *families*. Within each family the meaning is shared; across families the confidence numbers measure fundamentally different things.

### Family A — Source evidence confidence (per-path)
**Members:** C2 (ORE `EvidenceSource.confidence`).
**Meaning:** "How confident are we that this specific retrieval pathway (Last.fm similar, Spotify metadata, genre adjacency, etc.) identified a relevant candidate?"
**Range:** `0.0 - 1.0`.
**Owner:** ORE.
**When computed:** at retrieval time inside each `*Provider.retrieve` (`ore.ts ~160-700`).
**When consumed:** CUB merges sources and feeds them into `calculateDiscoveryConfidence` (C4).
**Mutable?** No (per-retrieval).
**Scalar values today:** `0.95` LASTFM_SIMILAR · `0.9` SPOTIFY_METADATA · `0.75` GENRE_EXPANSION · `0.8` SCENE_EXPANSION · `0.6` HIDDEN_POTENTIAL · `1.0` SEED artist · `0.7` fallback match → **all hardcoded magic numbers.** Phase 2 P1-9 moves these into `src/lib/config/ore.ts` as per-source-type defaults.

### Family B — Aggregate candidate confidence (CUB canonical)
**Members:** C3 (ORE `relationshipConfidence` — internal) · C4 (CUB `discoveryConfidence` — canonical).
**Meaning:** "How confident is the system that this candidate is a real, sourced, non-duplicate discovery?"
**Range:** `0.0 - 0.98` (per spec cap `:57`).
**Owner:** **CUB (canonical per spec `:46-62`, in particular `:59` "deduplicate. If multiple discovery pathways find the same artist, context sources are merged and confidence is scaled accordingly").**
**When computed:** CUB passes the candidates through `calculateDiscoveryConfidence` after merging (`cub.ts:243-254`).
**When consumed:** OCSE → `DecisionProfile.decisionConfidence` (C5) uses `discoveryConfidence` as one input weight (`decision-engine.ts:85`, weight `0.15` per `OcseConfig.dimensionWeights.discoveryConfidence`).
**Mutable?** No after CUB merge.
**The duplication bug (Family B):**

C3 (ORE) and C4 (CUB) both compute an "aggregate candidate confidence":
- **C3 — ORE's:** `0.7 + (sourcesCount - 1) * 0.15`, capped at `1.0` (`ore.ts:411`). Set inside `mergeCandidates` *before* CUB sees the universe.
- **C4 — CUB's:** `maxBase + genreBoost(0.18) + (uniqueTypes - 1) * 0.12`, capped at `0.98` (`cub.ts:243-254`). CUB re-merges the universe `cub.ts:382-403` and overwrites ORE's value with this one.

Two different formulas in two engines writing "the same" concept. The spec is unambiguous (`:59`): **CUB is canonical**. ORE's `relationshipConfidence` is upstream-of-canonical evidence that *should be discarded* once CUB merges.

**Phase 2 P1-7 contract:** ORE stops computing aggregate confidence. ORE emits raw per-source `EvidenceSource.confidence` (Family A) only. CUB is the sole aggregator.

### Family C — Decision confidence (per-candidate decision quality)
**Members:** C5 (OCSE `decisionConfidence`).
**Meaning:** "How confident is the system that this candidate *should be recommended today*, given today's user state, slider, and history?"
**Range:** `0.0 - 1.0`.
**Owner:** OCSE.
**When computed:** inside `evaluateCandidate` (`decision-engine.ts:79-90`).
**When consumed:** `buildFrontierNodes.ts:484-486` uses it to determine `reachable` (threshold `WorldConfig.visibilityThreshold`); `:488-494` uses it to bucket `confidenceBand` HIGH/MEDIUM/LOW against `WorldConfig.confidenceBands`.
**Mutable?** No after OCSE produces it.
**Formula today (verbatim):**

```ts
let decisionConfidence = (
  relationshipSupport * 0.2 +
  growthContribution    * 0.2 +
  noveltyContribution   * 0.15 +
  discoveryConfidence   * 0.15 +   // ← CUB's C4 consumed here
  timingContribution    * 0.15 +
  sliderCompatibility   * 0.15
) * cooldownMultiplier;
decisionConfidence = clamp(0.0, 1.0, decisionConfidence);
```

The 6 weights are read from `OcseConfig.dimensionWeights` (`src/lib/config/ocse.ts:17-24`) — correctly config-driven.
**However**, `cooldownMultiplier` can drive `decisionConfidence` to 0 if the candidate was integrated (`decision-engine.ts:53-54`). Hence `decisionConfidence = 0` is the cooldown floor.

### Family D — Territory relationship confidence (cross-engine contamination site)
**Members:** C7 (`stateConfidence` on `userTerritoryRelationship`).
**Meaning:** "How confident is the writer that the territory's `currentState` is accurate?"
**Range:** not standardised; spec doesn't mention it.
**Owner:** **CONTESTED** — written by both GRE (`relationship-persistence.ts:32`) and Layer 6 (`territory-relationship.ts:364`). See `decisions/gre-vs-layer6.md`.
**When computed:** GRE: alongside `currentState` in the debug route. Layer 6: alongside `currentState` in the canonical territory chain.
**When consumed:** readers of `userTerritoryRelationship` (`territory-relationship.ts:118` for transition detection, `intervention-engine.ts`, `tce-engine.ts`) — but consumers can't tell which writer's confidence scale (GRE's `0.5-0.98` clamped vs Layer 6's own) the value uses.
**Mutable?** Yes (each run).
**Phase 2 P0-2 contract:** once `decisions/gre-vs-layer6.md` is decided, only one engine owns this column.

### Family E — Profile subsystem confidences (each scoped to its own table)
**Members (C8):**
- `User.profileData.confidenceProfile` — profile-engine Layer 6 (in-memory), per-trait confidence. Owner: Profile.
- `UserTerritoryAffinity.confidence` (`territory-affinity.ts`) — affinity compatibility confidence. Owner: Profile Layer 4.
- `TerritoryFamiliarity.confidence` (`territory-mapping.ts` writes it) — familiarity confidence. Owner: Profile Layer 3.
- `UserTerritoryIntervention.confidence` (`intervention-engine.ts`) — intervention policy utility confidence. Owner: Profile Layer 7.
- `UserTerritoryCultivation.confidence` (`tce-engine.ts`) — cultivation probability confidence. Owner: Profile Layer 8.

**Meaning:** each scope-specific. They are NOT interchangeable, but they share the name "confidence."
**Range:** each `0 - 1`.
**Owner:** each Profile sublayer is the sole producer of its own.
**Phase 2 contract:** no changes needed except documenting that they are 5 separate numbers. If any PR proposes exposing them all to the client under a single "confidence" label, that's a bug.

---

## 3. The two confidence duplications Phase 2 must eliminate

### 3.1 Aggregate candidate confidence (Family B / C3 vs C4)

**Today:** ORE computes `relationshipConfidence = 0.7 + (sources-1) * 0.15` (`ore.ts:411`). CUB then re-merges and overwrites with `calculateDiscoveryConfidence` (`cub.ts:243-254`).

**Spec designation:** CUB canonical (`backend-contract.md:59`).

**Phase 2 P1-7 contract:** ORE stops computing aggregate `relationshipConfidence`. ORE emits only per-source `EvidenceSource.confidence` (Family A). CUB is the sole aggregator of `discoveryConfidence`. The old `relationshipConfidence` field on `RawCandidate` (`ore.ts:39`) is removed; downstream reads `discoveryConfidence` instead.

Until P1-7 lands, downstream MUST treat `Candidate.discoveryConfidence` as canonical and ignore `RawCandidate.relationshipConfidence`.

### 3.2 Territory relationship confidence column (Family D / C7 — same-column dual writer)

**Today:** GRE (`relationship-persistence.ts:32`) and Layer 6 (`territory-relationship.ts:364`) both write `stateConfidence` on the same `userTerritoryRelationship` row. Different scales.

**Phase 2 P0-2 contract:** per `decisions/gre-vs-layer6.md`. Recommended Option C.ii: Layer 6 owns `stateConfidence` on `userTerritoryRelationship`; GRE moves to its own `UserTerritoryRelationshipState` table.

---

## 4. Confidences that are correctly distinct (NOT duplications)

To prevent accidental Phase 2 "cleanups" that would merge things that should stay separate:

- **C2 vs C4:** per-source evidence vs aggregate. Different concepts. CUB aggregates C2 into C4 — that's by design.
- **C4 vs C5:** discoveryConfidence (CUB, "is this a real candidate?") vs decisionConfidence (OCSE, "should we show this today?"). Different decisions on different timelines. OCSE consumes C4 as one input into C5.
- **C5 vs C6:** decisionConfidence (a 0..1 selection-quality score) vs expansionDistance (a 0..1 distance metric, not a confidence). See §6.
- **C8 (Profile) confidences vs everything else:** scoped to territory tables, not candidates. They do NOT compete with C4 or C5.

---

## 5. Per-confidence specification (binding for Phase 2)

### §5.1 GRE `confidence` (C1)

| Property | Spec |
|----------|------|
| Owner | GRE (`gre.ts`) |
| Computed at | `gre.ts:165-168` |
| Spec range | `0.0 - 0.98` (`backend-contract.md:38`) |
| Today's range | `0.5 - 0.98` (clamped by hardcoded `Math.max(0.5, ...)`) |
| Lived on | `GenreRelationship.confidence` (transient) |
| Mutable after compute | No |
| Phase 2 contract | moveToConfig: `src/lib/config/gre.ts` adds `confidenceWeights { identity, familiarity, stability }` (default `0.4 / 0.4 / 0.2`), `confidenceFloor` (default `0.0`), `confidenceCeiling` (default `0.98`). `gre.ts:165-168` reads these. Removes hardcoded `0.5` floor. (P1-3) |
| Who may modify | No one, post-compute. Only config can change weights/floor/ceiling. |

### §5.2 ORE `EvidenceSource.confidence` (C2)

| Property | Spec |
|----------|------|
| Owner | ORE per source-provider (`ore.ts`) |
| Computed at | retrieval time per source type |
| Range | `0.0 - 1.0` |
| Today's values (hardcoded) | `0.95` LASTFM_SIMILAR · `0.9` SPOTIFY_METADATA · `0.75` GENRE_EXPANSION · `0.8` SCENE_EXPANSION · `0.6` HIDDEN_POTENTIAL · `1.0` SEED · `0.7` fallback match |
| Lived on | within `Candidate.discoveryContext.sources[*].confidence` (transient) |
| Mutable after compute | No |
| Phase 2 contract | moveToConfig: `src/lib/config/ore.ts` adds `sourceConfidence { LASTFM_SIMILAR, SPOTIFY_METADATA, GENRE_EXPANSION, SCENE_EXPANSION, HIDDEN_POTENTIAL, SEED, FALLBACK }`. ORE reads from config. (P1-9) |
| Who may modify | No one, post-retrieval. Only config can change per-source defaults. |

### §5.3 CUB `discoveryConfidence` (C4 — canonical aggregate)

| Property | Spec |
|----------|------|
| Owner | CUB (`cub.ts:calculateDiscoveryConfidence`) |
| Computed at | `cub.ts:243-254`, after merge in `cub.ts:382-403` |
| Range | `0.0 - 0.98` (per spec `:57` cap) |
| Today's formula | `maxBase + genreBoost(0.18) + (uniqueTypes - 1) * 0.12`, capped `0.98`. `maxBase` and `0.18` are hardcoded magic numbers. |
| Consumed by | OCSE (`decision-engine.ts:85`) as one weighted input into `decisionConfidence`. Also seen on `OrcaNode.candidateEvidence.discoveryConfidence` for client/debug. |
| Mutable after compute | No |
| Phase 2 contract | (i) P1-7: ORE's `relationshipConfidence` removed; CUB is sole aggregator. (ii) P1-9: moveToConfig, `src/lib/config/cub.ts` adds `discoveryConfidenceWeights { maxBase, genreBoost, uniqueTypeBonus, ceiling }`. `calculateDiscoveryConfidence` reads from config. |
| Who may modify | No one post-merge. Only config can change formula weights. |

### §5.4 OCSE `decisionConfidence` (C5)

| Property | Spec |
|----------|------|
| Owner | OCSE (`decision-engine.ts`) |
| Computed at | `decision-engine.ts:79-90` |
| Range | `0.0 - 1.0` (clamped). Floor effectively `0.0` (cooldown ≥ 0); only cooldown floors matter. |
| Today's formula | 6-weighted blend (weights in `OcseConfig.dimensionWeights`) × `cooldownMultiplier` |
| Today's weights (in config) | `0.2 + 0.2 + 0.15 + 0.15 + 0.15 + 0.15 = 1.0` per `src/lib/config/ocse.ts:17-24` |
| Today's cooldown penalties (in config) | `0.5 ignored · 0.3 dismissed · 0.15 recentShown · 0.6 extendedShown` per `:7-14` |
| Consumed by | `buildFrontierNodes.ts:484-486` → `reachable` (`decisionConfidence > WorldConfig.visibilityThreshold`); `:488-494` → `confidenceBand` HIGH/MEDIUM/LOW against `WorldConfig.confidenceBands`; client UI; debug routes |
| Mutable after compute | No (within a single decision) |
| Contract | weights in OcseConfig. P0-1 **done:** expansionDistance read from Candidate (EI), never fabricated. P1-4 **done** for stage coeffs in config (re-grep residual). |
| Who may modify | No one post-decision. Only config can change weights/penalties. |

### §5.5 Expansion Intelligence (C6 — NOT a confidence)

See §6. Worth restating because conflating C6 with C5 is one of the audit's confusions.

---

## 6. Why `expansionDistance` is NOT a confidence

The original Phase 1 audit listed `expansionDistance` alongside the confidences, which led to ambiguity. Per `pipeline.md §3` and the spec's framing (`backend-contract.md:80-91` WPE; the distance is the WPE input — *not* a confidence):

- **`expansionDistance`** is a `0..1` *distance* in the user's taste space. `0` = inside the user's comfort zone, `1` = the outer edge of the user's frontier range. It's the input to WPE projection windows (`projectWorld`).
- **`decisionConfidence`** is a `0..1` *quality* score that decides whether a candidate is shown at all.
- A candidate with `expansionDistance = 0.9` and `decisionConfidence = 0.2` is "far from the user's taste but we're not confident it's worth recommending." Both numbers carry information; collapsing them into one would destroy data.

**Phase 2 contract:** documents, variable names, and PR descriptions involving Expansion Intelligence must NOT use "confidence" language. Use "distance" / "expansion distance" / "taste-space distance." Anything calling `expansionDistance` a confidence is a doc bug.

---

## 7. Cross-engine confidence flow (one-page summary)

```
ORE  ─► EvidenceSource.confidence    (C2, per-source)        Family A
        ↓
        └─ fed into ─► CUB discoveryConfidence  (C4)         Family B
                       ↓
                       └─ fed into ─► OCSE decisionConfidence (C5)  Family C
                                      ↓
                                      └─ buildFrontierNodes ─► OrcaNode.reachable, confidenceBand
                                                                                   │
                                                                                   ↓
GRE  ─► GenreRelationship.confidence (C1)               Family A (genre-level)
        ↑ transient; never persisted canonically

Layer 6 ─► UserTerritoryRelationship.stateConfidence (C7) Family D ── CONTESTED with GRE persistence

Profile layers ─► confidenceProfile, territoryAffinityConfidence, etc. (C8) Family E
                  ↑ each scoped to its own table; not in candidate flow
```

---

## 8. Phase 2 binding rules for confidence

1. **Single-owner rule:** each confidence concept has exactly one owner per §5. Phase 2 PRs touching any confidence MUST state which family they affect.
2. **Naming:** the word "confidence" alone is ambiguous. Phase 2 PRs and code MUST qualify: `discoveryConfidence`, `decisionConfidence`, `stateConfidence`, etc. Bare `confidence` is reserved for new types that have explicitly chosen to opt into a named family.
3. **Range notation:** the spec range (`0.98` cap) must be enforced on aggregate candidate (`discoveryConfidence`) and GRE (`confidence`) outputs. C5 OCSE `decisionConfidence` is correctly `0.0 - 1.0`.
4. **Config-driven:** every confidence weight lives in `src/lib/config/*.ts`. Hardcoded literals in `ore.ts`, `cub.ts:243-254`, `gre.ts:165-168`, `decision-engine.ts:22-31` etc. are catalogued in `config-inventory.md` and Phase 2 moves them to config (P1-3, P1-4, P1-9).
5. **Family D depends on `decisions/gre-vs-layer6.md`:** until that decision lands, the stateConfidence column stays contested. Phase 2 P0-2 resolves it.

End of `confidence.md`.
