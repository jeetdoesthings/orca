# ORCA Canonical Pipeline (`docs/architecture/pipeline.md`)

**Status:** Day 1 complete (Tickets 1–5). Binding present tense.  
**Authority:** code is source of truth; this doc mirrors `src/` after Tickets 1–4.  
**Last verified:** Ticket 5 rewrite against `materializeWorld` / `buildFrontierNodes` / globe + expand routes.

---

## 0. Reading order

1. **§1 Conceptual stages** — four-band model.
2. **§2 Engine inventory** — 8 concerns.
3. **§3 Canonical pipeline order** — only order product assumes.
4. **§4 Entry points** — write vs read vs debug.
5. **§5 Sole materializer** — `materializeWorld`.
6. **§6 Side-effects** — what mutates what.
7. **§7 Flags & escape hatches**.
8. **§8 Glossary**.

---

## 1. Conceptual stages

```
┌───────────────────────── INPUT STAGE ─────────────────────────┐
│ Spotify sync → Identity Builder                                │
│ Produces User.globeData (explored OrcaNode[]) + User.profileData│
└────────────────────────────┬──────────────────────────────────┘
                             │
┌────────────────────────────▼──────────────────────────────────┐
│ EXPANSION / EVALUATION STAGE (sole runner: buildFrontierNodes) │
│ CUB → GRE → Expansion Intelligence → OCSE → layout             │
│ Pure evaluation of candidates. Returns OrcaNode[] (frontier).  │
│ Product code must not call buildFrontierNodes outside writer.  │
└────────────────────────────┬──────────────────────────────────┘
                             │
┌────────────────────────────▼──────────────────────────────────┐
│ PERSISTENCE STAGE (sole writer: materializeWorld)              │
│ Poison-pill filter → frontierData + worldStateData             │
│ Optional full: perimeter, adventurousness, profile, territory  │
└────────────────────────────┬──────────────────────────────────┘
                             │
┌────────────────────────────▼──────────────────────────────────┐
│ PROJECTION / OUTPUT STAGE                                      │
│ WPE (projectWorld) on GET /api/globe → Frontend                │
│ Mutates reachable + visible on in-flight clones only.          │
└────────────────────────────────────────────────────────────────┘
```

**Why this matters:** one stage runner, one materializer, one projector. Triggers (regenerate, integrate, explore, …) call the same writer. They do not re-implement the pipeline.

---

## 2. Engine inventory

| ID | Engine | File | Spec? | Live? |
|----|--------|------|-------|------|
| E1 | **Identity Builder** | `spotifySync.ts`, `identity.ts` | yes | yes |
| E2 | **GRE** | `gre/gre.ts` | yes | yes — compute on path; persists `UserGenreRelationshipState` (7-state) |
| E3 | **CUB** | `candidate/cub.ts` | yes | yes |
| E4 | **OCSE** | `ocse/decision-engine.ts` | yes | yes — pure reader of `Candidate.expansionDistance` |
| E5 | **WPE** | `frontier/world-projection.ts` | yes | yes — every ready `/api/globe` path |
| E6 | **ORE** | `candidate/ore.ts` | no | yes — retrieval under CUB |
| E7 | **Expansion Intelligence** | `expansion/intelligence.ts` | no | yes — owns `expansionDistance` |
| E8 | **Profile subsystem** | `profile/*` | no | yes — in-memory profile + territory chain L3→4→6→7→8 |

**Deleted:** Bandit TS types (`bandit-types.ts`). Prisma Bandit tables may remain empty schema.

Spec’s “5 engines” map: Identity→E1, GRE→E2, CUB→E3 (ORE as sub-retrieval), OCSE→E4, WPE→E5. E6–E8 are real code concerns the contract abstracts.

---

## 3. Canonical pipeline order

Only order product assumes. Deviation is a bug.

