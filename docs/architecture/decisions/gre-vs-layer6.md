# Decision: GRE vs Layer 6 — ownership of `userTerritoryRelationship`

**Status:** ✅ **DECIDED + IMPLEMENTED — Option C.ii** (confirmed 2026-07-09, P0-2).  
**Present tense:** Layer 6 sole owner of `userTerritoryRelationship`; GRE sole owner of `UserGenreRelationshipState`. Territory chain runs from `materializeWorld` full post-step (`computeUserTerritoryMapping`), not from deleted `computeAndStoreFrontier`.

Historical matrix below kept for rationale. Do not re-open without new product decision.

---

## 1. Reframing: the question is NOT "which engine to kill"

The Phase 1 audit framed this as "two engines silently corrupt each other's row — last writer wins." The Phase 1.5 verification **refuted that framing** and surfaced a clearer picture. Here's the actual situation:

**Today's reality on the canonical pipeline:**

- **Layer 6 (`territory-relationship.ts`)** is the *only* writer of `userTerritoryRelationship.currentState` on the live pipeline. It runs from `computeUserTerritoryMapping`, triggered by `materializeWorld` when `fullMaterialization` is true.
- **GRE persistence (`gre/relationship-persistence.ts:21`)** is **dormant** on the canonical path. Its only caller in the entire codebase is `src/app/api/debug/genre-relationships/route.ts:45`. Not sync, not globe, not frontier, not regen.

So the question isn't "which one wins the collision on the live path" — **Layer 6 has already won by default because no one ever invokes GRE's persistence live**. Layer 6 *is* the canonical writer on the running system.

**The actual defect** is vocabulary contamination. Both engines have written (or could write) into the same `currentState` and `stateConfidence` columns over time, producing a table where some rows have GRE's 7-state vocabulary keyed by raw genre strings (`'house'`, `'techno'`) and other rows have Layer 6's 10-state vocabulary keyed by `Territory_v2_*` IDs. Downstream readers do `findMany({ where: { userId } })` and can't tell which classifier produced which row.

**And the actual confusion** is that the spec (`backend-contract.md:27-44`) only mentions GRE. Layer 6 is undocumented — it self-identifies as "Backend Layer 6" in `territory-relationship.ts:2` and uses an unrelated state model. Anyone reading the spec would assume GRE is the only relationship engine. The code disagrees.

So the real question is:

> **Should we (a) make the de facto state canonical by documenting Layer 6 alongside GRE, (b) fix the spec drift by making GRE the sole model and migrating Layer 6's richer logic into GRE, or (c) split them by a discriminator column so each row knows who wrote it?**

The three options:

- **Option A — Keep both, formalise the split with a discriminator.** Acknowledge what's already happening. Lowest risk, easiest to implement, but keeps two vocabularies alive and adds long-term doc burden.
- **Option B — Retire Layer 6, make GRE the sole owner.** Spec-compliant. Smallest surface area. But loses Layer 6's richer 10-state model and the territory warming it produces, and requires migrating Layer 6's downstream consumers (Layers 7 and 8) back to GRE's 7-state model — non-trivial.
- **Option C — Retire GRE as a writer, make Layer 6 the sole owner.** Reflects what's already true on the canonical path (GRE persistence is dormant). Spec must be updated. GRE becomes read-only everywhere and the debug route either loses persistence or migrates to Layer 6's vocabulary.

Below I evaluate each against the five downstream consumers that would have to change.

---

## 2. The options in detail

### Option A — Keep both, formalise the split

**What changes.**
- Add a `classifierOrigin ClassifierOrigin @default("GRE")` column to `UserTerritoryRelationship`. (The `@default` only matters for new code; existing rows without it would need backfill.)
- Backfill existing rows by `territoryId` pattern: `^Territory_v2_` → `LAYER6`, otherwise → `GRE`.
- `gre/relationship-persistence.ts:21` upsert: set `classifierOrigin: 'GRE'`.
- `territory-relationship.ts:353` upsert: set `classifierOrigin: 'LAYER6'`.
- **Every reader** in §3 below adds `classifierOrigin: 'GRE'` (or `'LAYER6'`) to its `where` clause so consumers stop mixing vocabularies.
- Document the Layer 6 engine in `backend-contract.md` as a sanctioned second model.

**Pros.** Lowest risk. No data loss. Honours what the system already does. Smallest schema change. Lets each engine specialise: GRE for genre-level live reads, Layer 6 for territory-level rich state.

