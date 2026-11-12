// Margin blobs: a new request finds empty space without disturbing the others; blobs can be dragged (or moved by keyboard), overlap freely,
// the one chosen goes in front and the ones behind get linearly darker; positions survive a reload; Home puts a blob back.
// Synthetic note, no provider. Run: BATCH2A_OUTPUT=<dir outside the repo> node check/blobs.mjs   (after `vite build`)
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { Store } from '../server/store.ts';
import { NoteWatcher } from '../server/watch.ts';
import { createApp } from '../server/http.ts';
import { InkStore } from '../server/ink-store.ts';
import { captureAnchor } from '../shared/anchors.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(process.env.BATCH2A_OUTPUT ?? '');
assert(process.env.BATCH2A_OUTPUT && !out.toLowerCase().startsWith(path.resolve(here, '..', '..').toLowerCase()), 'Output must be outside repo');
const root = await mkdtemp(path.join(os.tmpdir(), 'aitiarch-blobs-'));
const para = n => `Paragraph ${n}: a short plain paragraph of the fixture note.`;
const paras = Array.from({ length: 9 }, (_, i) => para(i + 1));
const note = '# Fixture\n\n' + paras.join('\n\n') + '\n';
await writeFile(path.join(root, 'fixture.md'), note);
const ink = await InkStore.open(root), s = await ink.read('fixture.md');
const body = 'A seeded AI thought with enough words to make its blob a decent height, so the margin has real neighbours to avoid. '.repeat(2);
for (let i = 1; i <= 4; i++) {
  const from = note.indexOf(paras[i - 1]), to = from + 30, anchor = captureAnchor(note, from, to);
  s.document.items.push({ id: 'seed' + i, kind: 'answer', body, anchor, originalAnchor: anchor, attachment: { status: 'attached', from, to },
    generation: { requestId: 'seed' + i, action: 'think', provider: 'claude', model: null, createdAt: new Date().toISOString(), status: 'complete', evidence: [], dismissed: false } });
}
await ink.write('fixture.md', s.document, s.version);
const store = await Store.open(root), watcher = new NoteWatcher(store);
const app = createApp({ store, watcher, distDir: path.join(here, '../dist'), provider: { checkAvailability: async () => ({ available: true }), invoke: async () => new Promise(() => {}) } });
let browser;
try {
  const url = `http://127.0.0.1:${await app.listen(0)}/?debug=1`;
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  await page.goto(url); await page.waitForSelector('.cm-editor'); await page.locator('.margin-card.thought-blob').first().waitFor();
  await page.waitForTimeout(500);
  const rects = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.margin-card.thought-blob')].map(b => {
    const r = b.getBoundingClientRect(), cs = getComputedStyle(b);
    return [b.dataset.inkId, { left: r.left, top: r.top, right: r.right, bottom: r.bottom, z: Number(cs.zIndex) || 0, filter: cs.filter, depth: b.dataset.depth ?? null, moved: b.dataset.moved ?? null }];
  })));
  const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  const near = (a, b, msg, tol = 2) => assert(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

  // 1. A new request finds empty space and moves nobody.
  const before = await rects();
  await page.evaluate(q => { const { view } = window.__aitiarch['fixture.md'], from = view.state.doc.toString().indexOf(q);
    view.dispatch({ selection: { anchor: from, head: from + q.length } }); view.focus(); }, paras[2]);
  await page.getByRole('button', { name: 'Think on this', exact: true }).click();
  await page.getByRole('button', { name: 'Send to Claude', exact: true }).waitFor(); await page.waitForTimeout(700);
  const withDraft = await rects(), draftId = Object.keys(withDraft).find(id => !id.startsWith('seed'));
  assert(draftId, 'the draft blob is there');
  for (const id of Object.keys(before)) { near(withDraft[id].top, before[id].top, `${id} did not move when the request appeared`); near(withDraft[id].left, before[id].left, `${id} did not move sideways`); }
  for (const id of Object.keys(before)) assert(!hit(withDraft[draftId], withDraft[id]), `the new request does not sit on ${id}`);
  await page.screenshot({ path: path.join(out, 'blobs-1-fresh.png') });
  await page.getByRole('button', { name: 'Cancel preview', exact: true }).click(); await page.waitForTimeout(400);

  // 2. Drag blobs on top of each other: the one dragged goes in front, the ones behind darken linearly.
  const grip = id => page.locator(`.margin-card[data-ink-id="${id}"] .thought-grip`);
  const drag = async (id, toRect) => {
    // Grab the grip by its lowest edge: another blob may already cover the top of it, as a person would see.
    const g = await grip(id).boundingBox(), gx = g.x + g.width / 2, gy = g.y + g.height - 3;
    await page.mouse.move(gx, gy); await page.mouse.down();
    const cur = (await rects())[id];
    await page.mouse.move(gx + (toRect.left + 24 - cur.left), gy + (toRect.top + 24 - cur.top), { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(300);
  };
  const r0 = await rects(), ids = Object.keys(r0).filter(id => id.startsWith('seed'));
  const [a, b, c] = ids;
  await drag(b, r0[a]); let r = await rects();
  assert(hit(r[a], r[b]), 'the dragged blob now overlaps the other, by choice');
  assert(r[b].z > r[a].z, 'the dragged blob is in front');
  assert.equal(r[b].moved, 'true', 'a placed blob is marked as placed');
  assert.equal(r[a].depth, '1', 'one blob over it: depth 1'); assert.equal(r[b].depth, '0', 'the front blob is not darkened');
  assert(r[a].filter.includes('brightness(0.84)'), `depth 1 is 16% darker: ${r[a].filter}`); assert(!r[b].filter.includes('brightness'), 'the front blob is not darkened');
  await drag(c, r[a]); r = await rects();
  assert(hit(r[a], r[c]) && r[c].z > r[b].z, `a third blob goes in front of both: ${JSON.stringify({ a: r[a], b: r[b], c: r[c] })}`);
  assert.equal(r[a].depth, '2', 'two blobs over it: depth 2'); assert(r[a].filter.includes('brightness(0.68)'), `depth 2 is linearly darker: ${r[a].filter}`);
  await page.screenshot({ path: path.join(out, 'blobs-2-layers.png') });

  // 3. Positions and layers survive a reload.
  const placed = await rects(), stored = await page.evaluate(() => localStorage.getItem('aitiarch.blobs:fixture.md'));
  await page.reload(); await page.waitForSelector('.cm-editor'); await page.locator('.margin-card.thought-blob').first().waitFor(); await page.waitForTimeout(700);
  const after = await rects(), storedAfter = await page.evaluate(() => localStorage.getItem('aitiarch.blobs:fixture.md'));
  const why = JSON.stringify({ stored, storedAfter, placed: placed[b], after: after[b] });
  // The page may sit a little differently after a reload (a notice above the editor), so compare with a blob that was never moved:
  // a placed blob keeps its place relative to its own sentence, and so to its untouched neighbour.
  for (const id of [b, c]) { near(after[id].left, placed[id].left, `${id} stays where it was put (left) ${why}`, 3); near(after[id].top - after[a].top, placed[id].top - placed[a].top, `${id} stays where it was put (top) ${why}`, 3); assert.equal(after[id].moved, 'true'); }
  assert(after[c].z > after[b].z, 'the stacking order is kept');

  // 4. The keyboard can move a blob, and Home puts it back.
  const startTop = (await rects())[c].top;
  await grip(c).focus(); await page.keyboard.press('ArrowDown'); await page.waitForTimeout(250);
  near((await rects())[c].top, startTop + 8, 'ArrowDown moves it 8px');
  await page.keyboard.press('Home'); await page.waitForTimeout(400);
  assert.equal((await rects())[c].moved, null, 'Home puts it back in automatic placement');
  await page.screenshot({ path: path.join(out, 'blobs-3-after.png') });
  console.log(JSON.stringify({ passed: true }, null, 1));
} finally { await browser?.close(); await app.close(); await rm(root, { recursive: true, force: true }); }
