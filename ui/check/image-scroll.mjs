// Regression: upward scrolling across local image widgets keeps visible text steady.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { Store } from '../server/store.ts';
import { NoteWatcher } from '../server/watch.ts';
import { createApp } from '../server/http.ts';
const ui = fileURLToPath(new URL('../', import.meta.url));
const root = await mkdtemp(path.join(os.tmpdir(), 'aitiarch-image-scroll-')); execFileSync('git', ['init', '-q'], { cwd: root });
await writeFile(path.join(root, '.gitignore'), '/.cache/\n/ui-state.json*\n');
let note = '# Diagram scroll fixture\n\n';
for (let i = 0; i < 10; i++) {
  note += Array.from({ length: 6 }, (_, k) => `Paragraph ${i + 1}.${k + 1}: some ordinary writing between diagrams so the page is long.\r\n`).join('\r\n') + '\r\n![Synthetic diagram](assets/ai-diagram-' + String(i).repeat(64) + '.svg)\r\n\r\n';
}
const original = Buffer.from('\ufeff' + note.replace(/(?<!\r)\n/g, '\r\n')); await writeFile(path.join(root, 'n.md'), original);
const store = await Store.open(root), watcher = new NoteWatcher(store, 50, 10); await watcher.start();
const app = createApp({ store, watcher, distDir: path.join(ui, 'dist'), provider: { name: 'claude', checkAvailability: async () => ({ available: true }), invoke: async () => { throw Error('Provider calls forbidden'); } } });
const base = `http://127.0.0.1:${await app.listen(0)}`, browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }); await page.route('**/api/diagram-asset?*', route => route.fulfill({contentType:'image/svg+xml', body:'<svg xmlns="http://www.w3.org/2000/svg" width="680" height="500" viewBox="0 0 680 500"><rect x="10" y="10" width="660" height="480" fill="green"/><text x="50" y="60">Synthetic diagram</text></svg>'})); await page.goto(base + '/?debug=1'); await page.waitForFunction(() => window.__aitiarch?.['n.md']); await page.waitForTimeout(1500);
  await page.mouse.move(600, 500);
  for (let i = 0; i < 75; i++) { await page.mouse.wheel(0, 120); await page.waitForTimeout(160); } // down to the bottom, one step at a time
  await page.waitForTimeout(800);
  const rendered = await page.evaluate(() => document.querySelectorAll('.cm-image img').length); assert(rendered >= 1, 'the diagrams are drawn');
  const snap = () => page.evaluate(() => { const m = {}; for (const l of document.querySelectorAll('.cm-line')) { const t = (l.textContent || '').trim(); if (!t.startsWith('Paragraph')) continue; const r = l.getBoundingClientRect(); if (r.bottom > 60 && r.top < 880) m[t] = Math.round(r.top); } return m; });
  const pos = () => page.evaluate(() => Math.round(-document.querySelector('.cm-content').getBoundingClientRect().top));
  const odd = []; let prev = await snap(), before = await pos(), compared = 0;
  for (let i = 0; i < 75; i++) {
    const frames = page.evaluate(async () => {
      const frames = [];
      for (let i = 0; i < 14; i++) {
        await new Promise(requestAnimationFrame);
        const m = {};
        for (const l of document.querySelectorAll('.cm-line')) {
          const t = (l.textContent || '').trim(), r = l.getBoundingClientRect();
          if (t.startsWith('Paragraph') && r.bottom > 60 && r.top < 880) m[t] = r.top;
        }
        frames.push(m);
      }
      return frames;
    });
    await page.mouse.wheel(0, -120);
    const samples = await frames;
    for (let f = 1; f < samples.length; f++) {
      const a = samples[f - 1], b = samples[f];
      for (const t of Object.keys(b)) if (t in a) {
        const delta = b[t] - a[t];
        if (delta < -2 || delta > 124) odd.push(`step ${i} frame ${f}: text moved ${delta.toFixed(1)}px`);
      }
    }
    const now = await snap();
    if (before >= 130) { // not near the very top of the note, where it cannot move the full distance
      const ds = Object.keys(now).filter((t) => t in prev).map((t) => now[t] - prev[t]); compared += ds.length;
      const bad = ds.filter((d) => Math.abs(d - 120) > 4 && d !== 0); if (bad.length) odd.push(`step ${i}: visible text moved ${bad.slice(0, 3).join(', ')}px instead of 120`);
    }
    prev = now; before = await pos();
  }
  assert(compared > 150, `enough lines were compared (${compared})`);
  assert.deepEqual(odd, [], 'the text jumped while scrolling up past a diagram:\n' + odd.join('\n'));
  assert.deepEqual(await readFile(path.join(root, 'n.md')), original, 'scrolling must preserve BOM and CRLF bytes');
  console.log(JSON.stringify({ pass: true, linesCompared: compared, diagramsDrawn: rendered }));
} finally { await browser.close(); await app.close(); watcher.stop(); console.log('Cleanup target:', root); await rm(root, { recursive: true, force: true }); }
