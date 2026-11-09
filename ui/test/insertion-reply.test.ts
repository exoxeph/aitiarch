// Add to note can target one specific AI message (a reply), and the insert stays byte-exact on a BOM + CRLF note.
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { history, undo } from '@codemirror/commands';
import { InsertionStore } from '../server/insertion-store.ts';
import { Store } from '../server/store.ts';
import { InkStore } from '../server/ink-store.ts';
import { LedgerStore } from '../server/ledger-store.ts';
import { captureAnchor } from '../shared/anchors.ts';
import { decode, encode } from '../server/codec.ts';
import { newThread } from '../shared/threads.ts';

const roots: string[] = [];
afterEach(async () => { for (const r of roots.splice(0)) await rm(r, { recursive: true, force: true }); });
const gen = (id: string) => ({ requestId: id, action: 'ask' as const, provider: 'claude' as const, model: null, status: 'complete' as const, createdAt: '2026-11-09T00:00:00Z', evidence: [], dismissed: false });

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aitiarch-reply-')); roots.push(root);
  const bytes = Buffer.from('﻿# Invented\r\n\r\nReview the release.\r\n\r\nTail.  \r\n');
  await writeFile(path.join(root, 'fixture.md'), bytes);
  const ink = await InkStore.open(root), s = await ink.read('fixture.md'), note = decode(bytes);
  const from = note.text.indexOf('Review'), anchor = captureAnchor(note.text, from, from + 19);
  const item: any = { id: 'q1', kind: 'answer', body: 'First answer.', anchor, originalAnchor: anchor, attachment: { status: 'attached', ...anchor.position }, generation: gen('q1') };
  const thread = newThread(item);
  thread.followups.push({ id: 'r1', parentId: 'q1', body: 'Second message, picked on purpose.', generation: gen('r1') });
  item.thread = thread;
  s.document.items.push(item);
  await ink.write('fixture.md', s.document, null);
  const store = await Store.open(root), ledger = new LedgerStore(root), insertions = new InsertionStore(ink, store, ledger);
  return { bytes, note, store, insertions, input: { path: 'fixture.md', id: 'q1', noteVersion: note.version } };
}

it('without a reply id the first answer is added; with one, exactly that message is added, as one AI callout', async () => {
  const f = await fixture();
  const first = await f.insertions.preview(f.input);
  expect(first.changes.insert).toContain('> [!ai]');
  expect(first.changes.insert).toContain('First answer.');
  expect(first.changes.insert).not.toContain('Second message');
  const picked = await f.insertions.preview({ ...f.input, replyId: 'r1' });
  expect(picked.changes.insert).toContain('Second message, picked on purpose.');
  expect(picked.changes.insert).not.toContain('First answer.');
  expect(picked.changes.insert.match(/\[!ai\]/g)).toHaveLength(1);
  expect(picked.authorship).toBe('ai');
  expect(picked.insertedBy).toBe('human');
});

it('an unknown reply id is refused and nothing is written', async () => {
  const f = await fixture();
  await expect(f.insertions.preview({ ...f.input, replyId: 'nope' })).rejects.toThrow(/reply was not found/);
});

it('adding a specific reply then one undo restores the exact bytes (BOM and CRLF kept)', async () => {
  const f = await fixture();
  const p = await f.insertions.preview({ ...f.input, replyId: 'r1' });
  let state = EditorState.create({ doc: f.note.text, extensions: [history()] });
  state = state.update({ changes: p.changes }).state;
  const v = { state, dispatch: (tr: any) => { v.state = tr.state; } };
  const edited = encode(v.state.doc.toString(), f.note);
  expect(edited.subarray(0, 3)).toEqual(f.bytes.subarray(0, 3)); // BOM
  expect(edited.toString()).toContain('\r\n> [!ai]\r\n> Second message, picked on purpose.');
  expect(edited.toString().replace(/\r\n/g, '').includes('\n')).toBe(false); // no bare LF slipped in
  expect(undo(v as any)).toBe(true);
  expect(encode(v.state.doc.toString(), f.note)).toEqual(f.bytes);
});
