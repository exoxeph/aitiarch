// "Make it mine": an explicit click records "AI-inserted, later adopted by human" in the ledger; Takeaways are untouched.
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { InsertionStore } from '../server/insertion-store.ts';
import { Store } from '../server/store.ts';
import { InkStore } from '../server/ink-store.ts';
import { LedgerStore } from '../server/ledger-store.ts';
import { captureAnchor } from '../shared/anchors.ts';
import { decode } from '../server/codec.ts';

const roots: string[] = [];
afterEach(async () => { for (const r of roots.splice(0)) await rm(r, { recursive: true, force: true }); });
const gen = (id: string) => ({ requestId: id, action: 'think' as const, provider: 'claude' as const, model: null, status: 'complete' as const, createdAt: '2026-11-09T00:00:00Z', evidence: [], dismissed: false });

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aitiarch-adopt-')); roots.push(root);
  const bytes = Buffer.from('﻿# Invented\r\n\r\nReview the release.\r\n\r\nTail.  \r\n');
  await writeFile(path.join(root, 'fixture.md'), bytes);
  const ink = await InkStore.open(root), s = await ink.read('fixture.md'), note = decode(bytes);
  const from = note.text.indexOf('Review'), anchor = captureAnchor(note.text, from, from + 19);
  s.document.items.push({ id: 'q1', kind: 'answer', body: 'An AI explanation.', anchor, originalAnchor: anchor, attachment: { status: 'attached', ...anchor.position }, generation: gen('q1') });
  await ink.write('fixture.md', s.document, null);
  const store = await Store.open(root), ledger = new LedgerStore(root), insertions = new InsertionStore(ink, store, ledger);
  const input = { path: 'fixture.md', id: 'q1', noteVersion: note.version };
  /** Add the callout to the note on disk the way the app does: preview, prepare, write, complete. */
  const add = async () => {
    const cur = await store.read('fixture.md'), preview = await insertions.preview({ ...input, noteVersion: cur.version });
    const prepared = await insertions.prepare({ ...input, noteVersion: cur.version, preview });
    const next = cur.text.slice(0, preview.changes.from) + preview.changes.insert + cur.text.slice(preview.changes.to);
    expect((await store.write('fixture.md', next, cur.version)).ok).toBe(true);
    await insertions.complete('fixture.md', prepared.operationId);
    return { operationId: prepared.operationId, from: preview.changes.from + 2 };
  };
  return { root, bytes, ledger, insertions, add, store };
}

it('adopting an inserted callout records one "adopted" event tied to the insertion, by the human, after "inserted"', async () => {
  const f = await fixture();
  const { operationId, from } = await f.add();
  const result = await f.insertions.adopt('fixture.md', from);
  expect(result).toEqual({ recorded: true, operationId });
  const events = (await f.ledger.read()).events;
  expect(events.map((e) => e.event)).toEqual(['inserted', 'adopted']);
  expect(events[1]).toMatchObject({ inkId: 'q1', requestId: operationId, note: 'fixture.md', event: 'adopted' });
  expect(Object.keys(events[1]).sort()).toEqual(['at', 'event', 'id', 'inkId', 'note', 'requestId']);
});

it('it is recorded once: a second click, or a note with no AI insertion, records nothing', async () => {
  const f = await fixture();
  expect(await f.insertions.adopt('fixture.md', 0)).toEqual({ recorded: false }); // nothing was ever inserted
  const { from } = await f.add();
  await f.insertions.adopt('fixture.md', from);
  expect(await f.insertions.adopt('fixture.md', from)).toEqual({ recorded: false });
  expect((await f.ledger.read()).events.filter((e) => e.event === 'adopted')).toHaveLength(1);
});

it('with two callouts, the one clicked is paired by position even after its text was edited', async () => {
  const f = await fixture();
  const first = await f.add();
  const second = await f.add();
  // The text is edited by the human, then a callout is adopted: pairing falls back to the nearest insertion.
  const cur = await f.store.read('fixture.md');
  const edited = cur.text.replace('An AI explanation.', 'An AI explanation, reworded by me.');
  expect((await f.store.write('fixture.md', edited, cur.version)).ok).toBe(true);
  const result = await f.insertions.adopt('fixture.md', Math.max(first.from, second.from));
  expect(result.recorded).toBe(true);
  expect([first.operationId, second.operationId]).toContain((result as any).operationId);
  expect((await f.ledger.read()).events.filter((e) => e.event === 'adopted')).toHaveLength(1);
});

it('adopting never touches the note on disk (the editor makes the edit), and refuses a bad position', async () => {
  const f = await fixture();
  const { from } = await f.add();
  const before = await readFile(path.join(f.root, 'fixture.md'));
  await f.insertions.adopt('fixture.md', from);
  expect(await readFile(path.join(f.root, 'fixture.md'))).toEqual(before);
  await expect(f.insertions.adopt('fixture.md', -1)).rejects.toThrow();
  await expect(f.insertions.adopt('fixture.md', NaN)).rejects.toThrow();
});
