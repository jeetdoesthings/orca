# Frontier pipeline

Canonical world materialization for unexplored artists.

## Flow

```
materializeWorld (pipeline-runner.ts)
  → buildFrontierNodes (orchestrator)
       → CUB adjacency only (candidate/cub.ts)
       → GRE (gre/)
       → stages/score-and-surface.ts
            EI distances
            leap-seek (single phase + refill)
            readiness
            OCSE surface (strict → allowNearFallback)
       → layout nodes + adjacentTo
       → stages/enrich-candidates helpers
  → anti-hallucination
  → persist frontierData + worldStateData
```

## Key types

- `types.ts` — `FrontierBuildResult` (nodes, surface, readiness, leapSeekMeta)
- No process globals / window stashes for surface or leap history

## UI depth

Shore / Shallow / Deep / Alo map to comfort / expansion / leap / all via `config/world.ts`.
