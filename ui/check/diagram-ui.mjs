// Browser check for the diagram UI: Visualize (toolbar and palette), repair of a near-miss spec, the reason text and
// "Try diagram again", one-callout insertion, the image in the editor, one undo. Fake provider only; synthetic note.
// Run after `vite build`: BATCH2A_OUTPUT=<folder outside the repo> node check/diagram-ui.mjs
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { Store } from '../server/store.ts';
import { NoteWatcher } from '../server/watch.ts';
import { createApp } from '../server/http.ts';
import { VISUALIZE_QUESTION } from '../shared/diagram.ts';
import { cicd } from '../test/fixtures/diagrams.ts';

const out = path.resolve(process.env.BATCH2A_OUTPUT ?? '');
assert(process.env.BATCH2A_OUTPUT && !out.toLowerCase().startsWith(path.resolve('..').toLowerCase()), 'Output must be outside the repo');
const root = await mkdtemp(path.join(os.tmpdir(), 'aitiarch-diagram-ui-'));
execFileSync('git', ['init', '-q'], { cwd: root });
await writeFile(path.join(root, '.gitignore'), '/.cache/\n/ui-state.json*\n');
const text = '# Invented release\n\nThe app builds once, runs tests and security checks in parallel, then releases only if both pass.\n\nEnd of synthetic note.\n';
const bytes = Buffer.from('﻿' + text.replace(/\n/g, '\r\n'));
await writeFile(path.join(root, 'fixture.md'), bytes);
const store = await Store.open(root), watcher = new NoteWatcher(store, 60, 10);
await watcher.start();
const calls = [];
// A near miss: unknown fields, an arrow and an over-long label. The repair step should make it drawable.
const nearMiss = { ...cicd, direction: 'LR', svg: '<svg/>', nodes: cicd.nodes.map((n, i) => (i === 0 ? { ...n, label: 'Code change -> build ' + 'x'.repeat(70) } : n)) };
const provider = { name: 'claude', checkAvailability: async () => ({ available: true }),
  invoke: async (r) => { calls.push({ question: r.question, selection: r.selection });
    const diagram = r.question === VISUALIZE_QUESTION ? nearMiss : r.question === 'Break it' ? { ...cicd, nodes: [], edges: [], focus: [] } : undefined;
    return { id: r.id, provider: 'claude', model: null, answer: 'Synthetic text answer for a fixture.', claims: [{ sourceId: 'N1', quote: 'The app builds once' }], usage: null, ...(diagram ? { diagram } : {}) }; } };
