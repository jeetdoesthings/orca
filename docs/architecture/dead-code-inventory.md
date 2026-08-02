# Dead Code Inventory

**Status:** Day 1 closeout complete. **Safe-to-delete list: empty.**

## Definition (binding)

| Class | Meaning | Day 1 bar |
|-------|---------|-----------|
| **Safe delete** | Zero runtime purpose, zero callers, product-irrelevant | **Must be empty** |
| **Accepted residue** | Deliberately kept: schema, debug inspect, live enrichment | Documented below — **not dead** |
| **Scripts-only** | Not product path | Documented |

“No dead code remains” = no **Safe delete** items left in `src/`. Residues below are accepted by product/architecture decision.

---

## Safe delete — EMPTY

No items. Ticket 3 emptied this list; re-verify with grep below before new deletes.

---

## Deleted (historical — do not reintroduce)

| Item | Ticket |
|------|--------|
| `calculateIdentityValue` | 3 |
| `bandit-types.ts` | 3 |
| `lofl/maturation.ts` | 3 |
| Last.fm dense graph / `GET /api/orca` / mock audio | 3 |
| `WorldProjectionConfig` (unused) | 3 — **re-homed** live keys into `WorldConfig.projectionWindow` |
| Root dupe docs | 3 |
| LegacyDecisionResult, cub-cache, dual GENRE_ADJACENCY | P1 |
| Journey | 2 |
| Dual materializers, withEnvOverrides, USE_OCSE_V2 | 3–4 |
| Expand bare `buildFrontierNodes`, frontier GET materialize | 4 |
| growthContribution diversity-only stub | P1-6 closed |

---

## Accepted residue (not dead)

| Item | Why kept |
|------|----------|
| Debug API routes (`/api/debug/*`) | Engine inspect; zero FE callers; RULE-7 debug tier |
| Admin force/debug-frontier | Admin-gated; call `materializeWorld` |
| Prisma Bandit* tables | Schema residue; no TS engine; drop only with migration decision |
| `projectionMetadata` | Live WPE candidate detection |
| `discoveredRecently` / `availableActions` | Live enrichment paths |
| `orca-cache.json` path | Image route |
| `skipOcse` option | Scripts/baseline only; product never passes true |

---

## Verification

```
# Safe-delete ghosts — expect empty in src
rg "calculateIdentityValue|expandLastFmGraph|getOrBuildLastFmGraph|bandit-types|calculateDynamicMaturationPeriod|generateMockAudioSignature|projectionCheckpoints" src

# Sole stage-runner importer
rg "from ['\"].*buildFrontierNodes" src
# expect: pipeline-runner only

npm run typecheck && npm test
```
