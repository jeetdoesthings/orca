/**
 * Part 14 — confidence-tag coverage across TrackEmbedding (+ optional Artist.metadata).
 *
 * Usage: npx tsx scripts/embedding-coverage-report.ts
 */
import { prisma } from '../src/lib/prisma';

async function main() {
  const rows = await prisma.trackEmbedding.groupBy({
    by: ['confidenceTag'],
    _count: { _all: true },
  });

  const total = rows.reduce((s, r) => s + r._count._all, 0);
  const byTag: Record<string, number> = {};
  for (const r of rows) {
    byTag[r.confidenceTag] = r._count._all;
  }

  const real = byTag['real_audio'] ?? 0;
  const tag = byTag['tag_inferred'] ?? 0;
  const cold = byTag['cold_start_default'] ?? 0;
  const realPct = total > 0 ? ((real / total) * 100).toFixed(2) : '0.00';

  const report = {
    totalTrackEmbeddings: total,
    real_audio: real,
    tag_inferred: tag,
    cold_start_default: cold,
    real_audio_pct: Number(realPct),
    byTag,
    generatedAt: new Date().toISOString(),
  };

  console.log(
    `[coverage] real_audio_pct=${realPct} real_audio=${real} tag_inferred=${tag} cold_start_default=${cold} total=${total}`,
  );
  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
