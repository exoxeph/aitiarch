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
import { createProvider, prepareRequest } from '../server/providers/index.ts';

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
  // The real provider code, wrapped only to record exactly what it would send to the CLI (prepareRequest is the function invoke() calls).
  const captured = [];
  const real = createProvider({ provider: 'claude', contract: 'claude-canary-2.1.205', command: process.execPath, prefixArgs: [script, scenario, path.join(root, 'record'), 'claude'], failureLog: { write: async () => {} } });
  const provider = { name: real.name, checkAvailability: real.checkAvailability, invoke: (r, o) => { captured.push(prepareRequest(r)); return real.invoke(r, o); } };
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
    await run({ page, panel, captured });
    await context.close();
  } finally { watcher.stop(); await app.close(); await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
}

try {
  // 1. The reply streams in, even though the CLI sends a status event and a thinking block first.
  // The second CLI sends the thinking delta the way the real one does on the owner's machine: with a signature, an index and counters.
  for (const ok of ['verified-chat-real-stream', 'verified-chat-thinking-extras']) await inApp(ok, async ({ page, panel, captured }) => {
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
    // "This note" is on by default: the note text must be in the request that went to the provider.
    await panel.getByRole('button', { name: /^This note/ }).waitFor();
    assert.equal(captured.length, 1, 'one request reached the provider');
    assert(captured[0].data.note.includes('A unique selected sentence.'), 'the note text reached the provider');
    assert.match(captured[0].instruction, /"note" field of the data/, 'and the request says where the note is');
    assert.equal(await panel.locator('.chat-unstructured').count(), 0, 'a structured reply carries no unstructured label');
    await page.screenshot({ path: path.join(out, `chat-send-ok-${ok}.png`) });
  });

  // 1b. A reply in plain prose is shown, quietly labelled, with no claims; JSON the model wrapped in prose or a fence is extracted as a normal reply.
  await inApp('verified-chat-reply-prose', async ({ page, panel, captured }) => {
    await panel.locator('.chat-ai:not(.chat-streaming) .chat-add').waitFor();
    assert.match((await panel.locator('.chat-ai').last().innerText()).replace(/\s+/g, ' '), /budget is 40 dollars in one place and 60 in another/, 'the prose reply is shown');
    // This note is sent and the reply has no claims block: the reply says so in words, with Ask again (through the review).
    assert.match((await panel.locator('.chat-citation').innerText()).trim(), /^This reply did not say whether it used your note/, 'with the plain citation label');
    assert.equal(await panel.locator('.chat-citation').getByRole('button', { name: 'Ask again' }).count(), 1, 'and an Ask again button');
    assert.equal(await panel.locator('.chat-unstructured').count(), 0, 'and no unstructured label any more');
    assert.equal(await panel.locator('.chat-error').count(), 0, 'and it is not an error');
    await page.screenshot({ path: path.join(out, 'chat-send-citation-label.png') });
    // Ask again goes through the review like any message.
    await panel.locator('.chat-citation').getByRole('button', { name: 'Ask again' }).click();
    await panel.getByRole('region', { name: 'What will be sent' }).waitFor();
    assert.equal(captured.length, 1, 'Ask again sent nothing before the review');
  });
  for (const wrapped of ['verified-chat-reply-wrapped', 'verified-chat-reply-fenced']) await inApp(wrapped, async ({ panel }) => {
    await panel.locator('.chat-ai:not(.chat-streaming) .chat-add').waitFor();
    assert.match((await panel.locator('.chat-ai').last().innerText()).replace(/\s+/g, ' '), /Yes: 40 vs 60\./, `${wrapped}: the answer inside the JSON is shown`);
    assert.equal(await panel.locator('.chat-unstructured').count(), 0, `${wrapped}: and it is a normal structured reply, no label`);
  });

  // 2. Failures say why, in words, and keep "No retry was made." and Dismiss.
  const failing = [
    ['verified-chat-flag-rejected', [/--include-partial-messages/, /does not accept/i]],
    ['verified-chat-login', [/sign in|log in/i]],
    ['verified-chat-exit', [/exit code 3/, /boom: something broke/]],
    // An event kind Aitiarch has never seen is not fatal on its own; this CLI then ends without a reply, and the reason says so.
    ['verified-chat-unknown-event', [/shape Aitiarch expects/, /ended before it was complete/]],
    ['verified-chat-reply-takeaway', [/shape Aitiarch expects/, /wrong fields/]],
  ];
  // 2b. A CLI that adds an event kind Aitiarch has never seen, then answers: the reply arrives and no error is shown.
  await inApp('verified-chat-unknown-then-reply', async ({ panel }) => {
    await panel.locator('.chat-ai:not(.chat-streaming) .chat-add').waitFor();
    assert.match((await panel.locator('.chat-ai').last().innerText()).replace(/\s+/g, ' '), /Synthetic reply after a new event kind\./, 'the reply after an unknown event is shown');
    assert.equal(await panel.locator('.chat-error').count(), 0, 'and no error is shown');
  });
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
  console.log(JSON.stringify({ passed: true, scenarios: ['verified-chat-real-stream', 'verified-chat-thinking-extras', 'verified-chat-reply-prose', 'verified-chat-reply-wrapped', 'verified-chat-reply-fenced', 'verified-chat-unknown-then-reply', ...failing.map(f => f[0])] }, null, 1));
} finally { await browser.close(); }
