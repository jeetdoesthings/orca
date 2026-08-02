import { PrismaClient } from '@prisma/client';
import path from 'path';

/**
 * Bump when adding models that must exist on the singleton.
 * Dev HMR keeps global PrismaClient forever — old instances miss new delegates.
 */
const PRISMA_CLIENT_EPOCH = 3;

type GlobalPrisma = {
  prisma?: PrismaClient;
  prismaEpoch?: number;
};

const globalForPrisma = global as unknown as GlobalPrisma;

/**
 * Part 16: respect DATABASE_URL.
 * - Postgres: postgresql://… (set provider = "postgresql" in schema after cutover)
 * - SQLite (dev default): file:… absolute path for Next/Vercel cwd stability
 *
 * Never hard-code a single path that ignores env.
 */
function resolveDatabaseUrl(): string {
  if (process.env.DATABASE_URL && process.env.DATABASE_URL.length > 0) {
    const u = process.env.DATABASE_URL.trim();
    // Canonical local sqlite paths → prisma/dev.db
    if (
      u === 'file:./dev.db' ||
      u === 'file:dev.db' ||
      u === 'file:./prisma/dev.db' ||
      u === 'file:prisma/dev.db'
    ) {
      return `file:${path.join(process.cwd(), 'prisma', 'dev.db')}`;
    }
    if (u.startsWith('file:./') || (u.startsWith('file:') && !u.startsWith('file:/'))) {
      const rel = u.replace(/^file:/, '').replace(/^\.\//, '');
      return `file:${path.join(process.cwd(), rel)}`;
    }
    return u;
  }
  // Default local SQLite until Postgres cutover complete
  return `file:${path.join(process.cwd(), 'prisma', 'dev.db')}`;
}

const dbUrl = resolveDatabaseUrl();

function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    datasources: {
      db: {
        url: dbUrl,
      },
    },
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });
}

function hasRequiredDelegates(client: PrismaClient): boolean {
  // Keep list short — only models added after long-lived dev sessions started.
  const c = client as unknown as Record<string, unknown>;
  return (
    typeof c.recommendationServeLog === 'object' &&
    c.recommendationServeLog != null &&
    typeof c.recommendationMemory === 'object' &&
    c.recommendationMemory != null &&
    typeof c.recommendationRun === 'object' &&
    c.recommendationRun != null
  );
}

function getPrismaBase(): PrismaClient {
  const cached = globalForPrisma.prisma;
  const epochOk = globalForPrisma.prismaEpoch === PRISMA_CLIENT_EPOCH;
  if (cached && epochOk && hasRequiredDelegates(cached)) {
    return cached;
  }
  // Drop stale singleton (pre-model generate / old epoch)
  if (cached) {
    void cached.$disconnect().catch(() => {});
  }
  const fresh = createPrismaClient();
  if (process.env.NODE_ENV !== 'production') {
    globalForPrisma.prisma = fresh;
    globalForPrisma.prismaEpoch = PRISMA_CLIENT_EPOCH;
  }
  return fresh;
}

const prismaBase = getPrismaBase();

/**
 * Audit fix H1: the former `$extends` interceptor redirected
 * `user.findFirst({ where: { syncStatus: 'COMPLETE' } })` to the `demo-user`
 * row, and when no demo row existed it fell through to the FIRST REAL SYNCED
 * USER — an unauthenticated cross-user data path. That interceptor is removed.
 * Demo routes must use the gated resolver in `@/lib/auth/demo-user`.
 */
export const prisma = prismaBase as any;

/** Unextended client for bulk/ops that need raw delegates. */
export { prismaBase };