```
[Stage 0]  Spotify Sync / Identity              processAndStoreUserData
              → User.globeData, User.profileData
[Stage 1]  CUB                                  buildCandidateUniverse
              → Path A: ORE seed-adjacency (retrieval_path=adjacency)
              → Path B: leap-seek far territories (retrieval_path=leap_seek)
              → Candidate[] (both paths tagged)
[Stage 2]  GRE                                  computeGenreRelationships
              → GenreRelationship[]
[Stage 3]  Expansion Intelligence               computeDisaggregatedDistance
              → five distance components + composite (expansionDistance)
[Stage 3.5] Readiness Model                     computeReadinessState
              → readiness_state (comfort|expansion|leap + reasoning)
              → sole source of user readiness (not OCSE / WPE / frontend)
[Stage 4]  OCSE Recommendation Surface          buildRecommendationSurface
              → { comfort, expansion, leap } DecisionProfile[] buckets
              → leap_seek hard-biased into leap; refill before widen
              → leapBucketFallback only if leap-seek still short
[Stage 5]  Layout                               inside buildFrontierNodes
              → OrcaNode[] state='frontier' (+ readinessBucket, distanceComponents)
[Stage 6]  Materialize                          materializeWorld
              → frontierData, worldStateData (incl. surface + readiness), serve log
[Stage 7]  Profile + Territory (if full)        computeUserProfile + computeUserTerritoryMapping
[Stage 8]  WPE                                  projectWorld / applyTierEmphasis
              → emphasize active tier; never delete nodes for tier switch
[Stage 9]  Client                               Orca.tsx / OrcaHUD tier selector
```

**P0-1 (ordering):** ✅ Done. EI pre-pass before OCSE inside `buildFrontierNodes`. INV-5 tests pin pure-reader contract.

**P0-2 (GRE vs Layer 6):** ✅ Done. GRE → `UserGenreRelationshipState`; Layer 6 sole owner of `userTerritoryRelationship`.

**Ticket 4 (one path):** ✅ Done. No bare product `buildFrontierNodes`; no materialize on frontier GET; expand materialize-or-read.

---

## 4. Entry points

### Write (identity)
| Route | Calls |
|-------|--------|
| `POST /api/user/sync` | `processAndStoreUserData` |
| `POST /api/user/sync-demo` | demo identity + `materializeWorld` |

### Write (materialize)
| Route | Calls |
|-------|--------|
| `POST /api/world/regenerate` | `materializeWorld` full |
| `POST /api/artist/[id]/integrate` | action + `materializeWorld` |
| `POST /api/artist/[id]/ignore` | action + `materializeWorld` |
| `POST /api/user/explore` | explore + `materializeWorld` |
| `POST /api/user/frontier` | explicit `materializeWorld` (fire-and-forget) |
| `GET /api/admin/force-frontier` | `materializeWorld` + real Spotify token |
| `GET /api/admin/debug-frontier` | `materializeWorld` (inspect sample) |

### Read
| Route | Behavior |
|-------|----------|
| `GET /api/globe` | Pure projection. Never rebuilds. Never mutates `process.env`. `needsMaterialization` when snapshot empty — client POSTs regenerate. |
| `GET /api/user/frontier` | Pure cache read. Status: `no_data` / `pending` / `computing` / `ready`. **Never** calls `materializeWorld`. |
| `POST /api/orca/expand` | Read `readWorldState().lastNodes`; if empty → `materializeWorld` once; filter by seed `artistIds`. Never imports `buildFrontierNodes`. |

### Debug (not product FE)
`/api/debug/{ocse,candidate-universe,genre-relationships,world-projection,retrieval}` — partial engine inspect. Zero frontend callers.

### Stage runner constraint
```
src/ import of buildFrontierNodes → only pipeline-runner.ts (materializeWorld)
```

---

## 5. Sole materializer

**`materializeWorld(userId, options?)`** — `src/lib/frontier/pipeline-runner.ts`

