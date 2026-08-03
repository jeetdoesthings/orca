#!/usr/bin/env node
/**
 * One-shot SQLite → Postgres data migration for ORCA.
 *
 * Reads the current schema.prisma for model/column types, dumps every table
 * from the SQLite dev.db (prisma/dev.db), and upserts into Postgres with
 * `ON CONFLICT DO NOTHING` (idempotent — safe to re-run).
 *
 * Type conversions handled:
 *   - DateTime (stored as Unix ms INTEGER in SQLite) → ISO-8601 timestamptz
 *   - Boolean (0/1) → true/false
 *   - String / Int / Float / BigInt pass through
 *   - Enum fields (schema-declared enums) → string passthrough
 *   - String columns holding JSON stay strings (schema uses String for blobs)
 *
 * Usage:
 *   DATABASE_URL="postgresql://jeet@localhost:5432/orca" node scripts/sqlite-to-pg.mjs
 *
 * Prereq: `npx prisma migrate deploy` has created the Postgres schema.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { execSync } from 'child_process';

const require = createRequire(import.meta.url);
const { Client } = require('pg');

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SQLITE_PATH = process.env.SQLITE_PATH || path.join(ROOT, 'prisma', 'dev.db');
const DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://jeet@localhost:5432/orca';

// ── 1. Parse schema.prisma for models, enums, column types, and PKs ──
const schemaText = fs.readFileSync(path.join(ROOT, 'prisma', 'schema.prisma'), 'utf-8');

const SCALAR_TYPES = new Set([
  'String', 'Int', 'Float', 'Boolean', 'DateTime', 'BigInt', 'Bytes', 'Decimal', 'Json',
]);

function parseModels() {
  const models = {};
  const enumNames = new Set();
  // Collect enum names.
  const enumRe = /enum\s+(\w+)\s*\{/g;
  let em;
  while ((em = enumRe.exec(schemaText)) !== null) enumNames.add(em[1]);

  const modelRe = /model\s+(\w+)\s*\{([^}]*)\}/g;
  let m;
  while ((m = modelRe.exec(schemaText)) !== null) {
    const name = m[1];
    const body = m[2];
    const fields = {};
    const idFields = [];
    let compoundId = null;
    for (const line of body.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('//')) continue;
      if (trimmed.startsWith('@@id')) {
        const match = trimmed.match(/@@id\s*\(\s*\[([^\]]+)\]/);
        if (match) compoundId = match[1].split(',').map((s) => s.trim());
        continue;
      }
      if (trimmed.startsWith('@@')) continue;
      const parts = trimmed.split(/\s+/);
      const fieldName = parts[0];
      // Normalize nullable marker: "DateTime?" → "DateTime"
      const fieldType = (parts[1] || '').replace(/\?$/, '');
      if (!fieldName || !fieldType) continue;
      const isScalar = SCALAR_TYPES.has(fieldType) || enumNames.has(fieldType);
      if (isScalar) {
        fields[fieldName] = SCALAR_TYPES.has(fieldType) ? fieldType : 'String';
        if (trimmed.includes('@id')) idFields.push(fieldName);
      }
    }
    models[name] = {
      fields,
      idFields,
      conflictTarget: compoundId || idFields,
    };
  }
  return models;
}

const models = parseModels();

// ── 2. Dump SQLite tables to JSON via the sqlite3 CLI ──
function dumpTable(name) {
  try {
    const out = execSync(
      `sqlite3 -json "${SQLITE_PATH}" "SELECT * FROM \\"${name}\\";"`,
      { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 },
    ).trim();
    return out ? JSON.parse(out) : [];
  } catch {
    return null; // table missing
  }
}

// ── 3. Convert a row per schema types ──
function convertRow(row, model) {
  const out = {};
  for (const [col, val] of Object.entries(row)) {
    const type = model.fields[col];
    if (val === null || val === undefined) {
      out[col] = null;
      continue;
    }
    switch (type) {
      case 'DateTime': {
        const n = Number(val);
        out[col] = Number.isFinite(n) && n > 0
          ? new Date(n).toISOString()
          : new Date(val).toISOString();
        break;
      }
      case 'Boolean':
        out[col] = val === 1 || val === true || val === '1' || val === 'true';
        break;
      case 'Int':
        out[col] = Math.trunc(Number(val));
        break;
      case 'Float':
        out[col] = Number(val);
        break;
      case 'BigInt':
        out[col] = BigInt(val).toString();
        break;
      default:
        out[col] = String(val);
    }
  }
  return out;
}

// ── 4. Upsert into Postgres ──
async function main() {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  console.log(`Connected to ${DATABASE_URL.split('@')[1] || DATABASE_URL}`);

  const summary = [];
  for (const [modelName, model] of Object.entries(models)) {
    const rows = dumpTable(modelName);
    if (rows === null) {
      summary.push(`${modelName}: SQLite table missing — skipped`);
      continue;
    }
    if (rows.length === 0) {
      summary.push(`${modelName}: 0 rows`);
      continue;
    }

    const converted = rows.map((r) => convertRow(r, model));
    const cols = Object.keys(converted[0]);
    const colList = cols.map((c) => `"${c}"`).join(', ');
    const paramList = cols.map((_, i) => `$${i + 1}`).join(', ');
    const target = model.conflictTarget?.length
      ? ` (${model.conflictTarget.map((c) => `"${c}"`).join(', ')})`
      : '';

    const insertSql = `INSERT INTO "${modelName}" (${colList}) VALUES (${paramList})` +
      (target ? ` ON CONFLICT ${target} DO NOTHING` : '');

    let inserted = 0;
    let skipped = 0;
    for (const row of converted) {
      try {
        const res = await client.query(insertSql, cols.map((c) => row[c]));
        if (res.rowCount > 0) inserted++;
        else skipped++;
      } catch (err) {
        console.warn(`  [${modelName}] row error (${JSON.stringify(row).slice(0, 80)}): ${err.message}`);
      }
    }
    summary.push(`${modelName}: ${inserted} inserted / ${skipped} existing / ${rows.length} total`);
  }

  console.log('\n=== Summary ===');
  for (const s of summary) console.log('  ' + s);

  await client.end();
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
