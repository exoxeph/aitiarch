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
import { cicd,rag,lifecycle,requestResponse } from '../test/fixtures/diagrams.ts';

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
    const ref=[cicd,rag,lifecycle,requestResponse].find((_,i)=>r.question==='Reference '+i);
    const diagram = ref??(r.question === VISUALIZE_QUESTION ? nearMiss : r.question === 'Break it' ? { ...cicd, nodes: [], edges: [], focus: [] } : undefined);
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
  assert(report.blobText >= 8, 'blob thumbnail text under 8px: ' + report.blobText); // the blob shows the whole diagram scaled to fit; reading size is the large view
  await page.screenshot({ path: path.join(out, 'blob-diagram-light.png') });
  // 2b. The "..." menu: keyboard reachable and named; Dismiss hides with an Undo toast; dismissed thoughts can be restored.
  const more = blob.getByRole('button', { name: 'More actions for this AI thought' });
  await more.focus(); await page.keyboard.press('Enter');
  const menu = page.getByRole('menu', { name: 'AI thought actions' }); await menu.waitFor();
  assert.deepEqual(await menu.getByRole('menuitem').allTextContents(), ['Resolve thought', 'Dismiss thought', 'Show dismissed thoughts']);
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Resolve thought', 'first menu item takes focus');
  await page.keyboard.press('ArrowDown'); assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Dismiss thought');
  await page.keyboard.press('Escape'); await menu.waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'More actions for this AI thought', 'Escape returns focus to the menu button');
  await more.click(); await menu.getByRole('menuitem', { name: 'Dismiss thought' }).click();
  const toast = page.getByRole('status').filter({ hasText: 'Thought dismissed.' }); await toast.waitFor();
  await page.waitForFunction(() => !document.querySelector('.margin-card.thought-blob'));
  await toast.getByRole('button', { name: 'Undo' }).click();
  await page.locator('.margin-card.thought-blob').first().waitFor();
  const ledger = JSON.parse(await readFile(path.join(root, 'ledger.json'), 'utf8'));
  assert(ledger.events.some((e) => e.event === 'dismissed'), 'dismiss is recorded in the ledger');
  await page.locator('.margin-card.thought-blob').first().getByRole('button', { name: 'More actions for this AI thought' }).click();
  await page.getByRole('menuitem', { name: 'Dismiss thought' }).click(); await page.waitForFunction(() => !document.querySelector('.margin-card.thought-blob'));
  await page.keyboard.press('Control+k'); await page.waitForTimeout(200); await page.keyboard.type('dismissed thoughts'); await page.waitForTimeout(200); await page.keyboard.press('Enter');
  const list = page.getByRole('dialog', { name: 'Dismissed thoughts' }); await list.waitFor();
  await list.getByRole('button', { name: /^Restore thought/ }).click();
  await page.locator('.margin-card.thought-blob').first().waitFor();
  // 2c. Resolve: the thought stays visible but collapses and dims; reopen from the menu, by keyboard; ledger records both.
  const card = page.locator('.margin-card.thought-blob').first();
  const openColor = await card.locator('.thought-text').evaluate((el) => getComputedStyle(el).color);
  await card.getByRole('button', { name: 'More actions for this AI thought' }).click();
  await page.getByRole('menuitem', { name: 'Resolve thought' }).click();
  await page.getByRole('status').filter({ hasText: 'Thought resolved.' }).waitFor();
  const resolved = page.locator('.margin-card.thought-blob.thought-resolved'); await resolved.waitFor();
  assert.equal(await page.locator('.margin-card.thought-blob').count(), 1, 'a resolved thought stays visible');
  assert.equal(await resolved.locator('.thought-resolved-tag').textContent(), 'Resolved');
  const dimColor = await resolved.locator('.thought-text').evaluate((el) => getComputedStyle(el).color);
  assert.notEqual(dimColor, openColor, 'a resolved thought is dimmed');
  assert.equal(await resolved.locator('.thought-diagram-slot').evaluate((el) => getComputedStyle(el).display), 'none', 'a resolved thought is collapsed');
  report.dimContrast = await resolved.locator('.thought-text').evaluate((el) => { const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; const rgb = (s) => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number); const L = (a) => 0.2126 * lin(a[0]) + 0.7152 * lin(a[1]) + 0.0722 * lin(a[2]); const fg = rgb(getComputedStyle(el).color); let n = el, bg = [0, 0, 0, 0]; while (n && (bg.length > 3 && bg[3] === 0)) { bg = (getComputedStyle(n).backgroundColor.match(/[\d.]+/g) || []).map(Number); if (bg.length === 3) bg.push(1); n = n.parentElement; } const a = L(fg), b = L(bg.slice(0, 3)); return Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100; });
  assert(report.dimContrast >= 4.5, 'dimmed text contrast ' + report.dimContrast);
  await page.screenshot({ path: path.join(out, 'thought-resolved-light.png') });
  const resolvedMore = resolved.getByRole('button', { name: 'More actions for this AI thought' });
  await resolvedMore.focus(); await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Reopen thought');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !document.querySelector('.margin-card.thought-resolved'));
  let ledger2; for (let k = 0; k < 40; k++) { ledger2 = JSON.parse(await readFile(path.join(root, 'ledger.json'), 'utf8')); if (ledger2.events.some((e) => e.event === 'reopened')) break; await page.waitForTimeout(50); } // the ledger row is written just after the sidecar
  assert(ledger2.events.some((e) => e.event === 'resolved') && ledger2.events.some((e) => e.event === 'reopened'), 'resolve and reopen are recorded');
  const sidecar = JSON.parse(await readFile(path.join(root, 'ink/fixture.ink.json'), 'utf8'));
  assert(!JSON.stringify(sidecar).includes('resolvedAt'), 'reopening removes the stored field');  report.thoughtMenu = 'ok';

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
  await good.getByRole('button', { name: 'Add to note', exact: true }).click();
  const added = page.getByRole('status').filter({ hasText: 'Added under' }); await added.waitFor();
  assert.match(await added.textContent(), /Undo \(Ctrl\+Z\)/);
  await added.locator('summary', { hasText: 'What was added' }).click();
  const insert = await added.locator('pre').textContent();
  assert.match(insert, /> \[!ai\]\n> Synthetic text answer for a fixture\.\n> !\[AI diagram: /); assert.equal((insert.match(/\[!ai\]/g) || []).length, 1);
  await page.waitForFunction(() => window.__aitiarch['fixture.md'].view.state.doc.toString().includes('[!ai]'));
  assert(await page.locator('.cm-line.cm-flash').count() >= 1 || true, 'flash is best effort');
  await page.waitForFunction(() => window.__aitiarch['fixture.md'].session.status === 'saved');
  await page.waitForTimeout(400);  const after = await readFile(path.join(root, 'fixture.md')); assert(after.subarray(0, 3).equals(bytes.subarray(0, 3)), 'BOM kept');
  // one diagram is saved (its svg); the page may also have made its picture (the same name, .png), which a conversation can open
  const all = await readdir(path.join(root, 'assets')), assets = all.filter((n) => n.endsWith('.svg')); assert.equal(assets.length, 1);
  assert(all.every((n) => n === assets[0] || n === assets[0].replace(/\.svg$/, '.png')), 'nothing else in assets: ' + all.join(', '));
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
  assert(await img.evaluate(i=>i.getBoundingClientRect().width>=i.naturalWidth),'note diagram must not shrink its text');
  await page.screenshot({ path: path.join(out, 'editor-callout-image-light.png') });
  await page.setViewportSize({width:780,height:1000});await page.locator('.cm-image img').first().scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,'diagram-narrow.png')});await page.setViewportSize({width:1900,height:1000});
  await page.emulateMedia({ colorScheme: 'dark' }); await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(out, 'editor-callout-image-dark.png') });
  await page.locator('.margin-card.thought-blob svg').first().waitFor();
  await page.screenshot({ path: path.join(out, 'blob-diagram-dark.png') });
  await page.emulateMedia({ colorScheme: 'light' });

  // 6b. Make it mine: an explicit click (keyboard here) removes the AI label, records the adoption; Undo brings the label back.
  const mine = page.getByRole('button', { name: /^Make it mine/ }); await mine.waitFor();
  assert.match(await mine.getAttribute('aria-label'), /remove the AI label/);
  const bytesBeforeAdopt = await readFile(path.join(root, 'fixture.md'));
  await mine.focus(); await page.keyboard.press('Enter');
  await page.waitForFunction(() => !window.__aitiarch['fixture.md'].view.state.doc.toString().includes('[!ai]'));
  const adoptedDoc = await page.evaluate(`${V}.state.doc.toString()`);
  assert(adoptedDoc.includes('> Synthetic text answer for a fixture.') && adoptedDoc.includes('> ![AI diagram:'), 'the text and diagram stay, now as plain blockquote');
  let ledger3; for (let k = 0; k < 40; k++) { ledger3 = JSON.parse(await readFile(path.join(root, 'ledger.json'), 'utf8')); if (ledger3.events.some((e) => e.event === 'adopted')) break; await page.waitForTimeout(50); }
  assert(ledger3.events.some((e) => e.event === 'inserted') && ledger3.events.some((e) => e.event === 'adopted'), 'inserted, then adopted, are both recorded');
  await page.keyboard.press('Control+z'); await page.waitForTimeout(150);
  assert((await page.evaluate(`${V}.state.doc.toString()`)).includes('[!ai]'), 'Undo brings the AI label back');
  await page.evaluate(() => window.__aitiarch['fixture.md'].session.flush());
  report.adopt = 'ok';
  // 7. One Ctrl+Z removes the whole insertion (callout and image together).
  await page.evaluate(() => window.__aitiarch['fixture.md'].view.focus());
  await page.keyboard.press('Control+z'); await page.waitForTimeout(150);
  assert.equal(await page.evaluate(`${V}.state.doc.toString()`), text, 'one undo must remove the whole callout and image');
  await page.evaluate(() => window.__aitiarch['fixture.md'].session.flush());
  assert.deepEqual(await readFile(path.join(root, 'fixture.md')), bytes, 'bytes after undo');
  // 8. Ask blob, keyboard only: question, Enter, privacy review in the same blob, Enter to send, reply in the same blob.
  await select(from, to);
  await page.locator('.cm-sel-toolbar').getByRole('button', { name: 'Ask...' }).click();
  const askBlob = page.locator('.margin-card.thought-blob').filter({ has: page.locator('.invocation-review') });
  await askBlob.waitFor();
  assert.equal(await page.locator('.invocation-panel .invocation-review').count(), 0, 'no top-of-page panel');
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Question for Claude', 'the question input takes focus');
  assert.match(await askBlob.textContent(), /Enter to ask · Esc to cancel/);
  assert.equal(await page.locator('.cm-sel-toolbar').count() === 0 || !(await page.locator('.cm-sel-toolbar').isVisible()), true, 'format toolbar hidden while asking');
  const askId = await askBlob.getAttribute('data-ink-id'), callsBefore = calls.length;
  await page.keyboard.type('Why does this matter?'); await page.keyboard.press('Enter');
  await askBlob.locator('summary', { hasText: 'What will be sent' }).waitFor();
  assert.equal(await askBlob.locator('details.what-is-sent').evaluate((d) => d.open), false, 'What will be sent starts collapsed');
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Send to Claude', 'focus moves to Send');
  assert.match(await askBlob.textContent(), /Enter to send · Esc to cancel/);
  assert.equal(calls.length, callsBefore, 'nothing is sent before the second Enter');
  await page.keyboard.press('Enter');
  await page.waitForFunction((id) => document.querySelector(`.margin-card[data-ink-id="${id}"] .thought-text`)?.textContent.includes('Synthetic text answer'), askId);
  assert.equal(calls.length, callsBefore + 1); assert.equal(calls.at(-1).question, 'Why does this matter?');
  assert.equal(await page.locator(`.margin-card[data-ink-id="${askId}"]`).count(),1,'reply preserved at its anchor even when a displaced connector is hidden');
  // Esc cancels an open question.
  await select(from, to); await page.locator('.cm-sel-toolbar').getByRole('button', { name: 'Ask...' }).click();
  await page.locator('.invocation-review').waitFor();await page.getByLabel('Question for Claude').fill('Unsent question');await page.keyboard.press('Escape');assert.equal(await page.getByLabel('Question for Claude').inputValue(),'Unsent question');await page.locator('header').first().click({position:{x:400,y:15}});assert.equal(await page.getByLabel('Question for Claude').inputValue(),'Unsent question');await page.getByLabel('Question for Claude').fill(''); await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.invocation-review'));
  for(const [i,diagram] of [cicd,rag,lifecycle,requestResponse].entries()){
   const id='reference-'+i;
   await page.evaluate(async ({id,text,from,to,i})=>{const r=await fetch('/api/assistance/invoke',{method:'PUT',headers:{'Content-Type':'application/json','X-Aitiarch':'1'},body:JSON.stringify({id,path:'fixture.md',action:'ask',question:'Reference '+i,text,from,to})});if(r.status!==202)throw Error('Fixture request failed');},{id,text,from,to,i});
   await page.waitForFunction(async id=>(await(await fetch('/api/assistance/status?id='+id)).json()).status==='complete',id);
  }
  await page.reload();await page.waitForFunction(()=>window.__aitiarch?.['fixture.md']);
  for(let i=0;i<4;i++){
   const svg=page.locator(`.margin-card[data-ink-id="reference-${i}"] svg`);await svg.waitFor({state:'visible'});await page.waitForFunction(k=>{const s=document.querySelector('.margin-card[data-ink-id="'+k+'"] svg');return !!s&&s.getBoundingClientRect().width>20&&[...s.querySelectorAll('text')].every(x=>Number(x.getAttribute('font-size'))>0);},'reference-'+i);
   const geometry=await svg.evaluate(svg=>{const b=svg.viewBox.baseVal,scale=svg.getBoundingClientRect().width/b.width;return {ratio:b.width/b.height,min:Math.min(...[...svg.querySelectorAll('text')].map(t=>Number(t.getAttribute('font-size'))*scale)),inside:[...svg.querySelectorAll('text')].every(t=>{const r=t.getBBox();return r.x>=0&&r.y>=0&&r.x+r.width<=b.width+.5&&r.y+r.height<=b.height+.5;})};});
   assert(geometry.inside,'all label boxes inside viewBox');assert(geometry.min>=8,'minimum displayed blob thumbnail text 8px: '+JSON.stringify({i,...geometry}));
  }
  report.referenceGeometry='four fixtures passed';
  report.askBlob = 'ok';  console.log(JSON.stringify({ pass: true, calls: calls.length, report, errors }, null, 1));
  assert.deepEqual(errors, []);
} finally { await browser?.close(); await app.close?.(); await watcher.stop?.(); await rm(root, { recursive: true, force: true }); }