**Cons.** Two vocabularies stay alive forever. Spec must now document *two* relationship engines. New consumers must always remember to filter by `classifierOrigin`. If anyone forgets, the original contamination returns.

**Spec change.** Yes — `backend-contract.md §2` must mention Layer 6 as a parallel classifier, OR a new `§2A` added.

### Option B — Retire Layer 6, GRE is sole owner

**What changes.**
- Delete `src/lib/profile/territory-relationship.ts` (`computeUserTerritoryRelationships` and helpers).
- Migrate Layers 7 (`intervention-engine.ts`) and 8 (`tce-engine.ts`) to consume GRE's 7-state vocabulary instead of Layer 6's 10-state.
- Migrate `profile-engine.ts:416`'s `calculateIdentityValue` lookup (currently `STABILIZED → 95, RESIDENT → 75, else → 30`) to GRE's vocabulary.
- Migrate the 10-state → 7-state mapping (`gre.ts:179-190` has a partial inverse map already) — but it's lossy: Layer 6 has states (`REJECTED`, `RESISTANT`, `CURIOUS`, `EMERGING`) that have no GRE analog.
- Migrate `OrcaNode.relationshipState?` union (`src/lib/graph/types.ts`) from 10-state to 7-state. Frontend will need to render differently.
- Migrate the `Territory` reference data path: GRE writes by raw genre strings today (`territoryId = res.genre`); the territory pipeline (`territory-mapping.ts`, affinity, intervention, cultivation) keys by `Territory_v2_*` IDs. GRE must learn to write under `Territory_v2_*` IDs OR the territory pipeline should be reworked to use raw genres — and the latter defeats the purpose of having a territory catalog.
- Move GRE's persistence onto the canonical path OR document that nothing persists grown relationships live.
- Drop the `RelationshipTransition`, `RelationshipExplanation`, `UserTerritoryRelationshipSnapshot` tables OR migrate them to GRE's vocabulary (currently they're owned by Layer 6).

**Pros.** Spec stays untouched. One vocabulary. Cleaner mental model. Matches "5 engines" worldview.

**Cons.** Rich state model lost — `REJECTED`, `RESISTANT`, `CURIOUS`, `EMERGING` all encode genuinely useful user-territory dynamics that GRE cannot represent. Layer 8 (Cultivation) and Layer 7 (Interventions) both lean on Layer 6's state model — they'd lose precision. Likely a multi-sprint effort. Frontend display logic must change.

**Spec change.** None — but the migration is invasive.

### Option C — Retire GRE as a *writer*, Layer 6 is sole owner

**What changes.**
- GRE's compute (`gre.ts:30`) stays — it still produces `GenreRelationship[]` in-memory for OCSE and Expansion Intelligence to consume.
- `gre/relationship-persistence.ts` is removed entirely. The debug route `/api/debug/genre-relationships` either becomes read-only (no persistence) or migrates to call Layer 6's `computeUserTerritoryRelationships`.
- `OrcaNode.relationshipState?` union stays as the 10-state model (matches Layer 6's vocabulary — no type change).
- Layers 7 and 8 keep reading Layer 6 — no migration needed for them.
- Spec `backend-contract.md §2` is updated: GRE is documented as a read-only in-memory classifier. The persistence layer is renamed / clarified to Layer 6. The 7-state GRE vocabulary continues to live only on `GenreRelationship.stage` (in-memory) and the 10-state Layer 6 vocabulary continues to live on `userTerritoryRelationship.currentState` (persisted).
- A future PR removes stale `currentState` rows from the DB keyed by raw genre strings (backfill: delete rows where `territoryId` matches `/^house$|^techno$|^uk-garage$|^grime$|^hip-hop$|^lo-fi-hip-hop$|^ambient$|^downtempo$|^pop$|^rock$|^jazz$/` — the 11 `SYSTEM_GENRES`).

**Pros.** Reflects reality (Layer 6 already is the canonical writer). Preserves the richer 10-state model. Touches the fewest lines. No data loss. Spec change is additive (clarify GRE = read-only; formalise Layer 6 = the persisted model). Frontend is unaffected because `OrcaNode.relationshipState` already uses the 10-state union.

**Cons.** Spec must change to mention Layer 6. GRE's stage values lose their persistence path (do `INTRODUCED` and `UNTUCHED` need to persist for any cold-start case? Need to verify no test or route assumes they're already in the DB). Debug route may need rework.

**Spec change.** Yes — `backend-contract.md §2` adds explicit read-only designation and a new `§2A` demoting GRE's persistence, lifting Layer 6 to spec.

---

