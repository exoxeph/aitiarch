// Resolve: optional `resolvedAt` on the thread, human-only resolve/unresolve actions, ledger events, old files unchanged.
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { InkStore } from '../server/ink-store.ts';
import { ThreadStore } from '../server/thread-store.ts';
import { UiStateStore } from '../server/ui-state-store.ts';
import { LedgerStore } from '../server/ledger-store.ts';
import { captureAnchor } from '../shared/anchors.ts';
import { serializeInk, validateDocument } from '../shared/ink.ts';
import { newThread, threadStatus, validateThread } from '../shared/threads.ts';

const roots: string[] = [];
afterEach(async () => { for (const r of roots.splice(0)) await rm(r, { recursive: true, force: true }); });
const text = 'Selected synthetic paragraph.\n';
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aitiarch-resolve-')); roots.push(root);
  execFileSync('git', ['init', '-q'], { cwd: root, stdio: 'pipe' });
  await writeFile(path.join(root, '.gitignore'), '/ui-state.json*\n/.cache/\n'); await writeFile(path.join(root, 'fixture.md'), text);
  const ink = await InkStore.open(root), s = await ink.read('fixture.md'), anchor = captureAnchor(text, 0, text.length - 1);
  const gen = (id: string) => ({ requestId: id, action: 'think' as const, provider: 'claude' as const, model: null, createdAt: new Date().toISOString(), status: 'complete' as const, evidence: [], dismissed: false });
  s.document.items.push({ id: 't1', kind: 'answer', body: 'Initial synthetic answer.', anchor, originalAnchor: anchor, attachment: { status: 'attached', ...anchor.position }, generation: gen('t1') });
  s.document.items.push({ id: 't2', kind: 'answer', body: 'Another synthetic answer.', anchor, originalAnchor: anchor, attachment: { status: 'attached', ...anchor.position }, generation: gen('t2') });
  await ink.write('fixture.md', s.document, null);
  const ledger = new LedgerStore(root), threads = new ThreadStore(ink, new UiStateStore(root), ledger);
  const get = () => ink.read('fixture.md'), act = async (id: string, action: any) => threads.act('fixture.md', id, (await get()).version, action);
  return { root, ink, threads, ledger, get, act, file: path.join(root, 'ink/fixture.ink.json') };
}

it('resolve round-trips: stored as resolvedAt, validated, reopened by unresolve, and the key is gone again', async () => {
  const f = await fixture();
  await f.act('t1', { type: 'resolve' });
  let item = (await f.get()).document.items[0];
  expect(typeof item.thread?.resolvedAt).toBe('string');
  expect(Number.isFinite(Date.parse(item.thread!.resolvedAt!))).toBe(true);
  validateDocument((await f.get()).document, 'fixture.md');
  expect(threadStatus(item)).toBe('resolved');
  const first = item.thread!.resolvedAt;
  await f.act('t1', { type: 'resolve' }); // idempotent: the first time stays
  expect((await f.get()).document.items[0].thread?.resolvedAt).toBe(first);
  await f.act('t1', { type: 'unresolve' });
  item = (await f.get()).document.items[0];
  expect('resolvedAt' in item.thread!).toBe(false);
  expect(threadStatus(item)).toBe('open');
});

it('resolving is not a takeaway or a Skip: it unlocks nothing and changes no takeaway state', async () => {
  const f = await fixture();
  await f.act('t1', { type: 'resolve' });
  const i = (await f.get()).document.items[0];
  expect(i.thread?.takeaway).toMatchObject({ state: 'untouched', text: null, events: [] });
  expect(i.thread?.summary.revealedAt).toBeNull();
  expect(f.threads.canSummarize(i)).toBe(false);
  expect(i.thread?.dismissed).toBe(false);
});

it('old files without the field load unchanged, and resolving one thought leaves the other sidecar content identical', async () => {
  const f = await fixture();
  const before = await readFile(f.file);
  expect((await f.threads.read('fixture.md')).document.items[0].thread).not.toHaveProperty('resolvedAt');
  expect(await readFile(f.file)).toEqual(before); // reading never rewrites
  await f.act('t1', { type: 'open' });
  const t2Before = JSON.stringify((await f.get()).document.items[1]);
  await f.act('t1', { type: 'resolve' });
  expect(JSON.stringify((await f.get()).document.items[1])).toBe(t2Before);
  const doc = (await f.get()).document;
  expect(await readFile(f.file, 'utf8')).toBe(serializeInk(doc));
  const legacy = newThread(doc.items[0]);
  expect(() => validateThread(legacy, 't1')).not.toThrow();
  expect(Object.keys(legacy)).not.toContain('resolvedAt');
});

it('the validator accepts a valid resolvedAt and rejects a bad one or any other extra key', async () => {
  const f = await fixture();
  const t = newThread((await f.get()).document.items[0]);
  expect(() => validateThread({ ...t, resolvedAt: new Date().toISOString() }, 't1')).not.toThrow();
  expect(() => validateThread({ ...t, resolvedAt: 'not a time' }, 't1')).toThrow();
  expect(() => validateThread({ ...t, resolvedAt: 5 as any }, 't1')).toThrow();
  expect(() => validateThread({ ...t, resolved: true } as any, 't1')).toThrow();
});

it('resolve and reopen are recorded in the ledger like dismiss, once per accepted response', async () => {
  const f = await fixture();
  await f.act('t1', { type: 'resolve' });
  await f.act('t1', { type: 'unresolve' });
  await f.act('t2', { type: 'dismiss' });
  const events = (await f.ledger.read()).events;
  expect(events.filter((e) => e.event === 'resolved').map((e) => e.inkId)).toEqual(['t1']);
  expect(events.filter((e) => e.event === 'reopened').map((e) => e.inkId)).toEqual(['t1']);
  expect(events.filter((e) => e.event === 'dismissed').map((e) => e.inkId)).toEqual(['t2']);
  await f.act('t1', { type: 'resolve' }); // a second cycle does not duplicate the same response's event
  expect((await f.ledger.read()).events.filter((e) => e.event === 'resolved')).toHaveLength(1);
});

it('only the two known resolve actions are accepted, and a stale version is refused', async () => {
  const f = await fixture();
  await expect(f.act('t1', { type: 'resolve', extra: 1 })).rejects.toThrow();
  await expect(f.act('t1', { type: 'reopen-thought' })).rejects.toThrow();
  await expect(f.threads.act('fixture.md', 't1', 'stale-version', { type: 'resolve' })).rejects.toThrow();
});
