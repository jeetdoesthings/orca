# Success Metrics (`docs/architecture/success-metrics.md`)

**Status:** Day 1 complete. Binding measurement contract.  
**Authority:** structural metrics below mark closed Day 1 work; residual rows stay open.

---

## 1. Philosophy

1. **Architectural honesty** — single path, single owners, no fabricated distance, no dual writers.
2. **Behavioural preservation** — regression baselines (§4) for product-visible shifts.

A change is not “done” until structural invariants hold and declared baseline diffs pass.

---

## 2. Metric catalogue (status)

| ID | Metric | Status | Notes |
|----|--------|--------|-------|
| M1 | EI before OCSE | **MET** | P0-1; INV-5 tests |
| M2 | expansionDistance from EI (no OCSE fabricate) | **MET** | pure reader; no FALLBACK formula |
| M3 | territory vocabulary split | **MET** | P0-2 C.ii; separate tables |
| M4 | hardcoded coeff count | **MET** (product path) | WPE window + OCSE growth in config; structural allow-list only |
| M5 | dead-code inventory Safe items | **MET** (Ticket 3) | re-verify before new deletes |
| M6 | expand uses canonical path | **MET** | P1-13 + Ticket 4 materialize-or-read |
| M7 | recommendation duplication rate | open | product baseline |
| M8–M10 | distance / band / decision distributions | open | telemetry |
| M11 | pipeline latency | open | |
| M12–M13 | Spotify call count / cache | open | cub-cache deleted; other cache may exist |
| M14–M15 | pipeline inspector | open | P3-15 |
| M16 | process.env per-request mutation | **MET** | withEnvOverrides gone; request-runtime only |
| M17 | expansionDistance not labeled confidence | ongoing | grep hygiene |
| M18 | audioSource coverage | **MET** (field exists) | P1-10 |
| M19 | Layer 6 readers see 10-state only on territory table | **MET** design | post C.ii |
| M20 | GRE confidence floor configurable | **MET** | GreConfig P1-3 |

### Day 1 path metrics (additions)

| ID | Metric | Status |
|----|--------|--------|
| D1 | Sole `buildFrontierNodes` importer in `src/` is pipeline-runner | **MET** Ticket 4 |
| D2 | GET frontier never materializes | **MET** Ticket 4 |
| D3 | GET globe never rebuilds | **MET** P2-12 / Ticket 4 |
| D4 | Docs match code | **MET** Ticket 5 |

---

## 3. Structural invariants

| INV | Meaning | Enforcement |
|-----|---------|-------------|
| INV-1 | single writer GRE genre-state vs Layer 6 territory | `gre/__tests__/persistence.test.ts` |
| INV-2 | no WPE writeback to stored nodes | design + review |
| INV-3 | WPE only reachable/visible on clone | design + review |
| INV-4 | GRE does not write userTerritoryRelationship | INV-1 tests |
| INV-5 | OCSE pure reader of expansionDistance | `ocse/__tests__/decision-engine.test.ts` + EI tests |
| INV-6 | config beats literals | config-inventory + review |
| INV-7 | no process.env mutation in api/ocse | grep / code review |
| INV-8 | globe headers do not bump snapshot | pure GET; regenerate is POST |
| INV-P | product stage runner only via materializeWorld | grep import |

---

## 4. Regression baseline

Unchanged intent: `scripts/capture-baseline.ts` + fixture-schema. Capture stages against sole pipeline. Globe stage is pure read (no withEnvOverrides).

---

## 5. Quality gates for PRs

- RULE cheat sheet in `architecture-rules.md`
- No reintroduction of dual materializers, env mutation, or OCSE fabricate
- Update this status table if closing residual metrics

## 6. Definition of done (Day 1)

Tickets 1–5 closed; P1-6 + WPE config + empty Safe dead-code list closed. M1–M6, M16, M18, M20, D1–D4 met. Post-Day-1 residuals: P3-15 inspector, Bandit schema.

End of `success-metrics.md`.