## 3. Impact comparison against the 5 downstream consumers

Each consumer of `userTerritoryRelationship` rated per option. **Effort:** S / M / L / XL. **Risk:** L / M / H. **Breaking:** Y / N (breaks existing client-visible behaviour or stored data).

| Consumer | File:line | What it reads | Option A effort | Option B effort | Option C effort |
|----------|-----------|---------------|------------------|------------------|------------------|
| `tce-engine.ts` (Layer 8 Cultivation) | `:55` | reads `currentState` to compute familiarity/fluency saturation | S — filter by `classifierOrigin: 'LAYER6'` | L — must consume 7-state `INTRODUCED`/`UNTUCHED` instead of `STABILIZED`/`RESIDENT`; classifier logic depends on 10-state richness | **S — no change** (already reads Layer 6 only) |
| `intervention-engine.ts` (Layer 7 Interventions) | `:98` | reads `currentState` to decide 7-action intervention policy | S — filter by `classifierOrigin: 'LAYER6'` | L — intervention logic uses 10-state vocabulary (`REJECTED` → re-introduction cues; `RESISTANT` → hold). Must rebuild logic for 7-state. Lossy. | **S — no change** |
| `cub.ts` | `:164` | reads `userTerritoryRelationship` to score relationship strength evidence for candidates | S — filter | M — re-map reads | **S — no change** if it already sees Layer 6's rows; verify (currently it'd see mixed rows so behaviour is already inconsistent — Option C gives it a consistent path) |
| `globe/route.ts` | `:69` | reads `currentState` to snap `OrcaNode.relationshipState` for client display | S — filter by `classifierOrigin: 'LAYER6'` (frontend keeps getting 10-state) | L — frontend must render 7-state. UI/copy changes. | **S — no change** (OrcaNode.relationshipState union is already 10-state) |
| `gre.ts` (read for compute) | `:41` | reads `UserTerritoryRelationship` for momentum + previous state to compute new stage | S — filter by `classifierOrigin: 'GRE'` (its own rows) | S — same (its own rows) | **M** — must decide where it reads previous-state from. Either (i) loses persistence entirely (becomes stateless per-run) or (ii) Layer 6's table reads re-mapped from 10-state → 7-state using the inverse of `gre.ts:179-190`. The latter is feasible because `gre.ts:179-190` already has the map. **Decision sub-point within C: do we want GRE to remain stateful across runs? If yes, give GRE a separate persisted table `UserGenreRelationshipState` keyed by genre string. If no, accept that GRE recomputes from scratch every sync** |

**Side-channel consumers that touch the disputed tables:**
| Consumer | Reads | Option A | Option B | Option C |
|----------|-------|----------|----------|----------|
| `api/artist/[id]/route.ts:86` | `userTerritoryRelationship` | filter | re-map | no change |
| `api/user/sync-demo/route.ts:101` | **deletes** `userTerritoryRelationship` on demo reset | just `deleteMany({ where: { userId } })` | unchanged | unchanged |
| Debug route `api/debug/genre-relationships/route.ts:45` | calls GRE persistence | persists with `classifierOrigin: 'GRE'` | persists with `classifierOrigin: 'GRE'` (now canonical) | **route retires persistence OR is replaced** by a Layer-6-invoking version |

**Layer 8 (Cultivation) and Layer 7 (Interventions) both consume the 10-state vocabulary to make fundamentally 10-state-shaped decisions. Migrating them to 7-state loses precision that the system has been operating on. This is the single largest cost of Option B and the single largest weight in favour of Option C.**

---

## 4. Recommendation

**Recommended: Option C — Retire GRE as a *writer*, make Layer 6 the sole persisted owner.**

Justification:

1. **It reflects what's already true.** GRE persistence is dormant on the canonical path. Layer 6 has been the de facto writer for as long as the territory chain has existed. We're not making a controversial architectural choice; we're documenting what's running.
2. **It preserves the richer model.** Layer 6's 10-state vocabulary supports `REJECTED`, `RESISTANT`, `CURIOUS`, `EMERGING` — states the territory chain (Layers 7, 8) actively uses for intervention policy and cultivation scheduling. Option B would force us to either drop that information or extend GRE's spec-defined 7-state model, which is a contract change too.
3. **It touches the fewest consumers.** Per §3, four of the five `userTerritoryRelationship` readers need **no change** under Option C. The fifth (`gre.ts:41`) is GRE's own read of its own state — a sub-decision (give GRE its own table or accept statelessness) is small in scope and self-contained. Under Options A and B, every consumer needs *some* change to filter or remap.
4. **The frontend is unaffected.** `OrcaNode.relationshipState` already uses the 10-state union that Layer 6 produces. Switching to Option B would require frontend work to render a 7-state world. Option C leaves the client contract alone.
5. **It's additive, not destructive.** Spec change is *adding* a description of Layer 6 and *clarifying* GRE as read-only. No existing field's contract changes for any consumer that already assumes Layer 6 dominance.
6. **Spec drift gets fixed, not buried.** Right now `backend-contract.md` lies — it claims GRE persists when it doesn't. Option C corrects that. Option A keeps the lie alive by adding a sibling clause. Option B requires us to delete work to make the spec truthful.

