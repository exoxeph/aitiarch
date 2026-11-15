// Real-browser check: scrolling UP through a note with diagrams in it does not make the text jump. A diagram block that has a margin makes the editor
// mis-measure every diagram by the margin (it measures a block widget without its margins), so the text below shifted by that much each time one scrolled
// into view. Here the visible text must move by exactly the wheel distance on every step. Synthetic temp notebook; no provider is called.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { Store } from '../server/store.ts';
import { NoteWatcher } from '../server/watch.ts';
import { createApp } from '../server/http.ts';
const ui = fileURLToPath(new URL('../', import.meta.url));
const root = await mkdtemp(path.join(os.tmpdir(), 'aitiarch-diagram-scroll-')); execFileSync('git', ['init', '-q'], { cwd: root });
await writeFile(path.join(root, '.gitignore'), '/.cache/\n/ui-state.json*\n');
let note = '# Diagram scroll fixture\n\n';
for (let i = 0; i < 10; i++) {
  note += Array.from({ length: 6 }, (_, k) => `Paragraph ${i + 1}.${k + 1}: some ordinary writing between the diagrams so the page is long.\n`).join('\n') + '\n```mermaid\n' + `graph TD; A[Start ${i}]-->B[Middle ${i}]; B-->C[End]; C-->D[Done]; D-->E[More]; E-->F[Last];` + '\n```\n\n';
}
await writeFile(path.join(root, 'n.md'), note);
const store = await Store.open(root), watcher = new NoteWatcher(store, 50, 10); await watcher.start();
const app = createApp({ store, watcher, distDir: path.join(ui, 'dist'), provider: { name: 'claude', checkAvailability: async () => ({ available: true }), invoke: async () => { throw Error('Provider calls forbidden'); } } });
const base = `http://127.0.0.1:${await app.listen(0)}`, browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }); await page.goto(base + '/?debug=1'); await page.waitForFunction(() => window.__aitiarch?.['n.md']); await page.waitForTimeout(1500);
  await page.mouse.move(600, 500);
  for (let i = 0; i < 75; i++) { await page.mouse.wheel(0, 120); await page.waitForTimeout(160); } // down to the bottom, one step at a time
  await page.waitForTimeout(800);
  const rendered = await page.evaluate(() => document.querySelectorAll('.cm-mermaid-ok').length); assert(rendered >= 1, 'the diagrams are drawn');
  const snap = () => page.evaluate(() => { const m = {}; for (const l of document.querySelectorAll('.cm-line')) { const t = (l.textContent || '').trim(); if (!t.startsWith('Paragraph')) continue; const r = l.getBoundingClientRect(); if (r.bottom > 60 && r.top < 880) m[t] = Math.round(r.top); } return m; });
  const pos = () => page.evaluate(() => Math.round(-document.querySelector('.cm-content').getBoundingClientRect().top));
  const odd = []; let prev = await snap(), before = await pos(), compared = 0;
  for (let i = 0; i < 75; i++) {
    await page.mouse.wheel(0, -120); await page.waitForTimeout(170); const now = await snap();
    if (before >= 130) { // not near the very top of the note, where it cannot move the full distance
      const ds = Object.keys(now).filter((t) => t in prev).map((t) => now[t] - prev[t]); compared += ds.length;
      const bad = ds.filter((d) => Math.abs(d - 120) > 4 && d !== 0); if (bad.length) odd.push(`step ${i}: visible text moved ${bad.slice(0, 3).join(', ')}px instead of 120`);
    }
    prev = now; before = await pos();
  }
  assert(compared > 150, `enough lines were compared (${compared})`);
  assert.deepEqual(odd, [], 'the text jumped while scrolling up past a diagram:\n' + odd.join('\n'));
  console.log(JSON.stringify({ pass: true, linesCompared: compared, diagramsDrawn: rendered }));
} finally { await browser.close(); await app.close(); watcher.stop(); console.log('Cleanup target:', root); await rm(root, { recursive: true, force: true }); }
