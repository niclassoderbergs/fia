// Läser och skriver data/. Det här är hela persistenslagret — ingen databas,
// bara JSON i git.
//
// Två regler gäller varje skrivning:
//
//   1. Deterministisk serialisering. Samma data in → byte-identisk fil ut.
//      Annars blir varje daglig commit en diff även när inget hänt, och
//      git-historiken slutar fungera som ändringslogg.
//   2. Skriv bara när innehållet faktiskt skiljer sig. Samma skäl.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { cmp } from '@/esett/sort';
import type { Dataset, RunIndex, RunReport, RunSummary } from '@/lib/types';

/** Hur många körningar som ligger kvar i indexet. Äldre rapportfiler finns kvar på disk. */
const RUN_INDEX_LIMIT = 400;

export const DATA_FILES = {
  dsos: 'dsos.json',
  gridAreas: 'grid-areas.json',
  brpRelations: 'brp-relations.json',
  runIndex: join('runs', 'index.json'),
} as const;

export function runReportPath(runId: string): string {
  return join('runs', `${runId}.json`);
}

/** Serialisering som allt i data/ går igenom. 2 mellanslag + avslutande radbrytning. */
export function serialize(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export class DataStore {
  constructor(private readonly root: string) {}

  path(relative: string): string {
    return join(this.root, relative);
  }

  read<T>(relative: string): T | null {
    try {
      return JSON.parse(readFileSync(this.path(relative), 'utf8')) as T;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  /** Skriver bara om innehållet ändrats. Returnerar true när filen rörts. */
  write(relative: string, value: unknown): boolean {
    const target = this.path(relative);
    const next = serialize(value);
    try {
      if (readFileSync(target, 'utf8') === next) return false;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, next, 'utf8');
    return true;
  }

  readDataset<T>(relative: string): Dataset<T> | null {
    return this.read<Dataset<T>>(relative);
  }

  /** Föregående poster, eller tom lista när filen inte finns (första körningen). */
  previousRows<T>(relative: string): T[] {
    return this.readDataset<T>(relative)?.rows ?? [];
  }

  readRunIndex(): RunIndex {
    return this.read<RunIndex>(DATA_FILES.runIndex) ?? { updatedAt: '', runs: [] };
  }

  /** Lägger körningen överst i indexet och skriver rapportfilen. */
  saveRun(report: RunReport): void {
    this.write(runReportPath(report.id), report);

    const index = this.readRunIndex();
    const summary: RunSummary = {
      id: report.id,
      startedAt: report.startedAt,
      finishedAt: report.finishedAt,
      durationMs: report.durationMs,
      status: report.status,
      triggeredBy: report.triggeredBy,
      dryRun: report.dryRun,
      totals: report.totals,
      changeCount: report.changeCount,
      error: report.error,
    };

    const runs = [summary, ...index.runs.filter((r) => r.id !== report.id)]
      .sort((a, b) => cmp(b.id, a.id))
      .slice(0, RUN_INDEX_LIMIT);

    this.write(DATA_FILES.runIndex, { updatedAt: report.finishedAt, runs });
  }
}
