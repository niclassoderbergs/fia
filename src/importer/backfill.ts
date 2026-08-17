// Engångsinläsning av eSett-körningshistoriken från energi-systemet.
//
//   ./scripts/dump-energi-runs.sh                    # SELECT ur energis DB → JSON
//   npm run backfill /tmp/energi-esett-runs.json     # JSON → data/runs/*.json
//
// Idempotent: samma dump två gånger ger byte-identiska filer. Översättningen
// ligger i backfill-map.ts; här finns bara filhanteringen.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { brpRunToReport, gridRunToReport, type EnergiDump } from './backfill-map';
import { DataStore, runReportPath } from './store';
import type { RunReport } from '@/lib/types';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function main(): void {
  const path = process.argv[2];
  if (!path) {
    console.error('Användning: npm run backfill <dump.json>');
    console.error('Skapa dumpen med ./scripts/dump-energi-runs.sh');
    process.exitCode = 1;
    return;
  }

  const dump = JSON.parse(readFileSync(path, 'utf8')) as EnergiDump;
  const store = new DataStore(join(ROOT, 'data'));

  const reports = [
    ...(dump.brp ?? []).map(brpRunToReport),
    ...(dump.grid ?? []).map(gridRunToReport),
  ];

  let written = 0;
  let skipped = 0;

  for (const report of reports) {
    // Skriv aldrig över en körning appen själv gjort, om id:n mot förmodan krockar.
    const existing = store.read<RunReport>(runReportPath(report.id));
    if (existing && existing.origin !== 'energi') {
      console.warn(`[backfill] hoppar över ${report.id} — id:t används av en egen körning`);
      skipped += 1;
      continue;
    }
    store.saveRun(report);
    written += 1;
  }

  console.log(
    `[backfill] ${written} körningar inlästa` +
      `${skipped > 0 ? `, ${skipped} överhoppade` : ''}` +
      ` (${(dump.brp ?? []).length} balansansvar, ${(dump.grid ?? []).length} nätområden)` +
      ` från dump ${dump.dumpedAt}`,
  );
}

main();
