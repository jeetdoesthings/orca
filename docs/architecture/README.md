# ORCA Architecture Documentation (`docs/architecture/`)

**Status:** Day 1 complete (Tickets 1–5). Docs match code (Ticket 5).  
**Authority:** code is source of truth for live behavior; this tree documents contracts.

---

## 0. The one-paragraph mental model

ORCA runs **8 concerns** (spec names 5; ORE, Expansion Intelligence, and Profile are real code). Product path:

**Spotify sync / Identity → CUB (+ORE) → GRE → Expansion Intelligence → OCSE → layout → `materializeWorld` → profile/territory → WPE on GET `/api/globe` → Frontend.**

Sole stage runner: `buildFrontierNodes` (only via `materializeWorld` in `src/`). Sole world writer: `materializeWorld`. Sole projector: `projectWorld`. `expansionDistance` owned by Expansion Intelligence; OCSE is a pure reader. GRE persists 7-state on `UserGenreRelationshipState`; Layer 6 sole-owns territory 10-state on `userTerritoryRelationship`.

---

## 1. Reading guide

| If you're asking… | Read this |
|---|---|
| Canonical pipeline order and entry points | [`pipeline.md`](./pipeline.md) |
| Who owns this field | [`ownership-matrix.md`](./ownership-matrix.md) + [`data-contracts.md`](./data-contracts.md) |
| What a “confidence” number means | [`confidence.md`](./confidence.md) |
| Magic numbers / config homes | [`config-inventory.md`](./config-inventory.md) |
| Dead / deleted code | [`dead-code-inventory.md`](./dead-code-inventory.md) |
| Binding rules for PRs | [`architecture-rules.md`](./architecture-rules.md) |
| How we measure “done” | [`success-metrics.md`](./success-metrics.md) |
| Regression harness shapes | [`fixture-schema.md`](./fixture-schema.md) |
| Why decision X | [`decisions/`](./decisions/) |

---

## 2. Document index

### Core (binding)
- **[`pipeline.md`](./pipeline.md)** — engine inventory, order, entry points, materializer, glossary.
- **[`ownership-matrix.md`](./ownership-matrix.md)** — field × owner.
- **[`data-contracts.md`](./data-contracts.md)** — Candidate, OrcaNode, DecisionProfile contracts.
- **[`architecture-rules.md`](./architecture-rules.md)** — RULE-1…RULE-16 + PR checklist.

### Inventories
- **[`confidence.md`](./confidence.md)** — confidence families; CUB sole discoveryConfidence.
- **[`config-inventory.md`](./config-inventory.md)** — literals vs `src/lib/config/*`.
- **[`dead-code-inventory.md`](./dead-code-inventory.md)** — Ticket 3/4 closeout.
- **[`backend-fix-audit.md`](./backend-fix-audit.md)** — Phase 0 full backend audit (stack, stages, APIs, formulas, design tokens) before ORCA Backend Fix Parts 1–13.
- **[`backend-fix-deploy.md`](./backend-fix-deploy.md)** — Env vars, CI, FE flags after Parts 1–13.
- **[`backend-fix-part13-report.md`](./backend-fix-part13-report.md)** — Integration report (what passed / open ops items).

### Success / harness
- **[`success-metrics.md`](./success-metrics.md)** — metrics + invariants status.
- **[`fixture-schema.md`](./fixture-schema.md)** — baseline fixture contract.

### Decisions
- **[`decisions/gre-vs-layer6.md`](./decisions/gre-vs-layer6.md)** — ✅ Option C.ii implemented (P0-2).
- **[`decisions/orca-expand-bypass.md`](./decisions/orca-expand-bypass.md)** — ✅ Implemented (P1-13 + Ticket 4 materialize-or-read).

---

## 3. The 8 engines (quick reference)

| ID | Engine | File | Notes |
|----|--------|------|-------|
| E1 | Identity | `spotifySync.ts`, `identity.ts` | Real audio → Artist.metadata; SYNTHETIC via resolve-signature |
| E2 | GRE | `gre/gre.ts` | 7-state; persists `UserGenreRelationshipState` |
| E3 | CUB | `candidate/cub.ts` | Sole `discoveryConfidence` |
| E4 | OCSE | `ocse/decision-engine.ts` | Pure reader of expansionDistance |
| E5 | WPE | `frontier/world-projection.ts` | Every ready globe response |
| E6 | ORE | `candidate/ore.ts` | Retrieval under CUB |
| E7 | Expansion Intelligence | `expansion/intelligence.ts` | Owns expansionDistance / band |
| E8 | Profile | `profile/*` | Profile JSON + territory L3→4→6→7→8 |

**Deleted:** Bandit TS types. **Not engines:** client seed picker `getExpansionCandidates` (IDs only).

---

## 4. Day 1 + Phase 2 status

### Closed
| ID | Item | Status |
|----|------|--------|
| P0-1 | EI before OCSE; thread expansionDistance | ✅ |
| P0-2 | GRE vs Layer 6 tables (C.ii) | ✅ |
| P1-3 | GRE confidence → GreConfig | ✅ |
| P1-4 | OCSE coeffs → OcseConfig | ✅ |
| P1-5 | LegacyDecisionResult delete | ✅ |
| P1-7 | CUB sole discoveryConfidence; genre-adjacency | ✅ |
| P1-8 | cub-cache delete | ✅ |
| P1-9 | EI / ORE config modules | ✅ |
| P1-6 | Real `currentVisibleWorldIds` → growthContribution | ✅ |
| P1-10 | audioSource REAL/SYNTHETIC/MISSING | ✅ |
| P1-13 | expand off Last.fm bypass | ✅ (+ Ticket 4 sole writer) |
| Config | WPE window in `WorldConfig.projectionWindow`; shared client/server | ✅ |
| Ticket 2 | Journey remove | ✅ |
| Ticket 3 | Dead code / obsolete config | ✅ |
| Ticket 4 | One recommendation path | ✅ |
| Ticket 5 | Docs = code | ✅ |
| P2-12 | Globe pure GET + POST regenerate | ✅ |
| Dual materializers | materializeWorld only | ✅ |

### Residual (post Day 1 — not blockers)
| Item | Notes |
|------|-------|
| Prisma Bandit* tables | Accepted schema residue; no TS engine |
| P3-15 | Unified `/api/debug/pipeline` inspector (tooling) |
| Debug routes | Accepted inspect tier — not product recommend path |

---

## 5. Product topology (Ticket 4)

```
WRITE:  sync → Identity
        regenerate | integrate | ignore | explore | frontier POST | admin force
             → materializeWorld → buildFrontierNodes → DB

READ:   GET /api/globe → projectWorld → FE
        GET /api/user/frontier → cache only
        POST /api/orca/expand → read frontier | materialize if empty → filter seeds
```

Start with [`pipeline.md`](./pipeline.md) §3 for order; [`architecture-rules.md`](./architecture-rules.md) for PR gates.
