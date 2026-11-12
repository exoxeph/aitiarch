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
  // A person grabs a part of the grip that they can see: another blob in front may cover some of it.
  const visibleGrip = id => page.evaluate(i => { const g = document.querySelector(`.margin-card[data-ink-id="${i}"] .thought-grip`), r = g.getBoundingClientRect();
    for (let y = r.bottom - 3; y > r.top + 2; y -= 3) for (let x = r.left + r.width / 2; x < r.right - 2; x += 4) if (document.elementFromPoint(x, y)?.closest('.thought-grip') === g) return { x, y }; return null; }, id);
  const drag = async (id, toRect) => {
    const pt = await visibleGrip(id); assert(pt, `part of the grip of ${id} can be reached`);
    const gx = pt.x, gy = pt.y;
    await page.mouse.move(gx, gy); await page.mouse.down();
    const cur = (await rects())[id];
    await page.mouse.move(gx + (toRect.left + 24 - cur.left), gy + (toRect.top + 24 - cur.top), { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(300);
  };
  const r0 = await rects(), ids = Object.keys(r0).filter(id => id.startsWith('seed'));
  const [a, b] = ids;
  await drag(b, r0[a]); let r = await rects();
  let c = null; for (const id of ids.filter(i => i !== a && i !== b)) if (await visibleGrip(id)) { c = id; break; }
  assert(c, 'another blob has a grip that can be reached');
  assert(hit(r[a], r[b]), 'the dragged blob now overlaps the other, by choice');
  assert(r[b].z > r[a].z, 'the dragged blob is in front');
  assert.equal(r[b].moved, 'true', 'a placed blob is marked as placed');
  assert.equal(r[a].depth, '1', 'one blob over it: depth 1'); assert.equal(r[b].depth, '0', 'the front blob is not darkened');
  assert(r[a].filter.includes('brightness(0.78)'), `depth 1 is 22% darker: ${r[a].filter}`); assert(!r[b].filter.includes('brightness'), 'the front blob is not darkened');
  await drag(c, r[a]); r = await rects();
  assert(hit(r[a], r[c]) && r[c].z > r[b].z, `a third blob goes in front of both: ${JSON.stringify({ a: r[a], b: r[b], c: r[c] })}`);
  assert.equal(r[a].depth, '2', 'two blobs over it: depth 2'); assert(r[a].filter.includes('brightness(0.56)'), `depth 2 is linearly darker: ${r[a].filter}`);
  // A stack reads as cards at different heights, not as one smear: each has an edge and casts a shadow, the front surface is the lightest and
  // each one behind is darker, and the ones behind sit a little smaller. A blob on its own stays quiet.
  const card = id => page.evaluate(i => { const el = document.querySelector(`.margin-card[data-ink-id="${i}"]`), cs = getComputedStyle(el), m = cs.backgroundColor.match(/[\d.]+/g).map(Number);
    return { stacked: el.dataset.stacked ?? null, shadow: cs.boxShadow, bg: m[0] + m[1] + m[2], scale: cs.scale }; }, id);
  const [ka, kb, kc] = [await card(a), await card(b), await card(c)];
  for (const k of [ka, kb, kc]) { assert.equal(k.stacked, 'true', 'blobs in a stack are drawn as cards'); assert.notEqual(k.shadow, 'none', 'a card in a stack casts a shadow'); }
  assert(kc.bg > kb.bg && kb.bg > ka.bg, `lighter in front, darker behind: front ${kc.bg}, middle ${kb.bg}, back ${ka.bg}`);
  assert(Number(ka.scale) < Number(kb.scale === 'none' ? 1 : kb.scale) && (kc.scale === 'none' || Number(kc.scale) === 1), `the back card sits a little smaller: ${ka.scale} / ${kb.scale} / ${kc.scale}`);
  const now = await rects(), alone = Object.keys(now).find(id => Object.keys(now).every(o => o === id || !hit(now[id], now[o])));
  if (alone) { const k = await card(alone); assert.equal(k.stacked, null, 'a blob on its own is not a card'); assert.equal(k.shadow, 'none', 'and stays quiet'); }
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

  // 4. The grip is big and centred and shows a border when hovered; a hovered blob lifts like a card, even one behind others, and the layers do not change.
  const gripGeo = id => page.evaluate(i => { const bl = document.querySelector(`.margin-card[data-ink-id="${i}"]`), g = bl.querySelector('.thought-grip'), br = bl.getBoundingClientRect(), gr = g.getBoundingClientRect();
    return { dx: gr.left + gr.width / 2 - (br.left + br.width / 2), w: gr.width, h: gr.height }; }, id);
  const gm = await gripGeo(b);
  assert(Math.abs(gm.dx) <= 2, `the grip is centred on the blob (off by ${gm.dx})`); assert(gm.w >= 48 && gm.h >= 14, `the grip is a comfortable size (${gm.w}x${gm.h})`);
  const css = (id, sel, props) => page.evaluate(([i, s, p]) => { const el = document.querySelector(`.margin-card[data-ink-id="${i}"]${s}`), cs = getComputedStyle(el); return Object.fromEntries(p.map(k => [k, cs[k]])); }, [id, sel, props]);
  await page.mouse.move(5, 5); await page.waitForTimeout(300);
  const rest = await css(a, '', ['boxShadow', 'borderRadius', 'zIndex', 'filter', 'translate']);
  // Find a spot on blob a (which is behind two others) that is not covered, and hover there.
  const spot = await page.evaluate(i => { const bl = document.querySelector(`.margin-card[data-ink-id="${i}"]`), r = bl.getBoundingClientRect();
    for (let y = r.top + 3; y < r.bottom - 4; y += 3) for (let x = r.left + 12; x < r.right - 12; x += 12) if (document.elementFromPoint(x, y)?.closest('.margin-card')?.dataset.inkId === i) return { x, y }; return null; }, a);
  assert(spot, 'part of the blob behind the others can be reached');
  await page.mouse.move(spot.x, spot.y); await page.waitForTimeout(400);
  const lifted = await css(a, '', ['boxShadow', 'borderRadius', 'zIndex', 'filter', 'translate']);
  assert.notEqual(lifted.boxShadow, rest.boxShadow, 'a hovered blob lifts further like a card (deeper shadow)'); assert.equal(lifted.translate, 'none', 'but it never moves, so it cannot slip out from under the pointer');
  assert.notEqual(lifted.borderRadius, '0px', 'a hovered blob has card corners');
  assert.equal(lifted.zIndex, rest.zIndex, 'hovering does not change the layers'); assert.equal(lifted.filter, rest.filter, 'hovering a blob behind others does not undo its darkening');
  await grip(c).hover(); await page.waitForTimeout(300);
  const gb = await css(c, ' .thought-grip', ['borderBottomWidth', 'borderBottomColor']);
  assert.notEqual(gb.borderBottomColor, 'rgba(0, 0, 0, 0)', 'hovering the grip shows a border'); assert.equal(gb.borderBottomWidth, '1px');
  await page.mouse.move(5, 5);
  await page.screenshot({ path: path.join(out, 'blobs-4-hover.png') });

  // 5. The keyboard can move a blob, and Home puts it back.
  const startTop = (await rects())[c].top;
  await grip(c).focus(); await page.keyboard.press('ArrowDown'); await page.waitForTimeout(250);
  near((await rects())[c].top, startTop + 8, 'ArrowDown moves it 8px');
  await page.keyboard.press('Home'); await page.waitForTimeout(400);
  assert.equal((await rects())[c].moved, null, 'Home puts it back in automatic placement');
  await page.screenshot({ path: path.join(out, 'blobs-3-after.png') });
  console.log(JSON.stringify({ passed: true }, null, 1));
} finally { await browser?.close(); await app.close(); await rm(root, { recursive: true, force: true }); }
