// Real-browser check for the single chat box (C2), against the synthetic Claude Code CLI (no model, no live call):
//  - "@" opens a picker of notes, repo files and "repo"; a pick becomes a removable chip; a file the server refuses says why on its chip, and nothing is sent;
//  - a notes-only turn in a conversation goes without a plan card (and tool-less);
//  - a turn on a note with diagrams shows the card once, and not again; attaching a file afterwards (an escalation) shows it again;
//  - one list holds conversations (named after their first question) and an investigation; rename still works;
//  - from send until the first text an elapsed-seconds line shows; the panel uses the width it has and keeps a readable line length.
// Run after `vite build`: BATCH2A_OUTPUT=<folder outside the repo> node check/conversation-box.mjs
import './config-isolation.mjs'; // first: an empty temp config folder, never the machine's real one
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { Store } from '../server/store.ts';
import { NoteWatcher } from '../server/watch.ts';
import { createApp } from '../server/http.ts';
import { FakeChatProvider } from '../server/chat/fake.ts';
import { DiagramImageStore } from '../server/diagram-image-store.ts';
import { makePng } from '../test/fixtures/png.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const output = process.env.BATCH2A_OUTPUT || process.env.GROVE_OUTPUT;
if (!output || path.resolve(output).toLowerCase().startsWith(path.resolve(here, '..', '..').toLowerCase())) throw new Error('Set BATCH2A_OUTPUT to a folder outside the repository.');
await mkdir(output, { recursive: true });
const tmp = (n) => mkdtemp(path.join(os.tmpdir(), n));
const notebook = await tmp('aitiarch-box-nb-'), repo = await tmp('aitiarch-box-repo-'), harness = await tmp('aitiarch-box-h-'), scratch = await tmp('aitiarch-box-s-');
const scenarioFile = path.join(scratch, 'scenario.txt'), record = path.join(scratch, 'calls.jsonl'), scenario = (s) => writeFile(scenarioFile, s);
execFileSync('git', ['init', '-q'], { cwd: notebook }); await writeFile(path.join(notebook, '.gitignore'), '/chat/\n'); await mkdir(path.join(notebook, 'assets'));
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200" width="400" height="200"><text x="20" y="60">Quillfern feeds Mossgate</text></svg>', base = 'diagram-' + createHash('sha256').update(svg).digest('hex');
await writeFile(path.join(notebook, 'assets', base + '.svg'), svg); await new DiagramImageStore(notebook).save(base + '.png', makePng(800, 400));
await writeFile(path.join(notebook, 'plan.md'), '# Plan\n\nA unique sentence for the session.\n');
await writeFile(path.join(notebook, 'ideas.md'), '# Ideas\n\nSome ideas.\n');
await writeFile(path.join(notebook, 'flow.md'), `# Flow\n\nThe pipeline below.\n\n> ![AI diagram: pipeline](assets/${base}.svg)\n`);
execFileSync('git', ['init', '-q'], { cwd: repo }); await mkdir(path.join(repo, 'src'));
await writeFile(path.join(repo, 'src', 'login.js'), 'const sessions = new Map();\n'); await writeFile(path.join(repo, 'big.log'), 'x'.repeat(300 * 1024)); // over the 256 KB cap: offered, then refused
execFileSync('git', ['add', '.'], { cwd: repo });
await scenario('ok');
const store = await Store.open(notebook), watcher = new NoteWatcher(store);
const app = createApp({ store, watcher, distDir: path.join(here, '../dist'), provider: new FakeChatProvider(), harness: { command: process.execPath, prefixArgs: [path.join(here, '..', 'test', 'fixtures', 'harness-cli.mjs'), '@' + scenarioFile, record], dir: harness } });
const browser = await (async () => { for (const channel of ['msedge', 'chrome']) { try { return await chromium.launch({ channel, headless: true }); } catch { /* next */ } } throw new Error('Edge or Chrome is required.'); })();
const external = [], errors = [], report = {};
const calls = async () => (await readFile(record, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const arg = (c, flag) => c.args[c.args.indexOf(flag) + 1];
try {
  const url = `http://127.0.0.1:${await app.listen(0)}/?debug=1`, context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' }), page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('request', (r) => { const u = new URL(r.url()); if (u.origin !== new URL(url).origin && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) external.push(r.url()); });
  page.on('pageerror', (e) => errors.push(e.message));
  const panel = page.locator('#chat-panel'), composer = () => panel.getByRole('textbox', { name: 'Message Aitiarch AI' });
  const text = async (loc) => (await loc.innerText()).replace(/\s+/g, ' ').trim();
  const call = (body, url2) => page.evaluate(async ([b, u]) => (await fetch(u, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Aitiarch': '1' }, body: JSON.stringify(b) })).json(), [body, url2]);
  const openNote = async (file) => { for (let attempt = 0; ; attempt++) { await page.keyboard.press('Control+k'); const palette = page.getByRole('dialog', { name: 'Command palette' }); await palette.waitFor(); const search = palette.getByRole('textbox'); await search.fill('Jump to note: ' + file); await search.press('Enter'); try { await page.waitForFunction((f) => window.__aitiarch?.[f] && document.querySelector('.tab.on')?.textContent?.toLowerCase().includes(f.replace('.md', '')), file, { timeout: 6000 }); return; } catch (e) { if (attempt >= 2) throw e; await page.keyboard.press('Escape'); } } };
  const ready = () => page.waitForFunction(() => { const t = document.querySelector('#chat-panel .chat-composer textarea'); return t && !t.disabled; });
  const done = () => page.evaluate(() => document.querySelectorAll('#chat-panel .chat-turn[data-status="complete"]').length);
  const settled = (n) => page.waitForFunction((k) => document.querySelectorAll('#chat-panel .chat-turn[data-status="complete"]').length > k, n);
  /** Types a question; then clicks Send on the review card when one is shown ("Don't ask again" ticked the first time). */
  let reviewed = false;
  const ask = async (q, { expectCard = false } = {}) => {
    await ready(); const before = await done(); await composer().fill(q); await composer().press('Enter');
    const card = panel.getByRole('group', { name: 'Plan for this conversation' }), review = panel.getByRole('region', { name: 'What will be sent' });
    await page.waitForFunction((k) => document.querySelector('#chat-panel .chat-plan') || document.querySelector('#chat-panel .chat-review') || document.querySelector('#chat-panel .chat-turn[data-status="streaming"]') || document.querySelectorAll('#chat-panel .chat-turn[data-status="complete"]').length > k, before);
    const showedCard = await card.count() > 0;
    assert.equal(showedCard, expectCard, `"${q}": the plan card ${expectCard ? 'is' : 'is not'} shown`);
    return { card, review, finish: async () => { if (await review.count()) { if (!reviewed) { await review.getByRole('checkbox').check(); reviewed = true; } await review.getByRole('button', { name: 'Send to Claude', exact: true }).click(); } await settled(before); } };
  };

  await page.goto(url); await page.waitForSelector('.cm-editor'); await openNote('plan.md');
  await page.getByRole('button', { name: /^Chat/ }).click(); await panel.waitFor(); await ready();
  await call({ repo }, '/api/harness/investigate/repo');
  // The panel uses the width it has (more than the old 380 px at 1440 px) and keeps a readable line length.
  const width = await panel.evaluate((p) => p.getBoundingClientRect().width); assert(width > 420, 'the panel is wider than before: ' + width);
  report.panelWidth = Math.round(width);
  assert.equal(await panel.getByRole('radio', { name: /^(Chat|Investigate)$/ }).count(), 0, 'no Chat/Investigate switch');

  // 1. "@" picks: a note and a file become chips; a chip can be removed; the typed "@..." leaves the draft.
  await composer().fill('Compare with @ide'); const at = panel.getByRole('listbox', { name: 'Attach a note, a file or the repo' }); await at.waitFor();
  await panel.locator('.chat-at [data-at="note:ideas.md"]').waitFor(); assert.equal(await panel.locator('.chat-at [data-at="note:plan.md"]').count(), 0, 'the open note is not offered: it is attached by default');
  await page.keyboard.press('Enter'); await panel.locator('[data-chip="note:ideas.md"]').waitFor(); assert.equal(await composer().inputValue(), 'Compare with ', 'only the "@ide" left the draft');
  await composer().fill('@src/lo'); await panel.locator('.chat-at [data-at="file:src/login.js"]').waitFor(); await panel.locator('.chat-at [data-at="file:src/login.js"]').click();
  await panel.locator('[data-chip="file:src/login.js"]').waitFor(); assert.match(await text(panel.locator('[data-chip="file:src/login.js"]')), /^File · src\/login\.js/);
  await composer().fill('@zzz-nothing'); await panel.locator('.chat-at-none').waitFor(); await page.keyboard.press('Escape'); await at.waitFor({ state: 'detached' });
  await panel.screenshot({ path: path.join(output, 'box-chips.png') });
  await panel.locator('[data-chip="file:src/login.js"]').getByRole('button', { name: /Remove/ }).click(); assert.equal(await panel.locator('[data-chip="file:src/login.js"]').count(), 0, 'a chip can be removed');
  report.chips = await panel.locator('.chat-attach').allInnerTexts();

  // 2. A notes-only turn in a conversation: no card, tool-less, the picked note goes with it. The conversation is named after its first question.
  await panel.locator('.chat-pick-trigger').click(); await panel.getByRole('button', { name: 'New', exact: true }).click(); await page.waitForFunction(() => /Conversation 1/.test(document.querySelector('#chat-panel .chat-pick-trigger')?.textContent ?? ''));
  await scenario('slow-start');
  let t = await ask('What do the plan and the ideas say together?');
  // 6. The wait line: from send until the first text, in whole seconds.
  if (await t.review.count()) { await t.review.getByRole('checkbox').check(); reviewed = true; const before = await done(); await t.review.getByRole('button', { name: 'Send to Claude', exact: true }).click();
    const wait = panel.locator('[data-wait]'); await wait.waitFor(); await page.waitForFunction(() => /Sent, waiting for the answer... · [12]s/.test(document.querySelector('#chat-panel [data-wait]')?.textContent ?? ''));
    report.wait = await wait.innerText(); await panel.screenshot({ path: path.join(output, 'box-wait.png') }); await settled(before); }
  assert.equal(await panel.locator('[data-wait]').count(), 0, 'the wait line goes when the text comes');
  let c = (await calls()).at(-1); assert.equal(arg(c, '--tools'), '', 'tool-less'); assert(c.addendum.includes('# Ideas'), 'the picked note went with it');
  await page.waitForFunction(() => /What do the plan and the ideas say/.test(document.querySelector('#chat-panel .chat-pick-trigger')?.textContent ?? ''));
  assert.match(await text(panel.locator('.chat-pick-trigger .chat-pick-value')), /^What do the plan and the ideas say… · 1 message$/, 'named after its first question, about 40 characters');
  await scenario('ok'); t = await ask('And a second question?'); await t.finish(); assert.equal(await panel.locator('.chat-plan').count(), 0);

  // 3. A refused file: the server says why on its chip and on the card; Approve is not possible, nothing is sent; removing it lets the turn go.
  const before3 = (await calls()).length;
  await composer().fill('@big'); await panel.locator('.chat-at [data-at="file:big.log"]').waitFor(); await page.keyboard.press('Enter');
  t = await ask('What is in the log?', { expectCard: true });
  const refusedChip = panel.locator('[data-chip="file:big.log"]'); await page.waitForFunction(() => document.querySelector('#chat-panel [data-chip="file:big.log"]')?.dataset.refused === 'true');
  assert.equal(await text(refusedChip.locator('.chat-attach-why')), '· refused: larger than the size cap');
  assert.match(await text(t.card.locator('[data-file="big.log"]')), /big\.log refused: larger than the size cap/); assert.equal(await t.card.getByRole('button', { name: 'Approve and send' }).isDisabled(), true);
  await panel.screenshot({ path: path.join(output, 'box-refused.png') });
  await t.card.getByRole('button', { name: 'Cancel' }).click(); assert.equal(await composer().inputValue(), 'What is in the log?', 'the question is back in the box');
  await composer().fill('Anything else?'); await composer().press('Enter'); await panel.getByText('A file cannot be attached. Remove it').waitFor(); // blocked on the page: never sent
  assert.equal((await calls()).length, before3, 'nothing was sent while a refused file is attached');
  await refusedChip.getByRole('button', { name: /Remove/ }).click(); await panel.getByRole('button', { name: 'Dismiss' }).last().click().catch(() => {});

  // 4. A note with diagrams in a new conversation: the card once (diagrams), then not again; attaching a file escalates and shows it again.
  await openNote('flow.md'); await panel.locator('.chat-pick-trigger').click(); await panel.getByRole('button', { name: 'New', exact: true }).click(); await page.waitForFunction(() => /Conversation 2/.test(document.querySelector('#chat-panel .chat-pick-trigger')?.textContent ?? ''));
  await scenario('dg-read'); t = await ask('What does the diagram show?', { expectCard: true });
  assert.equal(await t.card.getAttribute('data-profile'), 'diagrams'); assert.match(await text(t.card), /Before Claude opens diagrams/); assert.match(await text(t.card), /open the pictures of this note's diagrams with Read/);
  assert.equal(await text(t.card.locator('[data-plan="diagrams"]')), "Claude may open this diagram: D1 'pipeline' (up to $0.50). It opens one only when your question needs it.", 'the card lists the diagrams of the open note, as the review does');
  await panel.screenshot({ path: path.join(output, 'box-diagram-card.png') });
  let before4 = await done(); await t.card.getByRole('button', { name: 'Approve and send' }).click();
  if (await t.review.count()) await t.review.getByRole('button', { name: 'Send to Claude', exact: true }).click();
  await settled(before4); c = (await calls()).at(-1); assert.equal(arg(c, '--tools'), 'Read', 'the diagram turn ran with Read');
  assert.match(await text(panel.locator('.chat-turn').last().locator('.chat-opened')), /Opened D1 'pipeline'/);
  t = await ask('And again?'); await t.finish(); c = (await calls()).at(-1); assert.equal(arg(c, '--tools'), 'Read', 'no card the second time: the grant covers it');
  await composer().fill('@src/login'); await panel.locator('.chat-at [data-at="file:src/login.js"]').waitFor(); await page.keyboard.press('Enter');
  await scenario('inv-ok'); t = await ask('How does login work with this flow?', { expectCard: true });
  assert.equal(await t.card.getAttribute('data-profile'), 'investigate', 'an escalation shows the card again');
  assert.match(await text(t.card.locator('.chat-plan-withheld')), /D1 'pipeline' withheld: not available together with repo access\./);
  assert.match(await text(t.card.locator('[data-file="src/login.js"]')), /^src\/login\.js$/);
  await panel.screenshot({ path: path.join(output, 'box-escalation-card.png') });
  before4 = await done(); await t.card.getByRole('button', { name: 'Approve and send' }).click(); await settled(before4);
  c = (await calls()).at(-1); assert.equal(arg(c, '--tools'), 'Read,Grep,Glob'); assert.match(c.stdin.split('\n\n')[0], /D1 'pipeline' withheld: not available together with repo access\./);
  assert.equal(await panel.locator('.chat-turn').last().getAttribute('data-profile'), 'investigate', 'rendered as an Investigate turn'); await panel.locator('.chat-turn').last().locator('.inv-trail').waitFor();
  assert.match(await text(panel.locator('.chat-turn').last().locator('button.claim-chip').first()), /src\/login\.js:3/);
  t = await ask('One more on login?'); await t.finish();
  assert.equal(await panel.locator('.chat-plan').count(), 0, 'and not again for the same files');

  // 4b. The chips come back after a reload, from what the server says the conversation was approved for (and nothing more); the next send needs no card. A chip taken off is only off the next
  // message: the stored approval is not narrowed, so a reload brings it back. (A note without diagrams, so that taking the file off does not turn the turn into a diagram turn.)
  const grantNow = () => page.evaluate(() => fetch('/api/conversation/grant?id=' + document.querySelector('#chat-panel .chat-pick-trigger').dataset.session).then((r) => r.json()));
  const grantBefore = await grantNow(); assert.deepEqual([grantBefore.grant.profile, grantBefore.grant.files, grantBefore.grant.repo], ['investigate', ['src/login.js'], false]);
  const reopen = async () => { await page.reload(); await page.waitForFunction(() => document.querySelector('.cm-editor') && window.__aitiarch); await openNote('plan.md'); await page.getByRole('button', { name: /^Chat/ }).click(); await panel.waitFor(); await ready(); };
  await reopen();
  const restored = panel.locator('[data-chip="file:src/login.js"]'); await restored.waitFor();
  assert.equal(await restored.getAttribute('data-granted'), 'true', 'restored from the approval'); assert.equal(await panel.locator('.chat-attach').count(), 1, 'exactly what the approval covers: this file, no repo and no note');
  t = await ask('Where is the session map kept?'); await t.finish(); c = (await calls()).at(-1);
  assert.equal(arg(c, '--tools'), 'Read,Grep,Glob', 'it ran as Investigate again, with no card'); assert.match(c.stdin.split('\n\n')[0], /Attached this turn: src\/login\.js/);
  await panel.screenshot({ path: path.join(output, 'box-chips-restored.png') });
  await restored.getByRole('button', { name: /Remove/ }).click(); assert.equal(await panel.locator('.chat-attach').count(), 0);
  t = await ask('A question without the file'); await t.finish(); c = (await calls()).at(-1);
  assert.equal(arg(c, '--tools'), '', 'with the chip off it is a notes turn, with no card');
  assert.deepEqual(await grantNow(), grantBefore, 'the stored approval is exactly as it was: not narrowed, not widened');
  await reopen(); await panel.locator('[data-chip="file:src/login.js"]').waitFor();
  assert.deepEqual(await grantNow(), grantBefore, 'and still, after another reload; the chip is back');
  assert.equal(await panel.locator('.chat-plan').count(), 0);

  // 5. One list: the two conversations under the names of their first questions, and an investigation made the old way. Rename still works; Delete works for both kinds.
  const old = await call({ mode: 'investigate', label: 'Old investigation' }, '/api/harness/sessions/new'); assert(old.id, 'an investigation was made');
  await openNote('ideas.md'); await openNote('plan.md'); // the list is read again when another note is opened
  await panel.locator('.chat-pick-trigger').click();
  const opts = await panel.locator('.chat-pick-opt').evaluateAll((els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()));
  report.list = opts;
  assert(opts.some((o) => /^What does the diagram show\? \d+ messages/.test(o)), 'the diagram conversation is named after its first question: ' + opts.join(' | '));
  assert(opts.some((o) => /^What do the plan and the ideas say… \d+ messages/.test(o)));
  assert(opts.some((o) => /^Old investigation investigation · 0 messages/.test(o)), 'the investigation is in the same list, marked as one');
  await panel.screenshot({ path: path.join(output, 'box-list.png') });
  await panel.locator('.chat-pick-opt', { hasText: 'Old investigation' }).click(); await panel.locator('[data-chip="repo"]').waitFor();
  assert.match(await text(panel.locator('[data-chip="repo"]')), /an investigation always reads it/); assert.equal(await panel.locator('[data-chip="repo"] button').count(), 0, 'its repo chip cannot be removed');
  await panel.locator('.chat-pick-trigger').click(); await panel.locator('.chat-pick-actions').getByRole('button', { name: 'Rename' }).click();
  await panel.getByRole('textbox', { name: 'Conversation name' }).fill('Login study'); await panel.getByRole('button', { name: 'Save' }).click();
  await page.waitForFunction(() => /Login study/.test(document.querySelector('#chat-panel .chat-pick-trigger')?.textContent ?? ''));
  await panel.locator('.chat-pick-trigger').click(); await panel.locator('.chat-pick-actions').getByRole('button', { name: 'Delete' }).click();
  await panel.getByRole('group', { name: 'Delete this conversation' }).getByRole('button', { name: 'Delete', exact: true }).click();
  await page.waitForFunction(() => /One-off/.test(document.querySelector('#chat-panel .chat-pick-trigger')?.textContent ?? ''));
  await panel.locator('.chat-pick-trigger').click(); assert.equal(await panel.locator('.chat-pick-opt', { hasText: 'Login study' }).count(), 0, 'the investigation is gone');
  await panel.locator('.chat-pick-opt', { hasText: 'What does the diagram show?' }).click(); await page.waitForFunction(() => document.querySelectorAll('#chat-panel .chat-turn').length >= 4);
  await panel.locator('.chat-pick-trigger').click(); await panel.locator('.chat-pick-actions').getByRole('button', { name: 'Delete' }).click();
  const confirm = panel.getByRole('group', { name: 'Delete this conversation' }); await page.waitForFunction(() => !document.querySelector('#chat-panel .chat-sessions-delete button')?.disabled);
  await confirm.getByRole('button', { name: 'Delete', exact: true }).click(); await page.waitForFunction(() => /One-off/.test(document.querySelector('#chat-panel .chat-pick-trigger')?.textContent ?? ''));
  const left = (await (await page.evaluate(() => fetch('/api/harness/sessions?mode=chat&all=1').then((r) => r.json()))).sessions).map((s) => s.label);
  assert.deepEqual(left, ['What do the plan and the ideas say…'], 'the conversation with Investigate turns is deleted, the other stays');

  // The page's turns never used a profile or a cap the server did not give: the requests carried attachments only.
  assert.equal(errors.length, 0, 'no page error: ' + errors.join('; '));
  assert.deepEqual(external, [], 'no request left the machine');
  assert.equal(await readFile(path.join(notebook, 'plan.md'), 'utf8'), '# Plan\n\nA unique sentence for the session.\n', 'the note is untouched');
  console.log(JSON.stringify({ pass: true, ...report }, null, 1));
  await context.close();
} finally { watcher.stop(); await app.close(); await browser.close(); for (const d of [notebook, repo, harness, scratch]) await rm(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
