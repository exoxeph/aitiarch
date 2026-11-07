// Synthetic fixture only. No installed CLI, login, transcript or real notebook.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, mkdir, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { Store } from '../server/store.ts';
import { NoteWatcher } from '../server/watch.ts';
import { createApp } from '../server/http.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = await mkdtemp(path.join(os.tmpdir(), 'aitiarch-invoked-browser-'));
const note = '# Disposable fixture\n\nA unique selected sentence.\n\nA removable selected sentence.\n\nThe ending.\n';
const bytes = Buffer.from('\uFEFF' + note.replace(/\n/g, '\r\n'));
await writeFile(path.join(root, 'fixture.md'), bytes);
const calls = [], pending = [];
const store = await Store.open(root), watcher = new NoteWatcher(store);
const app = createApp({ store, watcher, distDir: path.join(here, '../dist'), provider: {
  checkAvailability: async () => ({ available: true }),
  invoke: async request => new Promise(resolve => { calls.push(request); pending.push(() => resolve({ id: request.id,
    provider: 'claude', model: null, answer: `Synthetic answer ${calls.length}.`, claims: [], usage: { inputTokens: 30, outputTokens: 5 } })); }),
} });
let browser;
try {
  const url = `http://127.0.0.1:${await app.listen(0)}/?debug=1`;
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 850 } });
  page.setDefaultTimeout(6000);
  await page.goto(url); await page.waitForSelector('.cm-editor');
  const select = async quote => page.evaluate(q => {
    const { view } = window.__aitiarch['fixture.md'], from = view.state.doc.toString().indexOf(q);
    view.dispatch({ selection: { anchor: from, head: from + q.length } }); view.focus();
  }, quote);
  await select('A unique selected sentence.');
  await page.getByRole('button', { name: 'Think on this', exact: true }).click({ timeout: 3000 });
  await page.getByRole('button', { name: 'Send to Claude', exact: true }).waitFor();
  assert.equal(calls.length, 0, 'preview must not call a provider');
  await page.getByRole('button', { name: 'Send to Claude', exact: true }).click();
  await page.waitForFunction(() => !!document.querySelector('[data-request-status="pending"]'));
  assert.equal(calls[0].selection, 'A unique selected sentence.');
  await page.evaluate(() => window.__aitiarch['fixture.md'].view.dispatch({ changes: { from: 0, insert: 'Typed while loading.\n\n' } }));
  pending.shift()(); await page.getByText('Synthetic answer 1.', { exact: true }).first().waitFor();
  await page.waitForFunction(() => window.__aitiarch['fixture.md'].session.status === 'saved');
  let ink = JSON.parse(await readFile(path.join(root, 'ink/fixture.ink.json'), 'utf8'));
  assert.equal(ink.items[0].originalAnchor.quote, 'A unique selected sentence.');
  assert.equal(ink.items[0].attachment.from, note.indexOf('A unique') + 22);
  assert.equal(calls[0].note, note, 'outbound note must stay frozen');
  let after = await readFile(path.join(root, 'fixture.md'));
  assert.equal(after.toString('utf8'), '\uFEFFTyped while loading.\r\n\r\n' + note.replace(/\n/g, '\r\n'));
  await select('A removable selected sentence.');
  await page.getByRole('button', { name: 'Ask...', exact: true }).click();
  await page.getByLabel('Question for Claude').fill('Explain this selection.');
  await page.getByRole('button', { name: 'Review request', exact: true }).click();
  await page.getByRole('button', { name: 'Send to Claude', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('[data-request-status="pending"]').length === 1);
  await page.evaluate(() => {
    const { view } = window.__aitiarch['fixture.md'], t = view.state.doc.toString(), q = 'A removable selected sentence.';
    const from = t.indexOf(q); view.dispatch({ changes: { from, to: from + q.length, insert: '' } });
  });
  pending.shift()();
  await page.getByRole('button', { name: /^Activity/ }).click();
  await page.getByRole('region', { name: 'Orphaned ink' }).getByText('Synthetic answer 2.', { exact: true }).waitFor();
  await page.waitForFunction(() => window.__aitiarch['fixture.md'].session.status === 'saved');
  ink = JSON.parse(await readFile(path.join(root, 'ink/fixture.ink.json'), 'utf8'));
  assert.equal(ink.items[1].attachment.status, 'orphaned');
  assert.equal(ink.items[1].body, 'Synthetic answer 2.');
  await page.reload(); await page.waitForSelector('.cm-editor');
  console.log('invoked check: reload reached');
  await page.getByRole('button', { name: /^Activity/ }).click();
  await page.getByRole('region', { name: 'Orphaned ink' }).getByText('Synthetic answer 2.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Dismiss answer', exact: true }).first().click();
  console.log('invoked check: dismissal reached');
  await page.waitForTimeout(400);
  const ledger = JSON.parse(await readFile(path.join(root, 'ledger.json'), 'utf8'));
  assert(ledger.events.some(e => e.event === 'shown'));
  assert(ledger.events.some(e => e.event === 'dismissed'));
  assert(!JSON.stringify(ledger).includes('Synthetic answer'));
  assert.equal(calls.length, 2);
  // Keyboard path opens the same frozen preview and never sends by itself.
  await select('The ending.'); await page.keyboard.press('Control+Enter');
  console.log('invoked check: keyboard reached');
  await page.getByRole('button', { name: 'Send to Claude', exact: true }).waitFor();
  assert.equal(calls.length, 2);
  // Duplicate after capture but before submission: the browser knows the exact
  // edit identity even where a fresh disk-only diff cannot prove it.
  const originalFrom = await page.evaluate(() => {
    const { view } = window.__aitiarch['fixture.md'], t = view.state.doc.toString(), q = 'The ending.', from = t.indexOf(q);
    view.dispatch({ changes: { from: from + q.length, insert: '\n' + q } }); return from;
  });
  await page.getByRole('button', { name: 'Send to Claude', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('[data-request-status="pending"]').length === 1);
  pending.shift()(); await page.getByText('Synthetic answer 3.', { exact: true }).first().waitFor();
  await page.waitForTimeout(700);
  ink = JSON.parse(await readFile(path.join(root, 'ink/fixture.ink.json'), 'utf8'));
  assert.deepEqual(ink.items.find(i => i.id === calls[2].id).attachment,
    { status: 'attached', from: originalFrom, to: originalFrom + 'The ending.'.length }, 'browser identity must persist after a preview-time duplication');
  await page.reload(); await page.waitForSelector('.cm-editor');
  await page.getByText('Synthetic answer 3.', { exact: true }).first().waitFor();
  await select('A unique selected sentence.'); await page.keyboard.press('Control+Enter');
  await page.getByRole('button', { name: 'Send to Claude', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('[data-request-status="pending"]').length === 1);
  const lockPath = path.join(root, 'ink/fixture.ink.json.lock'); await writeFile(lockPath, 'Synthetic lock');
  pending.shift()();
  try { await page.getByRole('button', { name: 'Retry saving answer (no new call)', exact: true }).waitFor(); }
  catch (e) {
    console.log('retry diagnostic', await page.evaluate(async id => ({ status: await (await fetch('/api/assistance/status?id=' + id)).json(),
      controls: [...document.querySelectorAll('.invocation-job')].map(e => e.textContent), notices: [...document.querySelectorAll('.notice')].map(e => e.textContent) }), calls[3].id));
    throw e;
  }
  await page.reload(); await page.waitForSelector('.cm-editor');
  await page.getByRole('button', { name: 'Retry saving answer (no new call)', exact: true }).waitFor();
  await unlink(lockPath);
  await page.getByRole('button', { name: 'Retry saving answer (no new call)', exact: true }).click();
  await page.getByText('Synthetic answer 4.', { exact: true }).first().waitFor();
  assert.equal(calls.length, 4, 'reload and save-only retry must not call inference again');
  after = await readFile(path.join(root, 'fixture.md'));
  assert(after.toString('utf8').startsWith('\uFEFFTyped while loading.\r\n\r\n'));
  await mkdir(path.join(here, 'out'), { recursive: true });
  await page.screenshot({ path: path.join(here, 'out/invoked-wide.png'), fullPage: true });
  await page.setViewportSize({ width: 620, height: 850 });
  await page.screenshot({ path: path.join(here, 'out/invoked-narrow.png'), fullPage: true });
  console.log(JSON.stringify({ passed: true, calls: calls.length, provider: 'fake only', checks: ['toolbar', 'Ctrl+Enter', 'Ask', 'preview-no-call', 'frozen selection',
    'typing while loading', 'delayed mapping', 'preview-time duplication persisted', 'orphan preservation', 'reload', 'save-only retry after reload', 'shown/dismissed ledger', 'BOM+CRLF preserved', 'wide/narrow'] }));
} finally { await browser?.close(); await app.close(); await rm(root, { recursive: true, force: true }); }
