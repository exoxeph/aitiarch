// Chat sends a real message through the REAL provider code (spawn, stream parser, isolation canary) against a fake Claude CLI:
//  1. a CLI that emits what the installed Claude CLI really emits with partial messages (a status event, a thinking block) gets its reply streamed;
//  2. a failing CLI shows a specific reason in words, not the one generic sentence.
// Synthetic note, fake CLI, no live provider call. Run: BATCH2A_OUTPUT=<dir outside the repo> node check/chat-send.mjs   (after `vite build`)
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { Store } from '../server/store.ts';
import { NoteWatcher } from '../server/watch.ts';
import { createApp } from '../server/http.ts';
import { createProvider } from '../server/providers/index.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(process.env.BATCH2A_OUTPUT ?? '');
assert(process.env.BATCH2A_OUTPUT && !out.toLowerCase().startsWith(path.resolve(here, '..', '..').toLowerCase()), 'Output must be outside repo');
const script = path.join(here, '..', 'test', 'fixtures', 'provider-cli.mjs');
const GENERIC = 'Claude could not complete this request. No retry was made.';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const external = [];

async function inApp(scenario, run) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aitiarch-chat-send-'));
  await writeFile(path.join(root, 'fixture.md'), '# Chat fixture\n\nA unique selected sentence.\n');
  const provider = createProvider({ provider: 'claude', contract: 'claude-canary-2.1.205', command: process.execPath, prefixArgs: [script, scenario, path.join(root, 'record'), 'claude'], failureLog: { write: async () => {} } });
  const store = await Store.open(root), watcher = new NoteWatcher(store), app = createApp({ store, watcher, distDir: path.join(here, '../dist'), provider });
  try {
    const url = `http://127.0.0.1:${await app.listen(0)}/?debug=1`;
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } }), page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on('request', r => { if (!r.url().startsWith('http://127.0.0.1') && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) external.push(r.url()); });
    await page.goto(url); await page.waitForSelector('.cm-editor');
    const panel = page.locator('#chat-panel');
    await page.getByRole('button', { name: /^Chat/ }).click(); await panel.waitFor();
    await page.waitForFunction(() => { const t = document.querySelector('.chat-composer textarea'); return t && !t.disabled; });
    const composer = panel.getByRole('textbox', { name: 'Message Aitiarch AI' });
    await composer.fill('What does the fixture say?'); await composer.press('Enter');
    const review = panel.getByRole('region', { name: 'What will be sent' }); await review.waitFor();
    await review.getByRole('button', { name: 'Send', exact: true }).click();
    await run({ page, panel });
    await context.close();
  } finally { watcher.stop(); await app.close(); await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
}

try {
  // 1. The reply streams in, even though the CLI sends a status event and a thinking block first.
  // The second CLI sends the thinking delta the way the real one does on the owner's machine: with a signature, an index and counters.
  for (const ok of ['verified-chat-real-stream', 'verified-chat-thinking-extras']) await inApp(ok, async ({ page, panel }) => {
    const reply = panel.locator('.chat-ai').last();
    // First the text streams in plainly (with a Stop button); when the reply is complete it is formatted and offers Add to note.
    await page.waitForFunction(() => /real-shape reply/.test(document.querySelector('#chat-panel .chat-ai')?.textContent ?? ''));
    await panel.locator('.chat-ai:not(.chat-streaming) .chat-add').waitFor();
    const shown = (await reply.innerText()).replace(/\s+/g, ' ');
    assert.match(shown, /Synthetic real-shape reply\./, `the streamed reply is on the page (saw: ${shown.slice(0, 120)})`);
    assert.equal(await panel.locator('.chat-error').count(), 0, 'no error is shown');
    assert(!(await panel.innerText()).includes('could not complete'), 'and nothing says the call failed');
    assert(!(await panel.innerText()).includes('private reasoning'), 'the model\'s private reasoning never reaches the page');
    assert(!(await page.content()).includes('SECRET-THINKING-TEXT-42'), 'thinking text is nowhere on the page, not even hidden');
    await page.screenshot({ path: path.join(out, `chat-send-ok-${ok}.png`) });
  });

  // 2. Failures say why, in words, and keep "No retry was made." and Dismiss.
  const failing = [
    ['verified-chat-flag-rejected', [/--include-partial-messages/, /does not accept/i]],
    ['verified-chat-login', [/sign in|log in/i]],
    ['verified-chat-exit', [/exit code 3/, /boom: something broke/]],
    ['verified-chat-unknown-event', [/shape Aitiarch expects/, /brand_new_kind/]],
  ];
  for (const [scenario, patterns] of failing) {
    await inApp(scenario, async ({ page, panel }) => {
      const error = panel.locator('.chat-error'); await error.waitFor();
      const text = (await error.innerText()).replace(/\s+/g, ' ');
      assert.notEqual(text.replace(/\s*Dismiss\s*$/, '').trim(), GENERIC, `${scenario}: not the generic sentence`);
      for (const p of patterns) assert.match(text, p, `${scenario}: says why (${p})`);
      assert(text.includes('No retry was made.'), `${scenario}: keeps "No retry was made."`);
      assert(!/someone|supersecretvalue|private\\x/.test(text), `${scenario}: no paths or key-like values`);
      assert(!text.includes('volunteer picnic'), `${scenario}: no prompt text`);
      assert.equal(await error.getByRole('button', { name: 'Dismiss' }).count(), 1, `${scenario}: Dismiss is still there`);
      await page.screenshot({ path: path.join(out, `chat-send-${scenario}.png`) });
      await error.getByRole('button', { name: 'Dismiss' }).click();
      assert.equal(await panel.locator('.chat-error').count(), 0, `${scenario}: Dismiss clears it`);
    });
  }
  assert.deepEqual(external, [], 'no request left this machine');
  console.log(JSON.stringify({ passed: true, scenarios: ['verified-chat-real-stream', 'verified-chat-thinking-extras', ...failing.map(f => f[0])] }, null, 1));
} finally { await browser.close(); }
