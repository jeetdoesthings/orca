# Architecture Rules & Invariants (`docs/architecture/architecture-rules.md`)

**Status:** Day 1 complete. Binding for all PRs.  
**Authority:** each RULE-N is an invariant; breaking it needs carve-out + `decisions/*` if non-trivial.

---

## RULE-1 — Single owner per field

Every persisted or transient field has exactly one engine that computes or writes it.

- Two writers = bug even if values agree.
- Zero writers = dead code or missing implementation.
- Enrichment OK; original owner value MUST NOT be overwritten.
- Reference: `data-contracts.md`, `ownership-matrix.md`.

**Enforcement:** INV-1 (`success-metrics.md`); GRE persistence test.

---

## RULE-2 — Enrich, don't overwrite

Engines may add derived fields; never overwrite another engine’s owned field.

- WPE may set `reachable` / `visible` on a **clone** only.
- WPE must not touch `expansionDistance`, `audioSignature`, `candidateEvidence`.
- `buildFrontierNodes` may map OCSE → `OrcaNode.candidateEvidence`; must not mutate CUB `Candidate` ownership of discoveryConfidence.

---

## RULE-3 — No dual writers on same storage

Two engines must not write the same DB column without an explicit contract.

- **Resolved (P0-2):** `userTerritoryRelationship` → Layer 6 only. GRE → `UserGenreRelationshipState` only.
- **Resolved (P0-2):** `RelationshipTransition` / `RelationshipExplanation` → Layer 6 only on canonical path.

**Enforcement:** INV-1 GRE persistence tests.

---

## RULE-4 — Config beats literals

Numeric coefficients live in `src/lib/config/*.ts` unless allow-listed structural constants.

- Catalogue: `config-inventory.md`.
- Allow-list: denominators (e.g. popularity 100), pure structural lengths.

---

## RULE-5 — No duplicate formulas

If two engines compute the same concept, one is canonical; the other is deleted or becomes a thin reader.

- **Resolved (P1-7):** CUB sole `discoveryConfidence`; shared `genre-adjacency.ts` / `SYSTEM_GENRES`.
- **Resolved (P0-1):** Expansion Intelligence sole `expansionDistance`; OCSE pure reader.
- Synthetic audio: shared `resolve-signature.ts`.

---

## RULE-6 — Every persistence schema has an owner

New table/column → declare owner in `data-contracts.md` + `ownership-matrix.md`.

- Bandit **TS types deleted** (Ticket 3). Prisma Bandit tables unowned schema residue — do not add writers without product decision.

---

## RULE-7 — Every public API states tier

Handlers declare **canonical** / **preview** / **debug** in JSDoc.

**Canonical write:**
- `POST /api/user/sync` — Identity
- `POST /api/world/regenerate` — `materializeWorld`
- `POST /api/user/explore` — explore + `materializeWorld`
- `POST /api/user/frontier` — explicit `materializeWorld`
- `POST /api/artist/[id]/integrate|ignore` — action + `materializeWorld`
- `POST /api/user/sync-demo` — demo bootstrap
- `GET /api/admin/force-frontier` — admin `materializeWorld` (real token)

**Canonical read:**
- `GET /api/globe` — pure projection (never rebuilds)
- `GET /api/user/frontier` — pure cache (never materializes)
- `POST /api/orca/expand` — read materialized frontier; empty → `materializeWorld` once; filter seeds. Never calls `buildFrontierNodes` directly.

**Debug:**
- `/api/debug/{ocse,retrieval,genre-relationships,candidate-universe,world-projection}`
- `/api/debug/pipeline` — planned (P3-15)
- `GET /api/admin/debug-frontier` — admin materialize + sample

---

## RULE-8 — No `process.env` mutation per-request

Handlers MUST NOT assign `process.env` for a request lifetime.

- **Resolved:** `withEnvOverrides` removed. Use `parseRequestRuntimeConfig` (request-scoped; no env write).
- **Enforcement:** INV-7 / grep `process.env[` assignment in api + ocse.

---

## RULE-9 — Pipeline ordering is fixed

See `pipeline.md §3`. Binding order:

```
Spotify Sync → Identity → CUB (+ORE) → GRE → Expansion Intelligence → OCSE →
layout (buildFrontierNodes) → materializeWorld → Profile + Territory →
WPE (projectWorld on GET /api/globe) → Client
```

- **INV-P1:** ✅ EI before OCSE; distance threaded on Candidate.
- **INV-P2:** Profile snapshot after frontier write inside `materializeWorld` full path.
- **INV-P3:** WPE only on response clones — never stored nodes.
- **INV-P4:** No stage invokes an earlier stage. Materialize is the only product caller of `buildFrontierNodes`. Globe GET never materializes.

---

## RULE-10 — No re-computation of contract outputs

Downstream reads upstream; does not re-derive.

- **Resolved (P0-1):** OCSE does not fabricate `expansionDistance`.
- **Resolved (P1-7):** ORE does not own aggregate discoveryConfidence.

---

## RULE-11 — `expansionDistance` is NOT a confidence

Distance in taste space, not confidence. See `confidence.md`. Top-level and `projectionMetadata.expansionDistance` must match (INV-5).

---

## RULE-12 — reachable / visible ownership

- `reachable`: initial in `buildFrontierNodes` from decisionConfidence; WPE may override on clone.
- `visible`: **WPE only** on clone. Never persisted as authority for rebuild.

---

## RULE-13 — WPE never rebuilds the world

WPE adjusts visibility only.

- **Resolved (Ticket 4 / P2-12):** `GET /api/globe` pure read + `projectWorld`. Rebuilds only via explicit write routes (`POST /api/world/regenerate`, integrate/ignore/explore, etc.).

---

## RULE-14 — Mid-pipeline stages do not write frontier

Inside `buildFrontierNodes` evaluation helpers: no frontier/world state writes. Frontier writes only in `materializeWorld`. Territory chain runs as post-step of full materialization.

- GRE may persist **its own** genre-state table; never territory relationship columns.
- Product `src/` must import `buildFrontierNodes` only from `pipeline-runner.ts`.

---

## RULE-15 — `audioSource` honesty

Every Candidate/OrcaNode/DecisionProfile carries `'REAL' | 'SYNTHETIC' | 'MISSING'`.

- Identity persists REAL into Artist.metadata when features exist.
- EI drops acoustic weight when source ≠ REAL.

---

## RULE-16 — Spec drift detection

New engine or contract field → update `pipeline.md`, `ownership-matrix.md`, `data-contracts.md`, and related inventories.

---

## PR cheat sheet

```
[ ] Single owner? (RULE-1)
[ ] Enrich, not overwrite? (RULE-2)
[ ] No multi-writer schema? (RULE-3, RULE-6)
[ ] No new magic literals outside config? (RULE-4)
[ ] No duplicate formula? (RULE-5)
[ ] Schema owner declared? (RULE-6)
[ ] API tier declared? (RULE-7)
[ ] No process.env mutation? (RULE-8)
[ ] Order: CUB → GRE → EI → OCSE → materialize → WPE on read? (RULE-9)
[ ] No re-compute of owned fields? (RULE-10)
[ ] expansionDistance not called confidence? (RULE-11)
[ ] reachable/visible ownership? (RULE-12)
[ ] WPE / GET globe did not rebuild? (RULE-13)
[ ] No new mid-pipeline frontier write? (RULE-14)
[ ] audioSource if touching signatures? (RULE-15)
[ ] Spec/docs updated for new engine? (RULE-16)
```

End of `architecture-rules.md`.
