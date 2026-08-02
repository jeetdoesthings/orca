# Canonical Data Contracts (`docs/architecture/data-contracts.md`)

**Status:** Day 1 complete. Binding.  
**Authority:** field owner here wins; change requires `decisions/*` if non-trivial.

Annotations: **Owner** · **Lifecycle** (transient / persisted) · **Consumers** · **Mutable** · **Canonical**.

---

## 1. `Candidate` — CUB → OCSE hand-off

**Type:** `src/lib/candidate/cub-types.ts`  
**Lifecycle:** transient — built by CUB, enriched by EI pre-pass, consumed by OCSE, discarded after DecisionProfile map.

| Field | Owner | Notes |
|-------|-------|-------|
| `artistId`, `name`, `genres`, `popularity`, `imageUrl` | ORE → CUB | retrieval attributes |
| `discoveryContext` (+ sources, stage mirror, supportingArtists) | CUB | merge from ORE evidence |
| `discoveryConfidence` | **CUB sole** | P1-7; ORE must not own aggregate |
| `candidateClassification` | CUB | |
| `expansionDistance?` | **Expansion Intelligence** | set in `buildFrontierNodes` pre-pass before OCSE |
| `expansionBand?` | EI | from distance |
| `audioSource?` | Identity / EI resolve | REAL \| SYNTHETIC \| MISSING |

OCSE **reads** `expansionDistance`; never fabricates (P0-1, RULE-10, INV-5 tests).

---

## 2. `OrcaNode` — graph unit

**Type:** `src/lib/graph/types.ts`  
**Lifecycle:** explored → `User.globeData`; frontier → `User.frontierData` (via `materializeWorld` only). No FS world-state files.

### Core
| Field | Owner | Notes |
|-------|-------|-------|
| id, name, genres, popularity, imageUrl | ORE / Identity | |
| weight | Identity (explored) / buildFrontierNodes (frontier) | |
| state | sync / buildFrontierNodes | explored \| frontier |
| audioSignature + audioSource | Identity REAL preferred; resolve-signature SYNTHETIC | RULE-15 |
| adjacentTo | buildFrontierNodes | |
| x,y,z | layout | |

### OCSE + frontier
| Field | Owner | Notes |
|-------|-------|-------|
| candidateEvidence | OCSE → attach | DecisionProfile |
| decisionReasons / explanation / semanticRole | OCSE → map | |
| reachable | buildFrontierNodes initial; WPE may override on **clone** | |
| visible | **WPE only** | every ready globe path |
| confidenceBand | buildFrontierNodes from decisionConfidence | |

### Expansion
| Field | Owner | Notes |
|-------|-------|-------|
| expansionDistance | **EI** | canonical distance (not confidence) |
| expansionBand | EI | |
| projectionMetadata | buildFrontierNodes | derived copy of distance+band for WPE candidate detect |

**Invariant:** `projectionMetadata.expansionDistance === expansionDistance`.

### Globe enrichment (response only)
Genre-intelligence / territory fields stamped on GET `/api/globe` clones — not authoritative frontier rewrite.

---

## 3. Genre vs territory state (resolved P0-2)

| Store | Owner | Vocabulary | Key |
|-------|-------|------------|-----|
| `UserGenreRelationshipState` | **GRE** | 7-state (spec) | raw genre |
| `userTerritoryRelationship` | **Layer 6** | 10-state | Territory_v2_* |

GRE must never write territory tables. Layer 6 must never write GRE genre-state table. See `decisions/gre-vs-layer6.md`.

---

## 4. Layer 6 `RelationshipState` (10-state)

**Owner:** Profile Layer 6 (`territory-relationship.ts`).  
Used on globe enrichment as `OrcaNode.relationshipState` (response).

---

## 5. `UserProfile` (`User.profileData`)

**Owner:** Profile subsystem (`computeUserProfile`).  
**Lifecycle:** persisted JSON. Written on sync and full `materializeWorld` profile post-step (patch path after recent sync).

Sub-objects: surface, sonic, traits, discovery, trajectory, confidence, explanations — each Profile-owned.

---

## 6. `ProjectionMetadata`

Derived on OrcaNode for WPE detection. Not a second authority for distance.

---

## 7. `DecisionProfile`

**Owner:** OCSE. Attached as `OrcaNode.candidateEvidence`.

| Field | Owner | Notes |
|-------|-------|-------|
| relationshipSupport, novelty, timing, slider, cooldown, decisionConfidence, reasons, explanation | OCSE | coeffs from OcseConfig |
| growthContribution | OCSE | P1-6: visible-world membership + GRE diversity (`OcseConfig.growthContribution`) |
| expansionDistance | **EI** (read-through) | undefined if Candidate missing — no fabricate |
| audioSource | threaded | honesty |

---

## 8. Contention summary (present tense)

| Field | Status |
|-------|--------|
| territory currentState dual writers | **RESOLVED** P0-2 |
| DecisionProfile.expansionDistance dual | **RESOLVED** P0-1 |
| discoveryConfidence dual | **RESOLVED** P1-7 |
| frontierData dual wrappers | **RESOLVED** — `materializeWorld` only |
| OrcaNode.visible | uncontested WPE |
| growthContribution | **RESOLVED** P1-6 |

End of `data-contracts.md`.
