/**
 * GET /api/admin/embedding-coverage — Part 14 confidence tag coverage.
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyAdminRequest } from '@/lib/auth/admin-auth';

export async function GET(request: NextRequest) {
  try {
    const openLocal =
      process.env.EMBEDDING_COVERAGE_OPEN === '1' || process.env.NODE_ENV !== 'production';
    if (!openLocal && !verifyAdminRequest(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const rows = await prisma.trackEmbedding.groupBy({
      by: ['confidenceTag'],
      _count: { _all: true },
    });
    const total = rows.reduce(
      (s: number, r: { _count: { _all: number } }) => s + r._count._all,
      0,
    );
    const byTag: Record<string, number> = {};
    for (const r of rows) {
      byTag[r.confidenceTag] = r._count._all;
    }
    const real = byTag['real_audio'] ?? 0;

    return NextResponse.json({
      totalTrackEmbeddings: total,
      byTag,
      real_audio_pct: total > 0 ? Math.round((real / total) * 10000) / 100 : 0,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[embedding-coverage]', err);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
