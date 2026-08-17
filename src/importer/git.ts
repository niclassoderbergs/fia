// Git-delen av importen: commit av data/ och push till GitHub.
//
// Push:en är samtidigt deploy — Vercel bygger om vid varje push till main, så
// när kommandot returnerat är kollegans vy på väg att uppdateras.
//
// Notera att pushen kan misslyckas utan att körningen gör det: datat ligger då
// kvar committat lokalt och följer med nästa dygns push. Vi förlorar inget.

import { execFileSync } from 'node:child_process';

export interface GitConfig {
  cwd: string;
  remote: string;
  branch: string;
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

/** Finns det något ospårat/ändrat under data/? */
export function hasDataChanges(cwd: string): boolean {
  return git(cwd, ['status', '--porcelain', '--', 'data']).length > 0;
}

/** Stagar och committar allt under data/. Returnerar commit-sha, eller null om inget fanns. */
export function commitData(cwd: string, message: string): string | null {
  if (!hasDataChanges(cwd)) return null;
  git(cwd, ['add', '--', 'data']);
  git(cwd, ['commit', '-m', message]);
  return git(cwd, ['rev-parse', 'HEAD']);
}

export function push(config: GitConfig): void {
  git(config.cwd, ['push', config.remote, `HEAD:${config.branch}`]);
}

/**
 * Commit-meddelande i projektets format: `type(scope): beskrivning`, svensk
 * text, rubrikblock i body, ingen robot-footer.
 */
export function buildCommitMessage(input: {
  dateLabel: string;
  status: string;
  lines: string[];
}): string {
  const headline =
    input.lines.length > 0
      ? input.lines.join(', ')
      : 'inga förändringar';
  const subject = `chore(data): eSett-import ${input.dateLabel} — ${headline}`;

  const body = [
    '',
    `Status: ${input.status}`,
    '',
    'Förändringar:',
    ...(input.lines.length > 0
      ? input.lines.map((l) => `- ${l}`)
      : ['- inga (bara körningsrapport)']),
  ];

  return [subject, ...body].join('\n');
}
