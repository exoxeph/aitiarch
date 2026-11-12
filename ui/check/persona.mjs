// The persona chosen in the app must reach the request each step sends. This drives the REAL app in a browser (the real switch, the real
// PUT /api/nodes, the real server and provider code) against a fake Claude CLI that records the prompt it receives, and asserts on that
// recording: for each of the three personas in the chat, switching back changes it again, and Think and Ask in the selection panel too.
// The project is not git-ignored, so the setting is only kept for the session (persisted:false). Synthetic note, fake CLI, no live call.
// Run: BATCH2A_OUTPUT=<dir outside the repo> node check/persona.mjs   (after `vite build`)
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { Store } from '../server/store.ts';
import { NoteWatcher } from '../server/watch.ts';
import { createApp } from '../server/http.ts';
import { createProvider } from '../server/providers/index.ts';
import { PERSONAS } from '../shared/persona.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(process.env.BATCH2A_OUTPUT ?? '');
assert(process.env.BATCH2A_OUTPUT && !out.toLowerCase().startsWith(path.resolve(here, '..', '..').toLowerCase()), 'Output must be outside repo');
const script = path.join(here, '..', 'test', 'fixtures', 'provider-cli.mjs');
const NOTE = '# Persona fixture\n\nA unique selected sentence.\n';
const root = await mkdtemp(path.join(os.tmpdir(), 'aitiarch-persona-'));
await writeFile(path.join(root, 'fixture.md'), NOTE);
const promptFile = path.join(root, 'record.prompt');
const provider = createProvider({ provider: 'claude', contract: 'claude-canary-2.1.205', command: process.execPath, prefixArgs: [script, 'verified-chat-record', path.join(root, 'record'), 'claude'], failureLog: { write: async () => {} } });
const store = await Store.open(root), watcher = new NoteWatcher(store), app = createApp({ store, watcher, distDir: path.join(here, '../dist'), provider });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
// The start of each persona's own text: enough to tell them apart without copying the whole paragraph.
const MARK = Object.fromEntries(Object.entries(PERSONAS).map(([k, v]) => [k, v.instruction.slice(0, 48)]));
const LABEL = { plan: 'Plan with me', grill: 'Grill me', explain: 'Explain' };
// What the CLI received on the latest send: wait for a recording newer than `after`, then read it.
const recorded = async (after) => {
  for (let i = 0; i < 200; i++) {
    try { if ((await stat(promptFile)).mtimeMs > after) return JSON.parse(await readFile(promptFile, 'utf8')); } catch { /* not written yet */ }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('the fake CLI never recorded a new prompt');
};
const personasIn = (instruction) => Object.keys(MARK).filter(k => instruction.includes(MARK[k]));
try {
  const url = `http://127.0.0.1:${await app.listen(0)}/?debug=1`;
  const context = await browser.newContext({ viewport: { width: 1500, height: 950 } }), page = await context.newPage();
  page.setDefaultTimeout(15000);
  await page.goto(url); await page.waitForSelector('.cm-editor');

  // ---- Chat: each persona, then back to the first.
  await page.getByRole('button', { name: /^Chat/ }).click();
  const panel = page.locator('#chat-panel');
  await panel.waitFor();
  await page.waitForFunction(() => { const t = document.querySelector('.chat-composer textarea'); return t && !t.disabled; });
  const composer = panel.getByRole('textbox', { name: 'Message Aitiarch AI' });
  let sent = 0;
  const chatWith = async (persona) => {
    await panel.locator('.persona-switch').getByRole('radio', { name: LABEL[persona] }).check();
    // The choice is saved on the server (in memory here: not git-ignored) before it can matter.
    await page.waitForFunction(async (p) => (await (await fetch('/api/nodes')).json()).nodes.chat.persona === p, persona);
    const before = Date.now();
    await composer.fill(`Summarise this note, message ${++sent}.`); await composer.press('Enter');
    if (sent === 1) { // the first message shows the review card; after "don't ask again" later messages send straight away
      const review = panel.getByRole('region', { name: 'What will be sent' }); await review.waitFor();
      await review.getByLabel(/ask again this session/i).check();
      await review.getByRole('button', { name: 'Send', exact: true }).click();
    }
    await panel.locator('.chat-ai:not(.chat-streaming) .chat-add').nth(sent - 1).waitFor();
    const got = await recorded(before);
    assert.deepEqual(personasIn(got.instruction), [persona], `chat with ${LABEL[persona]}: only that persona's text is in the request (found ${personasIn(got.instruction)})`);
    // Honest display (stage 5). The fake CLI always answers with one plain sentence and no question: that breaks Grill me's and Plan with me's contract, not Explain's.
    const reply = panel.locator('.chat-ai:not(.chat-streaming)').nth(sent - 1), notice = reply.locator('.chat-contract');
    assert.match(await reply.innerText(), /Synthetic recorded reply\./, `${LABEL[persona]}: the reply is shown as written`);
    if (persona === 'explain') assert.equal(await notice.count(), 0, 'Explain: nothing to flag for a short reply');
    else {
      await notice.waitFor(); assert.match(await notice.innerText(), new RegExp(`Not what ${LABEL[persona]} asks for: it does not end with a question\\.`), `${LABEL[persona]}: a plain line says what is wrong`);
      assert.equal(await notice.getByRole('button', { name: 'Ask again' }).count(), 1, `${LABEL[persona]}: one Ask again button`);
    }
  };
  for (const p of ['grill', 'explain', 'plan', 'grill']) await chatWith(p);
  {
    // The last reply (Grill me) broke its contract. Nothing resends by itself; Ask again goes through the normal review, then the same question is asked as a new message.
    const promptMtime = (await stat(promptFile)).mtimeMs; await page.waitForTimeout(1200);
    assert.equal((await stat(promptFile)).mtimeMs, promptMtime, 'no silent retry: the CLI was not called again');
    const reviewed = page.waitForRequest((r) => r.url().includes('/api/chat/review'));
    await panel.locator('.chat-ai:not(.chat-streaming)').nth(sent - 1).getByRole('button', { name: 'Ask again' }).click(); await reviewed;
    await panel.locator('.chat-ai:not(.chat-streaming) .chat-add').nth(sent).waitFor(); sent++;
    assert.equal(await panel.locator('.chat-you').count(), sent, 'Ask again added a new message; the old reply is still there');
    assert.equal(await panel.locator('.chat-ai:not(.chat-streaming) .chat-contract').count(), 4, 'the four broken replies (3x Grill me, Plan with me) are all still flagged, including the new one');
  }
  await page.screenshot({ path: path.join(out, 'persona-chat.png') });

  // ---- Think and Ask from the selection panel use their own persona (the chat's choice does not leak into them).
  const select = (q) => page.evaluate((text) => { const { view } = window.__aitiarch['fixture.md'], from = view.state.doc.toString().indexOf(text);
    view.dispatch({ selection: { anchor: from, head: from + text.length } }); view.focus(); }, q);
  const invoke = async (button, persona) => {
    await select('A unique selected sentence.');
    await page.getByRole('button', { name: button, exact: true }).click();
    if (button === 'Ask...') { await page.getByLabel('Question for Claude').fill('Why this sentence?'); await page.getByRole('button', { name: 'Review request', exact: true }).click(); }
    await page.getByRole('button', { name: 'Send to Claude', exact: true }).waitFor();
    await page.locator('.invocation-review .persona-switch').getByRole('radio', { name: LABEL[persona] }).check();
    await page.waitForTimeout(700); // the panel re-reviews with the new persona
    const before = Date.now();
    await page.getByRole('button', { name: 'Send to Claude', exact: true }).click();
    const got = await recorded(before);
    assert.deepEqual(personasIn(got.instruction), [persona], `${button} with ${LABEL[persona]}: only that persona's text is in the request (found ${personasIn(got.instruction)})`);
    await page.waitForTimeout(500);
  };
  await invoke('Think on this', 'grill');
  await invoke('Ask...', 'explain');
  await page.screenshot({ path: path.join(out, 'persona-selection.png') });
  console.log(JSON.stringify({ passed: true, chatMessages: sent }, null, 1));
} finally { await browser.close(); watcher.stop(); await app.close(); await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
