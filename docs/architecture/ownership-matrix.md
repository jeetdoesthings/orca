# Engine Ownership Matrix & Pipeline Order (`docs/architecture/ownership-matrix.md`)

**Status:** Day 1 complete. Binding.  
**Authority:** no field may have two owners. Historical violations catalogued as RESOLVED/DELETED in §4.

---

## 1. The 8 engines

| ID | Engine | Spec? | Responsibility |
|----|--------|-------|----------------|
| **E1** | Identity Builder | yes | Spotify footprint → `User.globeData` + profile initiation. No candidate scoring. |
| **E2** | GRE | yes | GenreRelationship[] + persist 7-state on `UserGenreRelationshipState`. Never writes territory tables. |
| **E3** | CUB | yes | Candidate[] + sole `discoveryConfidence`. No visibility filter. |
| **E4** | OCSE | yes | DecisionProfile[]. Pure reader of expansionDistance. No env mutation. |
| **E5** | WPE | yes | `visible` + `reachable` override on response clones only. Never rebuilds. |
| **E6** | ORE | no | Retrieval + per-source evidence. No aggregate discoveryConfidence. |
| **E7** | Expansion Intelligence | no | Canonical `expansionDistance` / band / value. No DB writes. |
| **E8** | Profile subsystem | no | In-memory UserProfile + territory chain L3→4→6→7→8. |

**Deleted:** Bandit TS types (`bandit-types.ts`).

---

## 2. Field ownership matrix

### 2.1 Identity / sync
| Field | Owner | Stored? | Notes |
|-------|-------|---------|-------|
| `User.globeData` | Identity | yes | explored nodes |
| `User.profileData` | Profile (write) / Identity (initiate) | yes | |
| `OrcaNode.audioSignature` (explored) | Identity | within globeData | REAL preferred |
| `OrcaNode.audioSource` | Identity / EI pre-pass (frontier) | yes | REAL \| SYNTHETIC \| MISSING |
| `IdentitySeed[]` | Identity | transient | |

### 2.2 CUB / ORE
| Field | Owner | Notes |
|-------|-------|-------|
| `Candidate` lifecycle | CUB | transient |
| `Candidate.discoveryConfidence` | **CUB** (sole) | P1-7 resolved |
| `Candidate.discoveryContext.sources` | CUB (merge) | from ORE evidence |
| `Candidate.candidateClassification` | CUB | |
| Per-source evidence confidence | ORE | source-level only |
| `Candidate.expansionDistance` | **EI** (pre-pass) | before OCSE |

### 2.3 GRE
| Field | Owner | Notes |
|-------|-------|-------|
| GenreRelationship metrics/stage/summary/confidence | GRE | in-memory + optional persist |
| `UserGenreRelationshipState.*` | **GRE** sole | 7-state vocabulary |
| `userTerritoryRelationship.*` | **Layer 6** sole | 10-state; GRE never writes |

### 2.4 OCSE
| Field | Owner | Notes |
|-------|-------|-------|
| DecisionProfile dimensions / decisionConfidence / reasons | OCSE | |
| `DecisionProfile.expansionDistance` | **EI** (read-through) | undefined if Candidate missing distance — never fabricate |
| `growthContribution` | OCSE | P1-6: `currentVisibleWorldIds` + GRE diversity via `OcseConfig.growthContribution` |

### 2.5 Expansion Intelligence
| Field | Owner | Notes |
|-------|-------|-------|
| `expansionDistance`, `expansionBand`, `expansionValue` | **EI** | on Candidate then OrcaNode |
| acoustic/cultural/identity intermediate distances | EI | transient |

### 2.6 WPE
| Field | Owner | Notes |
|-------|-------|-------|
| `OrcaNode.visible` | **WPE** only | response clone |
| `OrcaNode.reachable` override | WPE on clone | initial from buildFrontierNodes |
| projection stats | WPE | transient |

### 2.7 Profile / territory
| Field | Owner | Notes |
|-------|-------|-------|
| UserProfile sub-objects | Profile L1–L6 + explainer | profileData |
| Territory mapping/affinity/relationship/intervention/cultivation | Profile L3/L4/L6/L7/L8 | own tables |
| RelationshipTransition / Explanation | Layer 6 | post P0-2 |

### 2.8 Pipeline-state (sole materializer)
| Artifact | Owner | Notes |
|----------|-------|-------|
| `User.frontierData` | **`materializeWorld`** | only writer |
| `User.worldStateData` | **`materializeWorld`** | versions + delta meta |
| `User.perimeterData` | **`materializeWorld`** (full) | |
| `User.adventurousnessHistory` | **`materializeWorld`** (full) | |
| `User.frontierStatus` / `frontierComputedAt` | **`materializeWorld`** | |
| FS `world-state-*.json` | **DELETED** | DB only |

---

## 3. Engine contract table

| Engine | Owns | Forbidden |
|--------|------|-----------|
| E1 Identity | globeData, real audio path, seeds | candidate scoring, visibility |
| E2 GRE | genre relationships + UserGenreRelationshipState | territory columns, CUB |
| E3 CUB | Candidate + discoveryConfidence | visibility, OCSE scoring |
| E4 OCSE | DecisionProfile scoring fields | fabricating expansionDistance, process.env |
| E5 WPE | visible, reachable override on clone | rebuild, DB, stored node mutation |
| E6 ORE | retrieval + per-source evidence | aggregate discoveryConfidence |
| E7 EI | expansionDistance family | DB writes |
| E8 Profile | profileData + territory chain | overwriting OrcaNode owner fields |

---

## 4. Violations (status)

| Violation | Status |
|-----------|--------|
| Dual expansionDistance (OCSE + EI) | **RESOLVED P0-1** |
| Dual discoveryConfidence (ORE + CUB) | **RESOLVED P1-7** |
| Dual userTerritoryRelationship writers | **RESOLVED P0-2** |
| Dual RelationshipTransition/Explanation | **RESOLVED P0-2** |
| Dual materializers / FS world-state | **RESOLVED** — `materializeWorld` only |
| withEnvOverrides / USE_OCSE_V2 | **RESOLVED** — removed |
| bandit-types.ts | **DELETED** Ticket 3 |
| growthContribution stub | **RESOLVED** P1-6 |
| Prisma Bandit tables | schema residue — no TS writer |

---

## 5. Pipeline order cheat sheet

```
0 Identity
1 CUB (+ORE)
2 GRE
3 Expansion Intelligence
4 OCSE
5 layout (buildFrontierNodes)
6 materializeWorld  (+ full: profile + territory)
7 WPE on GET /api/globe
8 Client
```

### Invariants
- **INV-1** single writer per persisted field.
- **INV-2** no in-flight mutation of stored nodes by WPE.
- **INV-3** WPE read-only re: non-visibility fields.
- **INV-4** GRE never writes `userTerritoryRelationship`.
- **INV-5** EI owns expansionDistance; OCSE pure reader (tests).
- **INV-6** config beats literals.
- **INV-7** no per-request `process.env` mutation.
- **INV-P-path** product `buildFrontierNodes` only via `materializeWorld`.

End of `ownership-matrix.md`.
