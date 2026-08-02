/**
 * Candidate Universe Builder (CUB) configuration.
 * Controls direct match bonuses, multi-source increments, limits, and budgets.
 */
export const CubConfig = {
  /** direct genre match confidence boost factor */
  genreMatchBoost: 0.18,
  /** multi-source diversity increment coefficient */
  multiSourceDiversityMultiplier: 0.12,
  /** absolute cap limit for candidate discovery confidence */
  maxPossibleConfidence: 0.98,
  /** search candidate budget per target growth opportunity */
  budgetPerOpportunity: 150,
  /** maximum growth opportunities limit to search per run */
  topOpportunitiesLimit: 8
};
