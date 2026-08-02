/**
 * Agency weight recalibration (Part 5).
 *
 * Joins raw interaction events to durability outcomes and fits candidate
 * weights (mean durability by interaction type — simple, reviewable).
 *
 * NEVER auto-deploys. Output is a draft AgencyWeightProposal for human review.
 *
 * Comment for maintainers: weights should never silently self-modify in
 * production without a review step. Only status transitions draft→approved→active
 * by a human (or explicit approveAgencyWeightProposal call after review).
 */

import { prisma } from '@/lib/prisma';
import { AGENCY_V0_WEIGHTS } from '@/lib/config/agency';

export interface RecalibrationRow {
  interactionType: string;
  sampleSize: number;
  meanDurability: number;
  proposedWeight: number;
}

export interface RecalibrationResult {
  weights: Record<string, number>;
  rows: RecalibrationRow[];
  sampleSize: number;
  /** Always 'draft' from the job path. */
  status: 'draft';
  proposalId?: string;
}

/**
 * Pure fit: group by interaction type, mean durability score among resolved outcomes.
 * Maps mean durability ∈ [0,1] to proposed weight (identity for v0 calibration scale).
 * Types with no resolved samples keep v0 weight.
 */
export function fitAgencyWeightsFromSamples(
  samples: Array<{ interactionType: string; durabilityScore: number }>,
  v0: Record<string, number> = AGENCY_V0_WEIGHTS,
): RecalibrationResult {
  const buckets = new Map<string, number[]>();
  for (const s of samples) {
    if (!Number.isFinite(s.durabilityScore)) continue;
    const list = buckets.get(s.interactionType) ?? [];
    list.push(Math.max(0, Math.min(1, s.durabilityScore)));
    buckets.set(s.interactionType, list);
  }

  const weights = { ...v0 };
  const rows: RecalibrationRow[] = [];
  let sampleSize = 0;

  for (const [type, scores] of buckets) {
    sampleSize += scores.length;
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    // Proposed weight = mean durability (interpretable). Clamp [0, 1].
    const proposedWeight = Math.round(mean * 1000) / 1000;
    weights[type] = proposedWeight;
    rows.push({
      interactionType: type,
      sampleSize: scores.length,
      meanDurability: proposedWeight,
      proposedWeight,
    });
  }

  rows.sort((a, b) => b.sampleSize - a.sampleSize);

  return {
    weights,
    rows,
    sampleSize,
    status: 'draft',
  };
}

/**
 * Load resolved (non-pending) durability-linked events and fit draft weights.
 * Writes AgencyWeightProposal with status=draft only.
 */
export async function runAgencyRecalibration(opts?: {
  /** Persist draft proposal (default true). */
  persist?: boolean;
  notes?: string;
}): Promise<RecalibrationResult> {
  const persist = opts?.persist !== false;

  const events = await prisma.agencyInteractionEvent.findMany({
    where: {
      durabilityOutcomeId: { not: null },
      durabilityOutcome: {
        status: { in: ['confirmed_positive', 'confirmed_zero'] },
      },
    },
    include: {
      durabilityOutcome: true,
    },
  });

  const samples = events
    .filter((e: (typeof events)[number]) => e.durabilityOutcome != null)
    .map((e: (typeof events)[number]) => {
      const o = e.durabilityOutcome!;
      const score =
        o.status === 'confirmed_zero'
          ? 0
          : o.score != null
            ? o.score
            : 1;
      return {
        interactionType: e.interactionType,
        durabilityScore: score,
      };
    });

  const result = fitAgencyWeightsFromSamples(samples);

  if (persist) {
    // NEVER set status=active here — human review only.
    const proposal = await prisma.agencyWeightProposal.create({
      data: {
        weightsJson: JSON.stringify(result.weights),
        sampleSize: result.sampleSize,
        status: 'draft',
        method: 'mean_durability_by_type',
        notes:
          opts?.notes ??
          `Auto draft from recalibration job. Review before activate. rows=${result.rows.length}`,
      },
    });
    result.proposalId = proposal.id;
  }

  return result;
}

/**
 * Human review step: mark draft approved (still not active).
 */
export async function approveAgencyWeightProposal(
  proposalId: string,
  reviewedBy: string,
): Promise<void> {
  await prisma.agencyWeightProposal.update({
    where: { id: proposalId },
    data: {
      status: 'approved',
      reviewedAt: new Date(),
      reviewedBy,
    },
  });
}

/**
 * Explicit activation after approval. Deactivates previous active rows.
 * Do not call from the recalibration job.
 */
export async function activateAgencyWeightProposal(proposalId: string): Promise<void> {
  const prop = await prisma.agencyWeightProposal.findUnique({ where: { id: proposalId } });
  if (!prop || (prop.status !== 'approved' && prop.status !== 'active')) {
    throw new Error(
      `Proposal ${proposalId} must be approved before activate (status=${prop?.status})`,
    );
  }
  await prisma.$transaction([
    prisma.agencyWeightProposal.updateMany({
      where: { status: 'active' },
      data: { status: 'approved' },
    }),
    prisma.agencyWeightProposal.update({
      where: { id: proposalId },
      data: { status: 'active' },
    }),
  ]);
}