const app = createApp({ store, watcher, distDir: path.resolve('dist'), provider });
let browser; const errors = [], report = {};
try {
  const base = 'http://127.0.0.1:' + await app.listen(0);
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1900, height: 1000 } });
  page.setDefaultTimeout(15000);
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + '/?debug'); await page.waitForFunction(() => window.__aitiarch?.['fixture.md']);
  const V = "window.__aitiarch['fixture.md'].view";
  const select = (a, b) => page.evaluate(([a, b]) => { const v = window.__aitiarch['fixture.md'].view; v.dispatch({ selection: { anchor: a, head: b } }); v.focus(); }, [a, b]);
  const from = text.indexOf('The app'), to = text.indexOf('\n\nEnd');

  // 1. The toolbar has Visualize beside Think and Ask, in one row.
  await select(from, to);
  const toolbar = page.locator('.cm-sel-toolbar'); await toolbar.waitFor();
  const boxes = await Promise.all(['Think on this', 'Ask...', 'Visualize'].map((n) => toolbar.getByRole('button', { name: n }).boundingBox()));
  assert(boxes.every(Boolean), 'Think, Ask and Visualize must all be visible');
  assert(boxes.every((b) => Math.abs(b.y - boxes[0].y) < 3), 'Think, Ask and Visualize must share a row');
  report.toolbarRow = boxes.map((b) => Math.round(b.x));
  await toolbar.screenshot({ path: path.join(out, 'toolbar-visualize.png') });

  // 2. Visualize opens the normal review panel (no call yet), then Send makes the one call.
  await toolbar.getByRole('button', { name: 'Visualize' }).click();
  const review = page.locator('.invocation-review'); await review.waitFor();
  assert.equal(await review.locator('strong').first().textContent(), 'Visualize');
  assert.equal(calls.length, 0, 'no provider call before Send');
  await review.getByRole('button', { name: /^Send to/ }).click();
  const blob = page.locator('.margin-card.thought-blob').first();
  await blob.locator('svg').waitFor();
  assert.equal(calls.length, 1); assert.equal(calls[0].question, VISUALIZE_QUESTION);
  assert.equal(await page.locator('[data-diagram-issue]').count(), 0, 'the near-miss spec was repaired, not rejected');
  await page.waitForTimeout(400); report.firstLabel = await blob.locator('svg text').first().textContent();
  report.blobText = await blob.locator('svg').evaluate((svg) => { const s = svg.getBoundingClientRect().width / svg.viewBox.baseVal.width; return Math.round(Math.min(...[...svg.querySelectorAll('text')].map((t) => parseFloat(t.getAttribute('font-size') || '14') * s)) * 10) / 10; });
  assert(report.blobText >= 12, 'blob text under 12px: ' + report.blobText);
  await page.screenshot({ path: path.join(out, 'blob-diagram-light.png') });

  // 3. The command palette has Visualize too (and only previews).
  await select(from, to);
  await page.keyboard.press('Control+k'); await page.waitForTimeout(200);
  await page.keyboard.type('Visualize'); await page.waitForTimeout(200); await page.keyboard.press('Enter');
  await page.locator('.invocation-review').waitFor(); assert.equal(await page.locator('.invocation-review strong').first().textContent(), 'Visualize');
  assert.equal(calls.length, 1, 'palette Visualize must not call the provider by itself');
  await page.getByRole('button', { name: 'Cancel preview' }).click();

  // 4. An unusable diagram says why and offers a user-triggered retry that only opens a review.
  await page.evaluate(async ({ text, from, to }) => { const r = await fetch('/api/assistance/invoke', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Aitiarch': '1' }, body: JSON.stringify({ id: 'broken-1', path: 'fixture.md', action: 'ask', question: 'Break it', text, from, to }) }); if (r.status !== 202) throw new Error('invoke failed'); }, { text, from, to });
  await page.waitForFunction(async () => (await (await fetch('/api/assistance/status?id=broken-1')).json()).status === 'complete');
  await page.reload(); await page.waitForFunction(() => window.__aitiarch?.['fixture.md']);
  const issue = page.locator('[data-diagram-issue]').first(); await issue.waitFor();
  const shown = await issue.textContent(); report.reason = shown;
  assert.match(shown, /Diagram unavailable: it has no nodes to draw\. The text answer is preserved\./);
  await page.screenshot({ path: path.join(out, 'diagram-unavailable-light.png') });
  const before = calls.length;
  await page.getByRole('button', { name: 'Try diagram again' }).first().click();
  await page.locator('.invocation-review').waitFor();
  assert.equal(await page.locator('.invocation-review strong').first().textContent(), 'Visualize');
  assert.equal(calls.length, before, 'Try diagram again must not call the provider until Send');
  await page.getByRole('button', { name: 'Cancel preview' }).click();

  // 5. Bring the repaired diagram to the notebook: one AI callout, text first, image below, one undo.
  const good = page.locator('.margin-card.thought-blob').filter({ has: page.locator('svg') }).first(); await good.locator('svg').waitFor();
  await good.getByRole('button', { name: 'Bring to notebook', exact: true }).click();
  const preview = page.getByRole('dialog', { name: 'Review AI block insertion' }); await preview.waitFor();
  const insert = await preview.locator('pre').textContent();
  assert.match(insert, /> \[!ai\]\n> Synthetic text answer for a fixture\.\n> !\[AI diagram: /); assert.equal((insert.match(/\[!ai\]/g) || []).length, 1);
  await preview.getByRole('button', { name: 'Insert AI diagram image', exact: true }).click();
  await page.waitForFunction(() => window.__aitiarch['fixture.md'].view.state.doc.toString().includes('[!ai]'));
  await page.waitForFunction(() => window.__aitiarch['fixture.md'].session.status === 'saved');
  await page.waitForTimeout(400);
  const after = await readFile(path.join(root, 'fixture.md')); assert(after.subarray(0, 3).equals(bytes.subarray(0, 3)), 'BOM kept');
  const assets = await readdir(path.join(root, 'assets')); assert.equal(assets.length, 1);
  const svg = await readFile(path.join(root, 'assets', assets[0]), 'utf8'); assert(svg.includes('prefers-color-scheme'), 'exported SVG adapts to light and dark pages');

  // 6. The image draws in the editor; the raw text shows only when the caret is on its line; bytes never change.
  await select(0, 0);
  const img = page.locator('.cm-image img'); await img.waitFor();
  await page.waitForFunction(() => { const i = document.querySelector('.cm-image img'); return i && i.complete && i.naturalWidth > 0; });
  assert.equal(await page.locator('.cm-image figcaption').first().textContent(), 'AI diagram: ' + cicd.title);
  assert(!(await page.locator('.cm-content').innerText()).includes('!['), 'raw image text visible while the caret is elsewhere');
  const docBefore = await page.evaluate(`${V}.state.doc.toString()`);
  const box = await page.locator('.cm-image').first().boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2); await page.waitForTimeout(150);
  assert(!(await page.locator('.cm-content').innerText()).includes('!['), 'a mouse click on the image must not reveal the source');
  await page.evaluate(() => { const v = window.__aitiarch['fixture.md'].view; const t = v.state.doc.toString(); v.dispatch({ selection: { anchor: t.indexOf('![AI diagram') + 3 } }); v.focus(); });
  await page.waitForTimeout(120);
  assert((await page.locator('.cm-content').innerText()).includes('![AI diagram'), 'keyboard caret on the line reveals the source');
  assert.equal(await page.evaluate(`${V}.state.doc.toString()`), docBefore, 'rendering changed the document');
  await page.evaluate(() => { const v = window.__aitiarch['fixture.md'].view; v.dispatch({ selection: { anchor: 0 } }); });
  await page.locator('.cm-image img').waitFor();
  await page.screenshot({ path: path.join(out, 'editor-callout-image-light.png') });
  await page.emulateMedia({ colorScheme: 'dark' }); await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(out, 'editor-callout-image-dark.png') });
  await page.locator('.margin-card.thought-blob svg').first().waitFor();
  await page.screenshot({ path: path.join(out, 'blob-diagram-dark.png') });
  await page.emulateMedia({ colorScheme: 'light' });

  // 7. One Ctrl+Z removes the whole insertion (callout and image together).
  await page.evaluate(() => window.__aitiarch['fixture.md'].view.focus());
  await page.keyboard.press('Control+z'); await page.waitForTimeout(150);
  assert.equal(await page.evaluate(`${V}.state.doc.toString()`), text, 'one undo must remove the whole callout and image');
  await page.evaluate(() => window.__aitiarch['fixture.md'].session.flush());
  assert.deepEqual(await readFile(path.join(root, 'fixture.md')), bytes, 'bytes after undo');
  console.log(JSON.stringify({ pass: true, calls: calls.length, report, errors }, null, 1));
  assert.deepEqual(errors, []);
} finally { await browser?.close(); await app.close?.(); await watcher.stop?.(); await rm(root, { recursive: true, force: true }); }