**Cost of Option C, conservative estimate:**
- Schema migration (delete stale genre-keyed rows): S
- Remove `gre/relationship-persistence.ts`: S
- Update `api/debug/genre-relationships/route.ts` to call Layer 6 OR document as read-only: S
- Update `backend-contract.md §2` and add `§2A` for Layer 6: S
- Decide GRE cross-run statefulness (sub-decision) and implement: S or M
- Total: ~Medium, single sprint.

**Cost of Option A, for comparison:** Multiple-S, because every consumer needs a filter clause added (and reviewed forever after).
**Cost of Option B:** Large, because Layers 7 and 8 must be re-architected.

### Sub-decision required for Option C: does GRE need cross-run memory?

GRE's compute (`gre.ts:30`) reads `userTerritoryRelationship` at `:41` to get previous-state momentum. If Layer 6 becomes sole writer, GRE has two choices:

- **C.i — Stateless GRE.** Drop the read entirely. GRE recomputes from `UserListeningEvent`, `UserArtistMemory`, etc. every run. This is simplest. The cost: GRE's stability metric (which uses momentum delta) loses its reference to previous state and becomes noisier. Phase 2 P1-3 (already planned for the `0.5` confidence floor) can be expanded to address this.
- **C.ii — GRE gets its own table.** New `UserGenreRelationshipState` keyed by `(userId, genre)` with GRE's 7-state vocabulary. GRE persistence moves to this table. Slightly larger scope but preserves GRE's stateful behaviour.

**Recommended sub-decision: C.ii**, because (a) GRE's stability/momentum logic is real and worth preserving, (b) it gives a clean home for the debug route's writes, (c) the new table is independent of the disputed table — no contamination risk, (d) Phase 2 plans the schema migration anyway (P0-2).

If you accept this, the recommendation in one sentence:

> Adopt Option C.iI: retire GRE's writer access to `userTerritoryRelationship` (Layer 6 stays canonical), give GRE a new `UserGenreRelationshipState` table for its 7-state vocabulary, update the spec to acknowledge Layer 6, and clean up the disputed table's stale genre-keyed rows.

---

## 5. What Phase 2 must do once you decide

This is a checklist — DO NOT touch anything until you've signed off.

### If Option A (keep both, discriminator):
1. Prisma migration: add `classifierOrigin ClassifierOrigin @default("GRE")` enum column to `UserTerritoryRelationship`.
2. Backfill migration by `territoryId` regex.
3. Update both writers (`relationship-persistence.ts:21`, `territory-relationship.ts:353`) to set the column.
4. Update all 5 readers listed in §3 to filter on the column.
5. Update `backend-contract.md` to mention Layer 6 alongside GRE.
6. Add an E2E test that asserts no row is ever written without a `classifierOrigin` value.
7. Add an `architecture-rules.md` invariant: "any new writer or reader of `userTerritoryRelationship` MUST specify `classifierOrigin`."

### If Option B (retire Layer 6):
*(Not recommended; listed for completeness.)*
1. Plan a multi-sprint migration. Sequence: (i) build the 7-state remapping inside Layer 7 + Layer 8, (ii) add a compatibility shim so Layer 6 still runs but writes nothing, (iii) cut over consumers one by one, (iv) delete Layer 6 + its helpers + snapshot tables.
2. Delete `bandit-types.ts` simultaneously (it belongs to the Layer 6 family). **Done Ticket 3.**
3. Migrate frontend display of `OrcaNode.relationshipState` to 7-state vocabulary.
4. Add a backfill migration that converts existing 10-state rows to 7-state (lossy — `REJECTED`/`RESISTANT`/`CURIOUS`/`EMERGING` must collapse to nearest GRE state).
5. Update `gre.ts:179-190` to be the canonical 10→7 map.

