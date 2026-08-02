/**
 * Manual / scheduled Agency recalibration entrypoint (Part 5).
 *
 * Usage: npx tsx scripts/recalibrate-agency.ts
 *
 * Writes a draft AgencyWeightProposal only — does NOT activate weights.
 * Review output in DB / console before approve + activate.
 */
import { runAgencyRecalibration } from '../src/lib/metrics/agency-recalibration';

async function main() {
  console.log('[agency-recal] starting (draft only, no auto-apply)...');
  const result = await runAgencyRecalibration({
    notes: 'CLI recalibrate-agency.ts run',
  });
  console.log(
    JSON.stringify(
      {
        proposalId: result.proposalId,
        status: result.status,
        sampleSize: result.sampleSize,
        topRows: result.rows.slice(0, 15),
        weights: result.weights,
      },
      null,
      2,
    ),
  );
  console.log(
    '[agency-recal] done. Review draft proposal; do not auto-activate. Use approve + activate after human check.',
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
