// Real-browser check: the chat is a raised overlay that leaves the note and the long AI thoughts exactly where they are.
// Also: Esc and the close button, focus in and back, resizing and remembering the width, Pin, the narrow sheet, and the composer staying visible on short screens.
// All fixtures are synthetic OS-temp files; no provider is called. Needs BATCH2A_OUTPUT (a folder outside the repo) for screenshots.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { InkStore } from '../server/ink-store.ts';
import { captureAnchor } from '../shared/anchors.ts';
const here = path.dirname(fileURLToPath(import.meta.url)), uiDir = path.resolve(here, '..'), output = path.resolve(process.env.BATCH2A_OUTPUT ?? '');
assert(process.env.BATCH2A_OUTPUT && !output.toLowerCase().startsWith(path.resolve(uiDir, '..').toLowerCase()), 'BATCH2A_OUTPUT must be a folder outside the repo');
mkdirSync(output, { recursive: true });
const project = mkdtempSync(path.join(os.tmpdir(), 'aitiarch-chat-overlay-')), root = path.join(project, '.aitiarch'); mkdirSync(root);
const alpha = 'Alpha paragraph: the selected request needs a grounded answer.', beta = 'Beta paragraph: the margin should stay beside this evidence.';
const original = ['# Overlay fixture', '', alpha, '', beta, '', ...Array.from({ length: 40 }, (_, i) => `Filler paragraph ${i + 1}: the page keeps its own rhythm whatever the chat does.\n`)].join('\n');
writeFileSync(path.join(root, 'notebook.md'), original);
const long = (n) => `Thought ${n}: ` + 'This is a deliberately long AI thought that wraps over many lines so the margin column is tall and finicky when the page narrows. '.repeat(6);
let proc, browser;
try {
  const ink = await InkStore.open(root), s = await ink.read('notebook.md');
  for (const [id, from, to, body] of [['a1', original.indexOf(alpha), original.indexOf(alpha) + alpha.length, long(1)], ['b1', original.indexOf(beta), original.indexOf(beta) + beta.length, long(2)], ['b2', original.indexOf(beta), original.indexOf(beta) + beta.length, long(3)]]) {
    const anchor = captureAnchor(original, from, to); s.document.items.push({ id, kind: 'margin', body, anchor, originalAnchor: anchor, attachment: { status: 'attached', from, to } });
  }
  await ink.write('notebook.md', s.document, s.version);
  proc = spawn(process.execPath, [path.join(uiDir, 'server', 'main.ts'), '--root', root, '--port', '0', '--no-open'], { cwd: uiDir, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, AITIARCH_CONFIG_DIR: path.join(project, 'config') } });
  const url = await new Promise((resolve, reject) => { let o = ''; proc.stdout.on('data', (d) => { o += d; const m = /AITIARCH_READY (.*)/.exec(o); if (m) resolve(JSON.parse(m[1]).launch); }); proc.on('exit', (c) => reject(new Error('server exited ' + c))); setTimeout(() => reject(new Error('server startup timeout')), 15000); });
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const SELECTORS = ['.editor-col', '.cm-editor', '.cm-content', '.cm-line', '.margin-card', '.cm-ink-block', '.thought-blob', '.topbar', '.statusbar'];
  const snap = (page) => page.evaluate((sels) => Object.fromEntries(sels.map((q) => [q, [...document.querySelectorAll(q)].map((e) => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round); })])), SELECTORS);
  const open = async (page) => { await page.getByRole('button', { name: /^Chat/ }).click(); await page.locator('#chat-panel').waitFor(); await page.waitForTimeout(450); };
  const fresh = async (width, height) => { const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 }), page = await ctx.newPage(); page.setDefaultTimeout(9000); const errors = []; page.on('pageerror', (e) => errors.push(e.message)); await page.goto(url + '&debug'); await page.locator('.cm-editor').waitFor(); await page.waitForTimeout(700); return { ctx, page, errors }; };
  const results = [];
  // 1. The layout underneath is identical open and closed, at every size, and the composer and the Council bar stay on screen.
  for (const [width, height] of [[1440, 900], [1024, 800], [1440, 700], [1280, 650], [600, 800], [390, 860], [360, 640], [320, 640]]) {
    const { ctx, page, errors } = await fresh(width, height);
    const before = await snap(page); assert(before['.cm-content'].length === 1 && (width < 390 || (before['.margin-card'].length + before['.cm-ink-block'].length) >= 2), `the editor and, at the original check widths, long thoughts are on the page at ${width}`);
    await open(page);
    const overflow = await page.evaluate(() => { const r = document.querySelector('.chat-pill').getBoundingClientRect(); return {page:document.documentElement.scrollWidth-innerWidth, pill:r.right+scrollX-innerWidth}; });
    assert(overflow.page <= 0 && overflow.pill <= 0, `no sideways overflow or offscreen Chat button at ${width}: ${JSON.stringify(overflow)}`);
    assert.deepEqual(await snap(page), before, `the note and the thoughts moved when the chat opened at ${width}x${height}`);
    const box = await page.locator('#chat-panel').boundingBox(), layout = await page.locator('#chat-panel').getAttribute('data-layout');
    assert.equal(layout, width < 700 ? 'sheet' : 'overlay');
    if (layout === 'overlay') { assert(Math.abs(box.width - Math.round(width * 0.45)) <= 4, `about 45% wide at ${width}: ${box.width}`); assert(box.x + box.width >= width - 20, 'anchored to the right edge'); }
    else assert.equal(Math.round(box.width), width, 'a narrow window gets a full-width sheet');
    const inView = async (loc, what) => { const b = await loc.boundingBox(); assert(b && b.y >= 0 && b.y + b.height <= height + 0.5 && b.x >= 0 && b.x + b.width <= width + 0.5, `${what} is fully on screen at ${width}x${height}: ${JSON.stringify(b)}`); };
    const composer = page.getByRole('textbox', { name: 'Message Aitiarch AI' }); await inView(composer, 'the composer'); await inView(page.getByRole('button', { name: /^Chat mode:/ }), 'the Mode menu');
    await page.getByRole('button', { name: /^Chat mode:/ }).click(); await page.getByRole('menuitemradio', { name: /^Council/ }).click();
    const council = page.getByRole('region', { name: 'Council', exact: true }); await council.waitFor();
    await inView(composer, 'the composer in Council mode'); await inView(page.getByRole('button', { name: /^Chat mode:/ }), 'the Mode menu in Council mode'); await inView(council.getByRole('button', { name: 'Review Council question' }), 'the Review Council button');
    const c = await council.boundingBox(), p = await page.locator('#chat-panel').boundingBox(); assert(c && c.y >= p.y - 0.5 && c.y < p.y + p.height, `the Council bar is inside the panel at ${width}x${height}`);
    await page.screenshot({ path: path.join(output, `chat-overlay-${width}x${height}.png`) });
    assert.deepEqual(errors, []); results.push(`${width}x${height}:${layout}`); await ctx.close();
  }
  // 2. Non-modal; Esc and the close button close it; the note is back exactly as it was; focus returns to where it was.
  { const { ctx, page, errors } = await fresh(1440, 900), before = await snap(page);
    const pill = page.getByRole('button', { name: /^Chat/ }); await pill.focus(); await open(page);
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Message Aitiarch AI', 'focus moves into the panel');
    await page.locator('.cm-content').click({ position: { x: 20, y: 20 }, force: true }); await page.waitForTimeout(150); assert.equal(await page.locator('#chat-panel').count(), 1, 'clicking the note does not close the chat');
    // The app closes the topmost popup first (src/transient.ts): clicking into the note opens the editor's own popup, so that first Esc closes it and a second one closes the chat.
    const composerBox = page.getByRole('textbox', { name: 'Message Aitiarch AI' }); await composerBox.focus(); await page.keyboard.press('Escape'); await page.waitForTimeout(250);
    if (await page.locator('#chat-panel').count()) { await composerBox.focus(); await page.keyboard.press('Escape'); }
    await page.locator('#chat-panel').waitFor({ state: 'detached' });
    assert.deepEqual(await snap(page), before, 'the page is back exactly as it was after Esc');
    await open(page); await page.getByRole('button', { name: 'Close chat' }).click(); await page.locator('#chat-panel').waitFor({ state: 'detached' });
    assert.deepEqual(await snap(page), before, 'the page is back exactly as it was after the close button');
    assert.equal(await page.evaluate(() => document.activeElement?.className.includes('chat-pill')), true, 'focus returns to the control that opened the chat');
    assert.deepEqual(errors, []); await ctx.close(); }
  // 3. Drag the left edge to resize, use the keyboard, and the width is remembered after a reload.
  { const { ctx, page, errors } = await fresh(1440, 900); await open(page);
    const handle = page.getByRole('separator', { name: /Resize chat/ }), w0 = (await page.locator('#chat-panel').boundingBox()).width, hb = await handle.boundingBox();
    await page.mouse.move(hb.x + 3, hb.y + 200); await page.mouse.down(); await page.mouse.move(hb.x - 97, hb.y + 200, { steps: 6 }); await page.mouse.up();
    const w1 = (await page.locator('#chat-panel').boundingBox()).width; assert(Math.abs(w1 - (w0 + 100)) <= 6, `drag widens the panel: ${w0} -> ${w1}`);
    await handle.focus(); await page.keyboard.press('ArrowRight'); const w2 = (await page.locator('#chat-panel').boundingBox()).width; assert(w2 < w1, 'the keyboard narrows it');
    await page.reload(); await page.locator('.cm-editor').waitFor(); await open(page); const w3 = (await page.locator('#chat-panel').boundingBox()).width; assert(Math.abs(w3 - w2) <= 2, `the width is remembered: ${w2} -> ${w3}`);
    // 4. Pin docks it the way it always worked (the note makes room), and that choice is remembered too.
    await page.getByRole('button', { name: 'Close chat' }).click(); await page.locator('#chat-panel').waitFor({ state: 'detached' }); const closedBox = await page.locator('.editor-col').boundingBox();
    await open(page); await page.getByRole('button', { name: 'Pin chat beside the note' }).click(); await page.waitForTimeout(300);
    assert.equal(await page.locator('#chat-panel').getAttribute('data-layout'), 'pinned'); assert.equal(await page.getByRole('button', { name: 'Pin chat beside the note' }).getAttribute('aria-pressed'), 'true');
    assert((await page.locator('.editor-col').boundingBox()).width < closedBox.width - 200, 'pinned: the note makes room, as before');
    await page.screenshot({ path: path.join(output, 'chat-pinned-1440x900.png') });
    await page.reload(); await page.locator('.cm-editor').waitFor(); await open(page); assert.equal(await page.locator('#chat-panel').getAttribute('data-layout'), 'pinned', 'the pin is remembered');
    await page.getByRole('button', { name: 'Pin chat beside the note' }).click(); await page.waitForTimeout(300); assert.equal(await page.locator('#chat-panel').getAttribute('data-layout'), 'overlay');
    assert.deepEqual(errors, []); await ctx.close(); }
  console.log(JSON.stringify({ pass: true, sizes: results, screenshots: output }));
} finally { await browser?.close(); proc?.kill(); console.log('Cleanup target:', project); rmSync(project, { recursive: true, force: true }); }