### If Option C (retire GRE writer — recommended):
1. Prisma migration:
   - Delete stale rows in `userTerritoryRelationship` where `territoryId` is one of the 11 `SYSTEM_GENRES` strings. (This is the only destructive step.)
   - (Optional, sub-decision C.ii) Add new table `UserGenreRelationshipState` keyed by `(userId, genre)` storing GRE's 7-state `currentState`, `stateConfidence`, `previousStage`, `momentum`, `lastUpdatedAt`.
2. Remove `src/lib/gre/relationship-persistence.ts`. Audit: any caller besides `api/debug/genre-relationships/route.ts:45`? Verified: no (per Phase 1.5 audit).
3. Update `src/app/api/debug/genre-relationships/route.ts:45`:
   - **C.i path:** the route returns `GenreRelationship[]` from the compute step but does NOT persist. Note the change in the route's response.
   - **C.ii path (recommended):** the route persists to the new `UserGenreRelationshipState` table instead.
4. Update `src/lib/gre/gre.ts:41`:
   - **C.i:** remove the read entirely. (Verify whether `stability` metric affected — it is; document the loss.)
   - **C.ii:** retarget the read to `UserGenreRelationshipState`.
5. Update `backend-contract.md §2`:
   - Clarify: GRE is read-only on the live path (compute only, no persistence).
   - Add `§2A` documenting Layer 6 (Profile Relationship Engine): inputs, outputs (10-state union, persistence to `userTerritoryRelationship`), forbidden actions.
   - If C.ii: add `§2B` documenting GRE's `UserGenreRelationshipState` table as a separate persisted state store.
6. Update `ownership-matrix.md §2.3` to mark `GreConfig` and `UserGenreRelationshipState` as GRE-owned only if C.ii is chosen.

### Recommended PR sequence (assumes Option C.ii):

| PR | Title | Touches |
|----|-------|---------|
| 1 | "Schema: add `UserGenreRelationshipState` table" | `prisma/schema.prisma` + migration |
| 2 | "GRE persistence → `UserGenreRelationshipState`" | `relationship-persistence.ts`, debug route, `gre.ts:41` read target |
| 3 | "Delete stale genre-keyed rows from `userTerritoryRelationship`" | standalone destructive migration with dry-run preview |
| 4 | "Spec: GRE read-only on canonical path; Layer 6 documented" | `backend-contract.md` |
| 5 | "Tests: assert Layer 6 sole-writer invariant on canonical pipeline" | regression test |

---

## 6. What this decision unblocks

- Phase 2 P0-2 (full implementation).
- `ownership-matrix.md §2.3` CONTESTED labels can be resolved to "Owner: Profile Layer 6" (currentState/stateConfidence) and "Owner: GRE" (UserGenreRelationshipState if C.ii).
- `confidence.md §4` (GRE confidence) can document that `stateConfidence` written by GRE persistence lives on the *new* table only, and Layer 6's `stateConfidence` lives on the disputed table it now owns.
- The architecture-rules invariant "every persisted schema has one owner" can be honoured for `userTerritoryRelationship`.

---

## 7. Decision record

- **Decision:** ✅ **Option C.ii** — retire GRE as a writer of `userTerritoryRelationship`; Layer 6 is the sole persisted owner; GRE gets a new `UserGenreRelationshipState` table for its 7-state vocabulary.
- **Rationale (you):** "Confirm C.ii (Recommended)" — selected 2026-07-09 during Phase 2 P0 planning. Additional weight: exploration confirmed CUB (`cub.ts:184-223`) actively reads GRE's persisted 7-state rows keyed by raw genre, making C.ii not just recommended but *necessary* to preserve CUB's behavior (Option C.i stateless would break CUB's relationship-strength evidence).
- **Sign-off date:** 2026-07-09.
- **Unblocks:** Phase 2 P0-2 (implemented), ownership-matrix resolution, confidence.md Family D resolution.
- **Implementation status:** ✅ Complete in Phase 2 P0-2.
  - `UserGenreRelationshipState` model added (`prisma/schema.prisma`), `db push` applied.
  - `gre/relationship-persistence.ts` retargeted; no longer writes `RelationshipTransition`/`RelationshipExplanation`.
  - `gre.ts:41` read + `cub.ts:164` read retargeted to the new table.
  - `api/debug/genre-relationships` route surfaces the new table.
  - Cleanup script `scripts/migrate-gre-territory-rows.ts` (report-only default, `--apply` to delete stale rows).
  - INV-1 test (`src/lib/gre/__tests__/persistence.test.ts`) pins single-writer invariant.

End of `decisions/gre-vs-layer6.md`.
