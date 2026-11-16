// Focus-state styling of the editor, with a TALL skill-diagram card in the margin rail. Real browser, fake provider, synthetic long note, no model call.
// (a) A mouse click or a selection inside the note must not draw anything: outline, box-shadow and border on the editor, its containers, the rail and the cards
//     are exactly what they are with the editor blurred. The caret and the selection are the indicator.
// (b) Tab into the editor shows a visible focus indicator around the writing column only: it never reaches under or over a thought card.
// (c) The same holds with the tall diagram card present, and a click after the keyboard focus takes the indicator away again.
// Run after `vite build`: BATCH2A_OUTPUT=<folder outside the repo> node check/focus-frame.mjs   (SHOT=before|after names the click screenshot)
import './config-isolation.mjs'; // first: an empty temp config folder, never the machine's real one
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { Store } from '../server/store.ts';
import { NoteWatcher } from '../server/watch.ts';
import { createApp } from '../server/http.ts';

const out = path.resolve(process.env.BATCH2A_OUTPUT ?? '');
assert(process.env.BATCH2A_OUTPUT && !out.toLowerCase().startsWith(path.resolve('..').toLowerCase()), 'Output must be outside the repo');
const shot = process.env.SHOT || 'after';
const root = await mkdtemp(path.join(os.tmpdir(), 'aitiarch-focus-frame-')), skills = await mkdtemp(path.join(os.tmpdir(), 'aitiarch-focus-frame-lib-'));
execFileSync('git', ['init', '-q'], { cwd: root });
await writeFile(path.join(root, '.gitignore'), '/.cache/\n/ui-state.json*\n');
const para = (n) => `Paragraph ${n}: a short plain paragraph of the synthetic note, long enough to sit on a couple of lines when the column is not wide.`;
const paras = Array.from({ length: 30 }, (_, i) => para(i + 1));
const text = '# Long synthetic note\n\n' + paras.join('\n\n') + '\n';
await writeFile(path.join(root, 'fixture.md'), text);
await mkdir(path.join(skills, 'diagram-design')); await writeFile(path.join(skills, 'diagram-design', 'SKILL.md'), '---\nname: diagram-design\ndescription: Draw diagrams as web pages\n---\nUse boxes and arrows.\n');
const TALL = `<!doctype html><html><body><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 1400" width="300" height="1400"><rect x="10" y="10" width="280" height="1380" fill="#f4efe6" stroke="#1c1b19" stroke-width="3"/>
${Array.from({ length: 12 }, (_, i) => `<rect x="40" y="${40 + i * 110}" width="220" height="70" rx="8" fill="#fff" stroke="#1c1b19" stroke-width="2"/><text x="60" y="${82 + i * 110}" font-size="20">Step ${i + 1}</text>`).join('')}</svg></body></html>`;

const store = await Store.open(root), watcher = new NoteWatcher(store, 60, 10); await watcher.start();
const provider = { name: 'claude', checkAvailability: async () => ({ available: true }),
  invoke: async (r) => ({ id: r.id, provider: 'claude', model: null, answer: r.render === 'skill' ? 'Here is the page:\n```html\n' + TALL + '\n```' : 'A synthetic thought that sits next to the diagram card.', claims: [], usage: null }) };
