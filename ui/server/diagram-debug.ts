// Opt-in local capture of diagram specs that were rejected (or repaired) so a real failure can be studied later.
// Off unless AITIARCH_DEBUG_DIAGRAMS=1. The file can contain text from your notes (labels), so it stays on this machine:
// it lives in ui/.debug-diagrams/, which is git-ignored, and it is capped in size (oldest rows are dropped first).
import { appendFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEBUG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.debug-diagrams');
export const DEBUG_FILE = path.join(DEBUG_DIR, 'diagrams.jsonl');
export const MAX_FILE_BYTES = 256 * 1024;
export const MAX_SPEC_BYTES = 16 * 1024;

export interface DiagramDebugRow {
  kind: 'rejected' | 'repaired';
  /** Fixed validation code and JSON path of the first problem (rejected rows). */
  code?: string;
  path?: string;
  /** What the repair step changed (counts only). */
  notes?: Record<string, unknown>;
  raw: unknown;
}

export const debugEnabled = (env: NodeJS.ProcessEnv = process.env) => env.AITIARCH_DEBUG_DIAGRAMS === '1';

/** Never throws: a debugging aid must not change what the app does. */
export function captureDiagram(row: DiagramDebugRow, file = DEBUG_FILE, env: NodeJS.ProcessEnv = process.env): void {
  if (!debugEnabled(env)) return;
  try {
    let raw = '';
    try { raw = JSON.stringify(row.raw) ?? ''; } catch { raw = '"[unserializable]"'; }
    const truncated = Buffer.byteLength(raw) > MAX_SPEC_BYTES;
    const line = JSON.stringify({ at: new Date().toISOString(), kind: row.kind, code: row.code, path: row.path, notes: row.notes, truncated,
      raw: truncated ? raw.slice(0, MAX_SPEC_BYTES) : row.raw }) + '\n';
    mkdirSync(path.dirname(file), { recursive: true });
    appendFileSync(file, line);
    if (statSync(file).size > MAX_FILE_BYTES) {
      const rows = readFileSync(file, 'utf8').split('\n').filter(Boolean);
      let kept = rows.slice(Math.floor(rows.length / 2)); // drop the older half
      while (kept.length > 1 && Buffer.byteLength(kept.join('\n')) > MAX_FILE_BYTES / 2) kept = kept.slice(1);
      writeFileSync(file, kept.join('\n') + '\n');
    }
  } catch { /* ignore */ }
}
