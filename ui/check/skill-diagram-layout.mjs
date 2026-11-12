// Layout of a TALL skill-diagram thought card in the margin rail: it must show in full (nothing clipped, no scrollbar of its own), with no stray
// full-width line behind it or along its edge, no overlap with the neighbouring thought, and its connector still reaching the anchored text.
// Real browser, fake provider, synthetic long note (so the note scrolls), no model call.
// Run after `vite build`: BATCH2A_OUTPUT=<folder outside the repo> node check/skill-diagram-layout.mjs
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
const root = await mkdtemp(path.join(os.tmpdir(), 'aitiarch-skill-layout-')), skills = await mkdtemp(path.join(os.tmpdir(), 'aitiarch-skill-layout-lib-'));
execFileSync('git', ['init', '-q'], { cwd: root });
await writeFile(path.join(root, '.gitignore'), '/.cache/\n/ui-state.json*\n');
const para = (n) => `Paragraph ${n}: a short plain paragraph of the synthetic note, long enough to sit on a couple of lines when the column is not wide.`;
const paras = Array.from({ length: 30 }, (_, i) => para(i + 1));
const text = '# Long synthetic note\n\n' + paras.join('\n\n') + '\n';
await writeFile(path.join(root, 'fixture.md'), text);
await mkdir(path.join(skills, 'diagram-design')); await writeFile(path.join(skills, 'diagram-design', 'SKILL.md'), '---\nname: diagram-design\ndescription: Draw diagrams as web pages\n---\nUse boxes and arrows.\n');

// A tall drawing: 300 x 1400, so as an image in a ~320px card it is well over a screen high.
const TALL = `<!doctype html><html><body><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 1400" width="300" height="1400"><rect x="10" y="10" width="280" height="1380" fill="#f4efe6" stroke="#1c1b19" stroke-width="3"/>
${Array.from({ length: 12 }, (_, i) => `<rect x="40" y="${40 + i * 110}" width="220" height="70" rx="8" fill="#fff" stroke="#1c1b19" stroke-width="2"/><text x="60" y="${82 + i * 110}" font-size="20">Step ${i + 1}</text>`).join('')}</svg></body></html>`;

const store = await Store.open(root), watcher = new NoteWatcher(store, 60, 10); await watcher.start();
const calls = [];
const provider = { name: 'claude', checkAvailability: async () => ({ available: true }),
  invoke: async (r) => { calls.push(r.render ?? 'builtin');
    return { id: r.id, provider: 'claude', model: null, answer: r.render === 'skill' ? 'Here is the page:\n```html\n' + TALL + '\n```' : 'A synthetic thought that sits next to the diagram card.', claims: [], usage: null }; } };
