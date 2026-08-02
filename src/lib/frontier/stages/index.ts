/**
 * Frontier pipeline stages (extracted for modularity).
 */
export { scoreAndBuildSurface } from './score-and-surface';
export type { ScoreAndSurfaceInput, ScoreAndSurfaceResult } from './score-and-surface';
export {
  hydrateCandidatesFromCatalog,
  fillCandidatesFromCatalog,
  computeUserCentroid,
  computeUserGenreProfile,
} from './enrich-candidates';
export { diversifyExpansionDistancesIfCollapsed } from './diversify-distances';