| Option | Default | Meaning |
|--------|---------|---------|
| `exploredNodes` | load globeData | explored set |
| `accessToken` | load Spotify account | retrieval token |
| `sliderValue` | `0.5` | OCSE context |
| `fullMaterialization` | `true` | perimeter, adventurousness, profile, territory |

Steps:
1. Set `frontierStatus = COMPUTING`
2. `buildFrontierNodes` (CUB → GRE → EI → OCSE → layout)
3. Poison-pill invalid artist ids
4. Bump world versions + delta; write `frontierData` + `worldStateData`
5. If full: perimeter, adventurousness, profile patch/full, `computeUserTerritoryMapping`
6. `frontierStatus = COMPLETE` (or `FAILED` on throw)

**Deleted wrappers:** `computeAndStoreFrontier`, `triggerWorldRegeneration` (FS world-state files gone; DB only).

---

## 6. Side-effects audit

| Stage | DB writes? | Notes |
|-------|------------|-------|
| Identity sync | yes | globeData, profileData, listening, Artist.metadata audio |
| CUB / ORE | may cache artists | discovery path; not frontier write |
| GRE compute | read + **persist** genre state via `persistGenreRelationships` on product path (Part 15; `buildFrontierNodes` after compute). Same `UserGenreRelationshipState` store CUB/OCSE-adjacent code reads. Debug route still persists too. | own table only |
| EI / OCSE | no | in-memory |
| `buildFrontierNodes` | reads for audio metadata | no frontier write |
| `materializeWorld` | yes | frontier + world state + optional metrics/profile/territory |
| WPE | no | response clone only |
| Globe GET | no | pure read + project |

---

## 7. Flags & escape hatches

| Flag | Where | Status |
|------|-------|--------|
| `options.skipOcse` | `buildFrontierNodes` | **Scripts/baseline only.** Product routes never pass `true`. |
| `fullMaterialization` | `materializeWorld` | Product default true; controls profile/territory post-steps |
| `parseRequestRuntimeConfig` | globe / regenerate | Request-scoped only (`regenerate` + extras). **No** `process.env` mutation. LAYER*/MME/TME/TEM/LOFL keys removed. |
| `USE_OCSE_V2` | — | **Gone.** WPE always runs on ready globe path. |
| `withEnvOverrides` | — | **Gone.** |

---

## 8. Glossary

| Term | Meaning |
|------|---------|
| **Stage runner** | `buildFrontierNodes` — CUB→GRE→EI→OCSE→layout |
| **Materializer** | `materializeWorld` — sole frontier/world writer |
| **Projector** | `projectWorld` — WPE visibility on read |
| **Frontier** | Recommended candidates, `state='frontier'` |
| **Explored** | User identity graph in `globeData` |
| **GRE 7-state** | Genre relationship vocabulary on `UserGenreRelationshipState` |
| **Layer 6 10-state** | Territory relationship on `userTerritoryRelationship` |
| **expansionDistance** | Taste-space distance (not confidence); owned by EI |
| **discoveryConfidence** | CUB-owned evidence aggregate |
| **TEM** | Retrospective Taste Expansion Metric (`metrics/tem.ts`): F×D×A×M after the fact. **Not** live ranking. Ranking = EI `expansionDistance` + OCSE. |
| **Anti-hallucination** | `filterHallucinatedNodes` in materializeWorld — id/name/genre grounding + catalog check before frontier write |

**Deleted terms (do not use as live):** `computeAndStoreFrontier`, `triggerWorldRegeneration`, `USE_OCSE_V2`, `withEnvOverrides`, Last.fm dense-graph expand, Journey.

---

## 9. Client flow (summary)

1. Load → `GET /api/globe` (poll while syncing).
2. If `needsMaterialization` → `POST /api/world/regenerate`, repoll.
3. Progressive expand → seed picker `getExpansionCandidates` (IDs only) → `POST /api/orca/expand` (materialized frontier filter).
4. Integrate / ignore / explore → action routes → `materializeWorld` → next globe poll sees new snapshotVersion.

End of `pipeline.md`.