const app = createApp({ store, watcher, distDir: path.resolve('dist'), provider, skillRoots: [{ kind: 'user', dir: skills, layout: 'flat' }] });
let browser; const report = {};
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

  // A neighbouring thought on the next paragraph (a normal Think, no diagram).
  await select(...range(13)); await page.getByRole('button', { name: 'Think on this', exact: true }).click();
  await page.getByRole('button', { name: 'Send to Claude', exact: true }).click();
  await until('the neighbour thought', async () => (await items()).some((i) => i.generation?.status === 'complete'));

  // Attach the skill to Visualize, then draw the tall diagram with the Skill renderer for paragraph 12.
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
  const host = page.locator(`[data-skill-asset="${diagram.skillDiagram.asset}"]`); await host.waitFor();
  const img = host.locator('img.skill-diagram-image'); await img.waitFor(); await img.evaluate((i) => i.decode());
  await page.waitForTimeout(800);

  // Measure. Everything here is read from the real page.
  const measure = () => page.evaluate((assetName) => {
    const rail = document.querySelector('.margin-rail'), hostEl = document.querySelector(`[data-skill-asset="${assetName}"]`), card = hostEl.closest('.margin-card');
    const r = (el) => { const b = el.getBoundingClientRect(); return { left: Math.round(b.left), top: Math.round(b.top), right: Math.round(b.right), bottom: Math.round(b.bottom), w: Math.round(b.width), h: Math.round(b.height) }; };
    const cs = getComputedStyle(card), cards = [...document.querySelectorAll('.margin-card')].map((c) => ({ id: c.dataset.inkId?.slice(0, 8), ...r(c), side: c.dataset.side }));
    // Anything line-like (very thin, wide) that is drawn: borders, rules, svg strokes. Reported with where it is, so a stray one can be named.
    const lines = [];
    for (const el of document.querySelectorAll('body *')) {
      const b = el.getBoundingClientRect(), s = getComputedStyle(el);
      if (b.width >= innerWidth * 0.3 && b.height <= 4 && b.height > 0 && s.visibility !== 'hidden' && s.display !== 'none') lines.push({ tag: el.tagName.toLowerCase(), cls: String(el.getAttribute('class') ?? '').slice(0, 60), ...r(el) });
      for (const side of ['Top', 'Bottom']) { const w = parseFloat(s[`border${side}Width`]); if (w > 0 && s[`border${side}Style`] !== 'none' && b.width >= innerWidth * 0.3) lines.push({ tag: el.tagName.toLowerCase(), cls: String(el.getAttribute('class') ?? '').slice(0, 60), border: side, ...r(el) }); }
    }
    const connectors = [...document.querySelectorAll('.thought-connector')].map((p) => ({ id: p.dataset.inkId?.slice(0, 8), ...r(p), d: p.getAttribute('d')?.slice(0, 80) }));
    return { viewport: [innerWidth, innerHeight], rail: r(rail), railClip: { overflowY: getComputedStyle(rail).overflowY, overflowX: getComputedStyle(rail).overflowX },
      card: { id: card.dataset.inkId?.slice(0, 8), ...r(card), side: card.dataset.side, overflowY: cs.overflowY, maxHeight: cs.maxHeight, scrollHeight: card.scrollHeight, clientHeight: card.clientHeight, scrollTop: card.scrollTop, gutter: cs.scrollbarGutter, scrollbarWidth: cs.scrollbarWidth },
      host: r(hostEl), image: r(hostEl.querySelector('img')), buttons: [...hostEl.querySelectorAll('button')].map((b) => ({ t: b.textContent, ...r(b) })), cards, connectors, lines,
      noteScroll: (() => { const h = document.querySelector('.pane'); return h ? { scrollTop: h.scrollTop, scrollHeight: h.scrollHeight, clientHeight: h.clientHeight } : null; })() };
  }, diagram.skillDiagram.asset);
  // The thought's text never leaks into the note: without "Add to note" the editor holds none of it (an italic copy under the paragraph can only be an inserted callout).
  assert.equal(await page.evaluate(() => document.querySelector('.cm-content').innerText.includes('Diagram drawn by the')), false, 'thought text must not appear in the editor before Add to note');
  assert.equal(await page.evaluate(() => document.querySelector('.thought-text').closest('.margin-card') !== null), true);
  report.atCard = await measure();
  await page.screenshot({ path: path.join(out, 'skill-layout-at-card.png') });
  const inside = (a, b) => a.left >= b.left - 1 && a.right <= b.right + 1 && a.top >= b.top - 1 && a.bottom <= b.bottom + 1;
  const verify = (m, where, mustFit = true) => {
    // Root cause measured on the old layout: card max-height 60vh + overflow:auto while the drawing was ~1400px high gave the card its own scrollbar
    // (scrollHeight 1668 > clientHeight 540), and the card hung past the bottom of the rail, which clips (overflow:hidden).
    assert(m.card.scrollHeight <= m.card.clientHeight + 1, `${where}: the card must not need its own scrollbar (scrollHeight ${m.card.scrollHeight} > clientHeight ${m.card.clientHeight})`);
    assert(inside(m.image, m.card) && m.buttons.every((b) => inside(b, m.card)), `${where}: image and buttons must be inside the card`);
    // Where the card sits relative to the note's scroll is the reader's to change; but it must always be short enough to fit the rail when scrolled to.
    assert(m.card.h <= m.rail.h - 16, `${where}: card (${m.card.h}px) must be shorter than the rail (${m.rail.h}px)`);
    if (mustFit) assert(inside(m.card, m.rail), `${where}: the whole card must be visible inside the rail ${JSON.stringify(m.card)} vs ${JSON.stringify(m.rail)}`);
    const wide = m.lines.filter((l) => !(l.tag === 'main' && l.cls === 'editor-col'));
    assert.equal(wide.length, 0, `${where}: unexpected full-width line(s): ${JSON.stringify(wide)}`);
    for (const o of m.cards) if (o.id !== m.card.id && o.side === m.card.side) assert(o.bottom <= m.card.top || o.top >= m.card.bottom, `${where}: overlaps ${o.id}`);
    const c = m.connectors.find((k) => k.id === m.card.id);
    assert(c, `${where}: connector present`); assert(Math.abs(m.card.side === 'right' ? c.right - m.card.left : c.left - m.card.right) <= 6, `${where}: connector ends at the card edge`);
  };
  // Scroll the note so the card sits near the top of the rail (the card is then as exposed as it ever is), then measure again.
  await page.evaluate((assetName) => { const rail = document.querySelector('.margin-rail'), card = document.querySelector(`[data-skill-asset="${assetName}"]`).closest('.margin-card'), pane = document.querySelector('.pane');
    pane.scrollTop += card.getBoundingClientRect().top - rail.getBoundingClientRect().top - 40; }, diagram.skillDiagram.asset);
  await page.waitForTimeout(500);
  report.scrolled = await measure();
  await page.screenshot({ path: path.join(out, 'skill-layout-scrolled.png') });
  if (process.env.DUMP) console.log(JSON.stringify(report, null, 1));
  verify(report.atCard, 'at the card, note at its first scroll', false);
  verify(report.scrolled, 'note scrolled so the card is at the top of the rail');
  console.log('skill-diagram-layout: ok');
} finally { await browser?.close(); watcher.stop(); await app.close(); await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); await rm(skills, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
