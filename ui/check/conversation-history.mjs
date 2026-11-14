// Real-browser check for the history of a named conversation, against the synthetic Claude Code CLI and a fake one-off provider (no model, no live call):
//  (a) a conversation made on note A with two questions: after a page reload both questions and both replies are visible;
//  (b) opening note B shows the same history, and the replies asked on A are labelled A;
//  (c) a question asked on B appears in the same conversation, labelled B;
//  (d) a second conversation starts empty, and choosing the first again brings its whole history back, in order, from the other note;
//  (e) a one-off chat stays per note: only that note's own one-off history, never a conversation's replies;
//  (f) Delete conversation works from another note and leaves each note's one-off history alone.
// Run after `vite build`: BATCH2A_OUTPUT=<folder outside the repo> node check/conversation-history.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { Store } from '../server/store.ts';
import { NoteWatcher } from '../server/watch.ts';
import { createApp } from '../server/http.ts';
import { FakeChatProvider } from '../server/chat/fake.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const output = process.env.BATCH2A_OUTPUT || process.env.GROVE_OUTPUT;
if (!output || path.resolve(output).toLowerCase().startsWith(path.resolve(here, '..', '..').toLowerCase())) throw new Error('Set BATCH2A_OUTPUT to a folder outside the repository.');
await mkdir(output, { recursive: true });
const tmp = (n) => mkdtemp(path.join(os.tmpdir(), n));
const notebook = await tmp('aitiarch-convhist-nb-'), harness = await tmp('aitiarch-convhist-h-'), scratch = await tmp('aitiarch-convhist-s-');
const scenarioFile = path.join(scratch, 'scenario.txt'), record = path.join(scratch, 'calls.jsonl');
const PLAN = '# Plan\n\nA unique sentence for the session.\n\n## Risks\n\nThe risk is the second paragraph.\n', IDEAS = '# Ideas\n\nOne idea only.\n';
execFileSync('git', ['init', '-q'], { cwd: notebook }); await writeFile(path.join(notebook, '.gitignore'), '/chat/\n');
await writeFile(path.join(notebook, 'plan.md'), PLAN); await writeFile(path.join(notebook, 'ideas.md'), IDEAS); await writeFile(scenarioFile, 'ok');
const provider = new FakeChatProvider();
const store = await Store.open(notebook), watcher = new NoteWatcher(store);
const app = createApp({ store, watcher, distDir: path.join(here, '../dist'), provider, harness: { command: process.execPath, prefixArgs: [path.join(here, '..', 'test', 'fixtures', 'harness-cli.mjs'), '@' + scenarioFile, record], dir: harness } });
const browser = await (async () => { for (const channel of ['msedge', 'chrome']) { try { return await chromium.launch({ channel, headless: true }); } catch { /* next */ } } throw new Error('Edge or Chrome is required.'); })();
const external = [], errors = [];
try {
  const url = `http://127.0.0.1:${await app.listen(0)}/?debug=1`, context = await browser.newContext({ viewport: { width: 1440, height: 900 } }), page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on('request', (r) => { if (!r.url().startsWith('http://127.0.0.1') && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) external.push(r.url()); });
  page.on('pageerror', (e) => errors.push(e.message));
  const panel = page.locator('#chat-panel');
  const openNote = async (file) => { for (let attempt = 0; ; attempt++) { await page.keyboard.press('Control+k'); const palette = page.getByRole('dialog', { name: 'Command palette' }); await palette.waitFor(); const search = palette.getByRole('textbox'); await search.fill('Jump to note: ' + file); await search.press('Enter'); try { await page.waitForFunction((f) => window.__aitiarch?.[f] && document.querySelector('.tab.on')?.textContent?.toLowerCase().includes(f.replace('.md', '')), file, { timeout: 6000 }); return; } catch (e) { if (attempt >= 2) throw e; await page.keyboard.press('Escape'); } } };
  const text = async (loc) => (await loc.innerText()).replace(/\s+/g, ' ').trim();
  const asked = () => panel.locator('.chat-turn .chat-you').evaluateAll((els) => els.map((e) => e.querySelector('p')?.textContent.trim()));
  const chipLabels = () => panel.locator('.chat-turn').evaluateAll((els) => els.map((e) => e.querySelector('.claim-chip .claim-label')?.textContent.trim() ?? null));
  const turns = () => panel.locator('.chat-turn').count();
  const picker = () => text(panel.locator('.chat-pick-trigger .chat-pick-value'));
  const waitTurns = (n) => page.waitForFunction((k) => document.querySelectorAll('#chat-panel .chat-turn').length === k, n);
  const ask = async (question) => { const c = panel.getByRole('textbox', { name: 'Message Aitiarch AI' }); await c.fill(question); await c.press('Enter'); const review = panel.getByRole('region', { name: 'What will be sent' }); await review.waitFor(); const before = await panel.locator('.chat-ai:not(.chat-streaming) .chat-add').count(); await review.getByRole('button', { name: 'Send', exact: true }).click(); await page.waitForFunction((n) => document.querySelectorAll('#chat-panel .chat-ai:not(.chat-streaming) .chat-add').length > n, before); };
  const choose = async (name) => { await panel.locator('.chat-pick-trigger').click(); await panel.locator('.chat-pick-opt', { hasText: name }).click(); };
  const newConversation = async () => { await panel.locator('.chat-pick-trigger').click(); await panel.getByRole('button', { name: 'New', exact: true }).click(); };
  const openChat = async () => { await page.getByRole('button', { name: /^Chat/ }).click(); await panel.waitFor(); await page.waitForFunction(() => { const t = document.querySelector('.chat-composer textarea'); return t && !t.disabled; }); };
  const api = (u) => page.evaluate((x) => fetch(x).then((r) => r.json()), u);

  await page.goto(url); await page.waitForSelector('.cm-editor'); await openNote('plan.md'); await openChat();

  // (a) A conversation on plan with two questions; reload; both questions and both replies are there.
  await newConversation(); await page.waitForFunction(() => /Conversation 1/.test(document.querySelector('#chat-panel .chat-pick-trigger')?.textContent ?? ''));
  await ask('First question on plan'); await ask('Second question on plan');
  assert.deepEqual(await asked(), ['First question on plan', 'Second question on plan']);
  // The replies of this conversation are rewritten the way an older version saved them: with no session id. They are still found by the ids of the conversation's kept questions.
  const chatFile = path.join(notebook, 'chat', 'plan.md.chat.json'), doc = JSON.parse(await readFile(chatFile, 'utf8')); for (const m of doc.messages) delete m.session; await writeFile(chatFile, JSON.stringify(doc, null, 2) + '\n');
  await page.reload(); await page.waitForFunction(() => document.querySelector('.cm-editor') && window.__aitiarch); await openNote('plan.md'); await openChat();
  await page.waitForFunction(() => document.querySelectorAll('#chat-panel .chat-turn').length > 0 || /One-off/.test(document.querySelector('#chat-panel .chat-pick-trigger')?.textContent ?? ''));
  await page.waitForTimeout(500);
  const afterReload = { picker: await picker(), turns: await turns(), asked: await asked() };
  console.log('after reload:', JSON.stringify(afterReload));
  assert.match(afterReload.picker, /^First question on plan/, 'the conversation is still the one chosen after a reload, named after its first question');
  assert.deepEqual(afterReload.asked, ['First question on plan', 'Second question on plan'], 'both questions are shown after a reload, not "Question unavailable after reload"');
  assert.equal(await panel.locator('.chat-ai:not(.chat-streaming)').count(), 2, 'and both replies');
  assert.equal(await panel.getByText('Question unavailable after reload.').count(), 0);
  await page.screenshot({ path: path.join(output, 'conversation-history-reload.png') });

  // (b) Another note: the same history, in the same order; the replies asked on plan are labelled plan.
  await openNote('ideas.md'); await page.waitForTimeout(400);
  assert.deepEqual(await asked(), ['First question on plan', 'Second question on plan'], 'the same history on another note');
  assert.deepEqual(await chipLabels(), ['plan', 'plan'], 'the replies asked on plan are labelled plan');
  assert.match(await picker(), /^First question on plan/);

  // (c) Ask on ideas: the new turn is in the same conversation, labelled ideas.
  await ask('Question on ideas'); await waitTurns(3);
  assert.deepEqual(await asked(), ['First question on plan', 'Second question on plan', 'Question on ideas']);
  assert.deepEqual(await chipLabels(), ['plan', 'plan', 'ideas']);
  const history = await api('/api/harness/sessions/history?id=' + (await api('/api/harness/sessions?path=plan.md&mode=chat')).sessions[0].id);
  assert.equal(history.messages.length, 3, 'the server returns the conversation by id'); assert.deepEqual(history.messages.map((m) => m.askedOn ?? null), [null, null, 'ideas.md']);

  // (d) A second conversation, made on ideas: empty. The first one is still in the list, and choosing it brings its whole history back.
  await newConversation(); await page.waitForFunction(() => /Conversation 2/.test(document.querySelector('#chat-panel .chat-pick-trigger')?.textContent ?? ''));
  await waitTurns(0); assert.equal(await panel.locator('.chat-empty').count(), 1, 'the new conversation shows no messages');
  assert.deepEqual(await asked(), []);
  await choose('First question on plan'); await waitTurns(3);
  assert.deepEqual(await asked(), ['First question on plan', 'Second question on plan', 'Question on ideas'], 'the first conversation\'s whole history returns, in order, from another note');
  assert.match(await picker(), /^First question on plan · 3 messages/);
  await choose('Conversation 2'); await waitTurns(0);
  await ask('Only question in two'); assert.deepEqual(await asked(), ['Only question in two']);
  // A third conversation on the same note as the second: the panel changes to its empty history at once, and the second one's message returns when it is chosen again.
  await newConversation(); await page.waitForFunction(() => /Conversation 3/.test(document.querySelector('#chat-panel .chat-pick-trigger')?.textContent ?? '')); await waitTurns(0); assert.deepEqual(await asked(), []);
  await choose('Only question in two'); await waitTurns(1); assert.deepEqual(await asked(), ['Only question in two']);
  await choose('First question on plan'); await waitTurns(3);

  // (e) One-off chats stay per note: only that note's own history, never a conversation's replies.
  await choose('One-off'); await waitTurns(0); assert.equal(await panel.locator('.chat-empty').count(), 1, 'the one-off chat of ideas has no history yet');
  await ask('One-off on ideas'); assert.deepEqual(await asked(), ['One-off on ideas']);
  await openNote('plan.md'); await waitTurns(0); await ask('One-off on plan'); assert.deepEqual(await asked(), ['One-off on plan'], 'plan\'s one-off chat holds only its own message, though its chat file also holds a conversation\'s replies');
  await openNote('ideas.md'); await page.waitForFunction(() => /On ideas$/.test(document.querySelector('#chat-panel .chat-head h2')?.textContent ?? '')); await waitTurns(1);
  assert.deepEqual(await asked(), ['One-off on ideas'], 'and ideas\' one-off chat its own');
  await openNote('plan.md'); await waitTurns(1); assert.deepEqual(await asked(), ['One-off on plan']);

  // (f) Delete works from another note, and leaves each note's one-off history alone.
  await openNote('ideas.md'); await choose('First question on plan'); await waitTurns(3);
  await panel.locator('.chat-pick-trigger').click(); await panel.locator('.chat-pick-actions').getByRole('button', { name: 'Delete' }).click();
  const confirm = panel.locator('.chat-sessions-delete'); await confirm.waitFor(); await page.waitForFunction(() => !document.querySelector('#chat-panel .chat-sessions-delete button')?.disabled);
  assert.match(await text(confirm), /started on plan\. 3 saved replies/);
  await confirm.getByRole('button', { name: 'Delete', exact: true }).click(); await confirm.waitFor({ state: 'detached' });
  await page.waitForFunction(() => /One-off/.test(document.querySelector('#chat-panel .chat-pick-trigger')?.textContent ?? ''));
  await waitTurns(1); assert.deepEqual(await asked(), ['One-off on ideas']);
  assert.equal((await api('/api/chat?path=plan.md')).messages.length, 1, 'only plan\'s one-off reply is left in its chat file');
  assert.equal((await api('/api/harness/sessions?path=plan.md&mode=chat&all=1')).sessions.length, 2, 'and the other two conversations are left');

  // A conversation that is gone (here a stale choice kept by this tab) is dropped with a word, and the panel falls back to the one-off chat of the open note.
  await page.evaluate(() => sessionStorage.setItem('aitiarch.chat.conversation', JSON.stringify({ id: '00000000-0000-4000-8000-000000000000', home: 'plan.md' })));
  await page.reload(); await page.waitForFunction(() => document.querySelector('.cm-editor') && window.__aitiarch); await openNote('plan.md'); await openChat();
  await panel.locator('.chat-notice').waitFor(); assert.match(await text(panel.locator('.chat-notice')), /no longer exists/);
  await page.waitForFunction(() => /One-off/.test(document.querySelector('#chat-panel .chat-pick-trigger')?.textContent ?? ''));
  assert.equal(await page.evaluate(() => sessionStorage.getItem('aitiarch.chat.conversation')), null, 'and it is no longer remembered');

  assert.equal(errors.length, 0, 'no page error: ' + errors.join('; '));
  assert.equal(external.length, 0, 'no network request left the machine: ' + external.join(', '));
  console.log('conversation-history: ok');
  await context.close();
} finally { watcher.stop(); await app.close(); await browser.close(); }
