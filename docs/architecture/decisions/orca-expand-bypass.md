# Decision: `/api/orca/expand` must use the canonical recommendation path

**Status:** ✅ **IMPLEMENTED** (Phase 2 P1-13 + Day 1 Ticket 4).  
**Authority:** binding.

---

## 1. Decision (present)

`POST /api/orca/expand` is a **canonical product** endpoint. It must not invent an alternate recommender.

**Live contract (Ticket 4):**

1. Auth + load `User.globeData` explored nodes.
2. `readWorldState` → `lastNodes` (materialized frontier).
3. If frontier empty and identity exists → **`materializeWorld` once** (sole writer; runs `buildFrontierNodes` internally).
4. Filter by seed `artistIds` adjacency; else full frontier.
5. Derive edges from `adjacentTo`.
6. Respond `{ source: 'orca-expand-canonical', nodes, edges }`.

**Never** import or call `buildFrontierNodes` from this route.  
**Never** call Last.fm dense-graph helpers for recommendations.

---

## 2. What was wrong (history)

Pre-P1-13 the route called `expandLastFmGraph`, returned `source: 'lastfm-dynamic-expansion'`, skipped CUB/GRE/EI/OCSE, used mock audio.

P1-13 rewired to `buildFrontierNodes` (full stage runner) but still **bypassed the materializer** (ephemeral dual world).

Ticket 4 fixed dual-world: expand is materialize-or-read only.

---

## 3. Files

- `src/app/api/orca/expand/route.ts` — materialize-or-read + filter.
- `src/components/Orca.tsx` — sole FE caller (`startExpansion`).
- Dense Last.fm graph route/helpers deleted in Ticket 3.

---

## 4. Record

- **Sign-off:** expand must not bypass pipeline (2026-07-05).
- **P1-13:** off Last.fm bypass.
- **Ticket 4:** sole materializer; no bare stage runner in product routes.

End of decision.
