# Decision: Expansion Intent vs Readiness Tier Selector

**Status:** Deferred (Change G)  
**Date:** 2026-07-13

## Context

Two product concepts answer a similar question:

1. **Expansion Intent** — “How do you want to grow today?” (deeper check-in)
2. **Readiness tier selector** — Comfort / Expansion / Leap (one-tap daily control)

They were never reconciled. Implementing both as daily competitors would dilute agency and confuse the globe control.

## Decision (default)

**Do not implement Expansion Intent as a daily-interaction competitor** to the tier selector.

- **Daily path:** Comfort / Expansion / Leap only (Changes D–F).
- **Expansion Intent:** optional future work as an occasional deeper check-in (weekly/monthly), not a blocking daily prompt. Or drop entirely.

## Related deferred axis

**“Familiar but deeper”** (depth within home territory — deep cuts, b-sides, same scene) is a **distinct axis** from readiness/distance. It must not be bolted on as a fourth tier.

- **Comfort** means low distance only — not deep cuts.
- Do not informally absorb deep-cuts into Comfort.

## Implementation notes

- No Expansion Intent UI in the current readiness redesign.
- Readiness Model (Change B) is the sole source of session default tier.
- Recalibrate bucket distance weights via `RecommendationServeLog` (Change H), not via inventing new tiers.