const app = createApp({ store, watcher, distDir: path.resolve('dist'), provider, skillRoots: [{ kind: 'user', dir: skills, layout: 'flat' }] });
let browser;
try {
  const base = 'http://127.0.0.1:' + await app.listen(0);
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: Number(process.env.W || 1500), height: Number(process.env.H || 900) } }), page = await context.newPage();
  page.setDefaultTimeout(15000);
  await page.goto(base + '/?debug'); await page.waitForFunction(() => window.__aitiarch?.['fixture.md']);
  const select = (a, b) => page.evaluate(([a, b]) => { const v = window.__aitiarch['fixture.md'].view; v.dispatch({ selection: { anchor: a, head: b }, scrollIntoView: true }); v.focus(); }, [a, b]);
  const range = (n) => { const from = text.indexOf(paras[n - 1]); return [from, from + paras[n - 1].length]; };
  const until = async (what, test, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await test()) return; await new Promise((r) => setTimeout(r, 100)); } throw new Error('timed out waiting for ' + what); };
  const items = () => page.evaluate(async () => (await (await fetch('/api/ink?path=fixture.md')).json()).document.items);

  // A neighbouring thought, then the tall skill diagram card (same set-up as check/skill-diagram-layout.mjs).
  await select(...range(13)); await page.getByRole('button', { name: 'Think on this', exact: true }).click();
  await page.getByRole('button', { name: 'Send to Claude', exact: true }).click();
  await until('the neighbour thought', async () => (await items()).some((i) => i.generation?.status === 'complete'));
  const status = await page.evaluate(async () => { const lib = await (await fetch('/api/skills?q=diagram-design&limit=50')).json(), id = lib.results.find((s) => s.name === 'diagram-design').id;
    const nodes = (await (await fetch('/api/nodes')).json()).nodes;
    return (await fetch('/api/nodes', { method: 'PUT', headers: { 'content-type': 'application/json', 'x-aitiarch': '1' }, body: JSON.stringify({ visualize: { persona: nodes.visualize.persona, skills: [id] } }) })).status; });
  assert.equal(status, 200);
  await select(...range(12)); const toolbar = page.locator('.cm-sel-toolbar'); await toolbar.waitFor(); await toolbar.getByRole('button', { name: 'Visualize' }).click();
  const review = page.locator('.invocation-review'); await review.waitFor(); await review.getByRole('button', { name: /^Send to/ }).waitFor();
  if (!(await review.getByRole('radio', { name: 'Skill' }).isChecked())) { await review.getByRole('radio', { name: 'Skill' }).check(); await review.getByRole('button', { name: /^Send to/ }).waitFor(); }
  await review.getByRole('button', { name: /^Send to/ }).click();
  await until('the skill diagram', async () => (await items()).some((i) => i.skillDiagram && i.generation?.status === 'complete'));
  const diagram = (await items()).find((i) => i.skillDiagram);
  const img = page.locator(`[data-skill-asset="${diagram.skillDiagram.asset}"] img.skill-diagram-image`); await img.waitFor(); await img.evaluate((i) => i.decode());
  await page.waitForTimeout(800);

  // What is drawn around things: outline, box-shadow and border of the editor and every container above it, the rail, and every card.
  const snap = () => page.evaluate(() => {
    const pick = (el) => { const s = getComputedStyle(el); return { outline: s.outlineStyle === 'none' || parseFloat(s.outlineWidth) === 0 ? 'none' : `${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor} ${s.outlineOffset}`, shadow: s.boxShadow,
      border: ['Top', 'Right', 'Bottom', 'Left'].map((k) => `${s['border' + k + 'Style']} ${s['border' + k + 'Width']} ${s['border' + k + 'Color']}`).join(' | ') }; };
    const name = (el) => el.tagName.toLowerCase() + '.' + String(el.getAttribute('class') ?? '').split(/\s+/).filter((c) => c && c !== 'cm-focused' && c !== 'thought-active').join('.');
    const els = []; for (let e = document.querySelector('.cm-content'); e; e = e.parentElement) els.push(e);
    for (const e of document.querySelectorAll('.margin-rail, .margin-card, .cm-scroller')) if (!els.includes(e)) els.push(e);
    const r = (el) => { const b = el.getBoundingClientRect(); return { left: b.left, top: b.top, right: b.right, bottom: b.bottom }; };
    return { items: els.map((e, i) => ({ key: i + ' ' + name(e), ...pick(e) })), content: r(document.querySelector('.cm-content')), ring: (() => { const c = document.querySelector('.cm-content'), p = getComputedStyle(c, '::after'), b = c.getBoundingClientRect(), shown = p.content !== 'none' && p.borderTopStyle === 'solid' && parseFloat(p.borderTopWidth) >= 2; return { shown, color: p.borderTopColor, left: b.left + parseFloat(p.left), top: b.top + parseFloat(p.top), right: b.right - parseFloat(p.right), bottom: b.bottom - parseFloat(p.bottom) }; })(), cards: [...document.querySelectorAll('.margin-card')].map((c) => ({ id: c.dataset.inkId?.slice(0, 8), side: c.dataset.side, ...r(c) })),
      focused: document.querySelector('.cm-editor')?.classList.contains('cm-focused'), active: document.activeElement?.className?.toString().slice(0, 40), mode: document.documentElement.dataset.input ?? null };
  });
  const differences = (a, b) => a.items.flatMap((x, i) => ['outline', 'shadow', 'border'].filter((k) => x[k] !== b.items[i]?.[k]).map((k) => `${x.key}: ${k} "${b.items[i]?.[k]}" instead of "${x[k]}"`));
  const blur = async () => { await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur()); await page.mouse.move(2, 2); await page.waitForTimeout(250); }; // pointer parked away from every card, so hover does not count
  const clickNote = async (n) => { const line = page.locator('.cm-line', { hasText: `Paragraph ${n}:` }).first(); await line.scrollIntoViewIfNeeded(); await line.click({ position: { x: 90, y: 8 } }); await page.waitForTimeout(250); };

  // Baseline: editor blurred. Everything below is compared with this.
  await blur(); const rest = await snap(); assert.equal(rest.focused, false, 'baseline: the editor is not focused');

  // (a) A mouse click in the note, and a selection made with the mouse (double-click selects a word).
  await clickNote(3); const clicked = await snap(); assert.equal(clicked.focused, true, 'the click focused the editor');
  await page.screenshot({ path: path.join(out, `focus-frame-click-${shot}.png`) });
  const d1 = differences(rest, clicked); assert.deepEqual(d1, [], 'a click in the note must draw nothing:\n' + d1.join('\n'));
  await page.locator('.cm-line', { hasText: 'Paragraph 3:' }).first().dblclick({ position: { x: 90, y: 8 } }); await page.waitForTimeout(250);
  const selected = await snap(); const d2 = differences(rest, selected); assert.deepEqual(d2, [], 'a selection in the note must draw nothing:\n' + d2.join('\n'));

  // (b) Tab into the editor from outside: a visible indicator on the writing column only.
  await blur(); await page.mouse.click(5, 5); await blur();
  let tabs = 0; for (; tabs < 80; tabs++) { await page.keyboard.press('Tab'); if (await page.evaluate(() => document.activeElement?.classList.contains('cm-content'))) break; }
  assert(tabs < 80, 'Tab reaches the editor'); await page.waitForTimeout(250);
  const keyed = await snap(); await page.screenshot({ path: path.join(out, `focus-frame-tab-${shot}.png`) });
  const R0 = keyed.ring;
  assert(R0.shown && !/rgba\(0, 0, 0, 0\)|transparent/.test(R0.color), 'Tab: a visible 2px focus ring on the writing column, got ' + JSON.stringify(R0));
  const rest2 = differences(rest, keyed); assert.deepEqual(rest2, [], 'Tab: nothing else changes (the ring is drawn by the column itself):\n' + rest2.join('\n'));
  // The indicator's outer edge (content box grown by outline offset + width) stays inside the writing column and clear of every thought card.
  const g = 4, R = keyed.ring, C = keyed.content;
  assert(R.left >= C.left && R.right <= C.right && R.top >= C.top - 12 && R.bottom <= C.bottom + 12, 'Tab: the ring stays inside the writing column ' + JSON.stringify({ R, C }));
  for (const c of keyed.cards) { const apart = c.left >= R.right + g || c.right <= R.left - g || c.top >= R.bottom + g || c.bottom <= R.top - g;
    assert(apart, `Tab: the indicator must not reach card ${c.id} (${c.side}): ring ${JSON.stringify(R)} card ${JSON.stringify(c)}`); }

  // (c) A click after the keyboard focus takes the indicator away again; with the tall card present throughout.
  await clickNote(5); const again = await snap(); const d3 = differences(rest, again); assert.deepEqual(d3, [], 'a click after Tab must remove the indicator:\n' + d3.join('\n'));
  console.log('focus-frame: ok', JSON.stringify({ tabs, ring: keyed.ring }));
} finally { await browser?.close(); watcher.stop(); await app.close(); await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); await rm(skills, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
