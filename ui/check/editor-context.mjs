// Real-browser check for the editor context in the chat, against the synthetic Claude Code CLI and a fake one-off provider (no model, no live call):
//  - the open note and the selection show as chips above the composer; removing one holds for one message only;
//  - the review card shows the selection's line range and excerpt, and the one-line manifest the message starts with;
//  - the conversation's CLI really gets that line on stdin (also on a resumed turn), with no note text in it;
//  - opening another note mid-conversation keeps the conversation, says "Open note changed: A -> B" once, and the next message names the new note;
//  - a reply written on the other note is added to the note that is open, from the chat it is kept in;
//  - a one-off chat sends the same line as its "editor" field;
//  - a conversation counts against its own budget and counters (the footer, the usage list), whichever note is open; a one-off chat keeps its note's;
//  - Delete conversation, asked while another note is open, names the note the conversation was started on and how many saved replies go with it;
//  - the "Added from chat" toast sits below the panel, not over the composer, in a narrow window;
//  - a selection that crosses sections says where it starts and ends;
//  - a reply's source chip names the note its question was asked on, with the same Found / Not found state, whichever note is open now;
//  - a conversation started on a note with a very long name: the picker still says "started on", the name is cut with an ellipsis (full name in a tooltip), and nothing overflows in the narrow full-width sheet.
// Run after `vite build`: BATCH2A_OUTPUT=<folder outside the repo> node check/editor-context.mjs
import './config-isolation.mjs'; // first: an empty temp config folder, never the machine's real one
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
const notebook = await tmp('aitiarch-edctx-nb-'), harness = await tmp('aitiarch-edctx-h-'), scratch = await tmp('aitiarch-edctx-s-');
const scenarioFile = path.join(scratch, 'scenario.txt'), record = path.join(scratch, 'calls.jsonl');
const LONG = 'a-very-long-note-name-that-would-never-fit-in-a-narrow-chat-panel-without-an-ellipsis';
const PLAN = '# Plan\n\nA unique sentence for the session.\n\n## Risks\n\nThe risk is the second paragraph.\n', IDEAS = '# Ideas\n\nOne idea only.\n';
const SEL = 'A unique sentence for the session.';
execFileSync('git', ['init', '-q'], { cwd: notebook }); await writeFile(path.join(notebook, '.gitignore'), '/chat/\n');
await writeFile(path.join(notebook, 'plan.md'), PLAN); await writeFile(path.join(notebook, 'ideas.md'), IDEAS);
await writeFile(path.join(notebook, LONG + '.md'), '# A very long title for a note that will not fit in a narrow chat panel at all\n\nText.\n'); await writeFile(scenarioFile, 'quote-selection');
const provider = new FakeChatProvider();
const store = await Store.open(notebook), watcher = new NoteWatcher(store);
const app = createApp({ store, watcher, distDir: path.join(here, '../dist'), provider, harness: { command: process.execPath, prefixArgs: [path.join(here, '..', 'test', 'fixtures', 'harness-cli.mjs'), '@' + scenarioFile, record], dir: harness } });
const browser = await (async () => { for (const channel of ['msedge', 'chrome']) { try { return await chromium.launch({ channel, headless: true }); } catch { /* next */ } } throw new Error('Edge or Chrome is required.'); })();
const external = [], errors = [];
const calls = async () => (await readFile(record, 'utf8')).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
try {
  const url = `http://127.0.0.1:${await app.listen(0)}/?debug=1`, context = await browser.newContext({ viewport: { width: 1440, height: 900 } }), page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on('request', (r) => { if (!r.url().startsWith('http://127.0.0.1') && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) external.push(r.url()); });
  page.on('pageerror', (e) => errors.push(e.message));
  const panel = page.locator('#chat-panel'), chip = (name) => panel.locator(`.chat-sends [data-chip="${name}"]`);
  const openNote = async (file) => { for (let attempt = 0; ; attempt++) { await page.keyboard.press('Control+k'); const palette = page.getByRole('dialog', { name: 'Command palette' }); await palette.waitFor(); const search = palette.getByRole('textbox'); await search.fill('Jump to note: ' + file); await search.press('Enter'); try { await page.waitForFunction((f) => window.__aitiarch?.[f] && document.querySelector('.tab.on')?.textContent?.toLowerCase().includes(f.replace('.md', '')), file, { timeout: 6000 }); return; } catch (e) { if (attempt >= 2) throw e; await page.keyboard.press('Escape'); } } };
  const select = (file, text) => page.evaluate(([f, t]) => { const v = window.__aitiarch[f].view, from = v.state.doc.toString().indexOf(t); v.dispatch({ selection: { anchor: from, head: from + t.length } }); }, [file, text]);
  const caret = (file, pos) => page.evaluate(([f, p]) => { const v = window.__aitiarch[f].view; v.dispatch({ selection: { anchor: p } }); }, [file, pos]);
  const text = async (loc) => (await loc.innerText()).replace(/\s+/g, ' ').trim().replace(/\s?([×+])$/, ' $1');
  const chipOf = (turn) => panel.locator('.chat-turn').nth(turn).locator('.claim-chip').first();
  const chipWords = async (loc) => ({ label: (await loc.locator('.claim-label').textContent()).trim(), state: (await loc.locator('.claim-state').textContent()).replace(/^\s*·\s*/, '').trim() });
  const footer = async () => text(panel.locator('.chat-usage'));
  const ask = async (question) => { const c = panel.getByRole('textbox', { name: 'Message Aitiarch AI' }); await c.fill(question); await c.press('Enter'); const review = panel.getByRole('region', { name: 'What will be sent' }); await review.waitFor(); return review; };
  const sendReview = async (review) => { const done = panel.locator('.chat-ai:not(.chat-streaming) .chat-add').last(); const before = await panel.locator('.chat-ai:not(.chat-streaming) .chat-add').count(); await review.getByRole('button', { name: 'Send', exact: true }).click(); await page.waitForFunction((n) => document.querySelectorAll('#chat-panel .chat-ai:not(.chat-streaming) .chat-add').length > n, before); return done; };

  await page.goto(url); await page.waitForSelector('.cm-editor');
  await openNote('plan.md');
  await page.getByRole('button', { name: /^Chat/ }).click(); await panel.waitFor();
  await page.waitForFunction(() => { const t = document.querySelector('.chat-composer textarea'); return t && !t.disabled; });

  // 1. The open note is a chip from the start; with nothing selected there is no selection chip.
  await chip('note').waitFor();
  assert.equal(await text(chip('note')), 'Open note · Plan ×', 'the open note chip names the note by its title');
  assert.equal(await chip('note').getAttribute('aria-pressed'), 'true');
  assert.equal(await chip('selection').count(), 0, 'no selection, no selection chip');

  // 2. Selecting text in the editor adds the selection chip by itself: lines and size, on by default.
  await select('plan.md', SEL);
  await chip('selection').waitFor();
  assert.equal(await text(chip('selection')), `Selection · line 3 · ${SEL.length} chars ×`);
  assert.equal(await chip('selection').getAttribute('aria-pressed'), 'true', 'on by default');
  await page.screenshot({ path: path.join(output, 'editor-context-chips.png') });

  // 3. Removing the selection chip: it says "off" and can be put back.
  await chip('selection').click();
  assert.equal(await chip('selection').getAttribute('aria-pressed'), 'false'); assert.equal(await text(chip('selection')), 'Selection · line 3 · off +');
  await chip('selection').click(); assert.equal(await chip('selection').getAttribute('aria-pressed'), 'true');
  // A longer selection across two sections: the line range grows, the section follows the head.
  await page.evaluate(() => { const v = window.__aitiarch['plan.md'].view, d = v.state.doc.toString(); v.dispatch({ selection: { anchor: d.indexOf('A unique'), head: d.indexOf('The risk') + 8 } }); });
  await page.waitForFunction(() => /lines 3-7/.test(document.querySelector('#chat-panel [data-chip="selection"]')?.textContent ?? ''));
  const across = PLAN.slice(PLAN.indexOf('A unique'), PLAN.indexOf('The risk') + 8);
  const spanReview = await ask('What do these parts mean?');
  assert.equal(await text(spanReview.locator('.chat-review-manifest')), `Open note: Plan (${PLAN.length} chars). Selection: lines 3-7 (${across.length} chars). Selection spans Plan to Plan > Risks. Cursor section: Plan > Risks.`, 'a selection across two sections says where it starts and ends, and the cursor section');
  await spanReview.getByRole('button', { name: 'Cancel' }).click();
  await select('plan.md', SEL);
  await page.waitForFunction(() => /line 3 ·/.test(document.querySelector('#chat-panel [data-chip="selection"]')?.textContent ?? ''));

  // 4. A conversation: new, then a message with the selection. The review shows the lines, the excerpt and the line the message starts with.
  await panel.locator('.chat-pick-trigger').click(); await panel.getByRole('button', { name: 'New', exact: true }).click();
  await page.waitForFunction(() => /Conversation 1/.test(document.querySelector('#chat-panel .chat-pick-trigger')?.textContent ?? ''));
  let review = await ask('What does this paragraph mean?');
  const line1 = `Open note: Plan (${PLAN.length} chars). Selection: line 3 (${SEL.length} chars). Cursor section: Plan.`;
  assert.equal(await text(review.locator('dt', { hasText: /^Selection/ })), 'Selection · line 3', 'the review names the selection lines');
  assert.equal(await text(review.locator('.chat-review-quote')), SEL, 'and shows the excerpt');
  assert.equal(await text(review.locator('.chat-review-manifest')), line1, 'and the one line the message starts with');
  assert.equal(await text(review.locator('dt', { hasText: /^Starts with/ })), 'Starts with');
  await panel.screenshot({ path: path.join(output, 'editor-context-review.png') });
  await sendReview(review);
  assert.match(await footer(), /^This conversation · 1 call · /, 'the footer counts the conversation');
  let [first] = await calls();
  assert.equal(first.stdin, line1 + '\n\nWhat does this paragraph mean?', 'the CLI got that line, a blank line and the question');
  assert(!first.stdin.split('\n\n')[0].includes('unique sentence'), 'no note text in the line');
  assert(first.addendum.includes('[[source S1: Selection]]') && first.addendum.includes(SEL), 'the selection is a source in the instruction file');
  const claims = (await panel.locator('.claim-chips li').last().textContent()).replace(/\s+/g, ' ');
  assert.match(claims, /Selection/); assert.match(claims, /Found/, 'a quote from the selection is checked against it');
  // After the send the chips are back to their defaults (a removal holds for one message).
  assert.equal(await chip('selection').getAttribute('aria-pressed'), 'true');

  // 5. Remove the selection for one message: the review carries no selection and the line has no Selection part; the message after it has the selection again.
  await writeFile(scenarioFile, 'ok');
  await chip('selection').click(); assert.equal(await chip('selection').getAttribute('aria-pressed'), 'false');
  review = await ask('And this section?');
  const line2 = `Open note: Plan (${PLAN.length} chars). Cursor section: Plan.`;
  assert.equal(await review.locator('dt', { hasText: /^Selection/ }).count(), 0, 'the removed selection is not in the review'); assert.equal(await text(review.locator('.chat-review-manifest')), line2);
  await sendReview(review);
  assert.match(await footer(), /^This conversation · 2 calls · /);
  const second = (await calls())[1];
  assert(second.args.includes('--resume'), 'a resumed turn'); assert.equal(second.stdin, line2 + '\n\nAnd this section?'); assert(!second.addendum.includes('[[source S1'), 'no selection source in the instruction file');
  assert.equal(await chip('selection').getAttribute('aria-pressed'), 'true', 'the selection is back for the next message');
  assert.deepEqual(await chipWords(chipOf(1)), { label: 'plan › Plan', state: 'Found' }, 'a note claim names the note and the heading it sits under while that note is open');
  // The cursor's section follows the caret: into "Risks", the selection chip goes with the selection, and the next line says so.
  await caret('plan.md', PLAN.indexOf('The risk') + 3);
  await page.waitForFunction(() => !document.querySelector('#chat-panel [data-chip="selection"]'));
  review = await ask('What about this section?');
  assert.equal(await text(review.locator('.chat-review-manifest')), `Open note: Plan (${PLAN.length} chars). Cursor section: Plan > Risks.`, 'the cursor section follows the caret');
  await review.getByRole('button', { name: 'Cancel' }).click();

  // 6. Mid-conversation, open another note: the conversation stays, the notice says so once, and the next message names the new note.
  assert.equal(await panel.locator('.chat-sends [data-chip="switched"]').count(), 0, 'no notice before a switch');
  await openNote('ideas.md');
  await chip('switched').waitFor();
  assert.equal(await text(chip('switched')), 'Open note changed: Plan -> Ideas ×', 'the notice names both notes');
  assert.equal(await chip('switched').getAttribute('role'), 'status');
  assert.equal(await text(chip('note')), 'Open note · Ideas ×', 'the open note chip follows');
  assert.match(await text(panel.locator('.chat-pick-trigger .chat-pick-value')), /^What does this paragraph mean\? · 2 messages$/, 'the conversation is still selected'); assert.equal(await text(panel.locator('.chat-pick-trigger .chat-pick-from')), 'started on plan', 'and says where it was started');
  assert.equal(await panel.locator('.chat-turn').count(), 2, 'its earlier messages are still there');
  assert.deepEqual(await chipWords(chipOf(1)), { label: 'plan', state: 'Found' }, 'the earlier reply\'s chip still names the note it was asked on, with the same state, now that another note is open');
  assert.match(await text(panel.locator('.chat-head h2')), /On ideas$/, 'the header names the open note');
  assert.match(await footer(), /^This conversation · 2 calls · /, 'the footer still counts the conversation, whichever note is open');
  await page.screenshot({ path: path.join(output, 'editor-context-note-changed.png') });
  review = await ask('And here?');
  const line3 = `Open note: Ideas (${IDEAS.length} chars). Cursor section: Ideas.`;
  assert.equal(await text(review.locator('.chat-review-manifest')), line3, 'the review names the note that is open now');
  assert.equal(await review.locator('.chat-review-source summary', { hasText: /^This note/ }).count(), 1, 'and sends its text');
  await sendReview(review);
  assert.equal(await panel.locator('.chat-sends [data-chip="switched"]').count(), 0, 'the notice goes away once a message is sent');
  assert.match(await footer(), /^This conversation · 3 calls · /);
  const third = (await calls())[2];
  assert(third.args.includes('--resume'), 'still the same conversation'); assert.equal(third.stdin, line3 + '\n\nAnd here?');
  assert(third.addendum.includes('One idea only.') && !third.addendum.includes(SEL), 'the instruction file holds the note that is open now, not the first one');
  // A reply asked on Ideas: its quote is not in Ideas. Back on Plan, whose text does hold those words, the chip still names Ideas and still says not found, and offers no Show or Cite.
  assert.deepEqual(await chipWords(chipOf(2)), { label: 'ideas', state: 'Quote not found' });
  // The notice can be dismissed on its own.
  await openNote('plan.md'); await chip('switched').waitFor();
  assert.deepEqual(await chipWords(chipOf(2)), { label: 'ideas', state: 'Quote not found' }, 'the chip names the note it was asked on, not the one open now');
  assert.deepEqual(await chipWords(chipOf(1)), { label: 'plan › Plan', state: 'Found' }, 'and the reply asked on Plan reads as it did when Plan was open before');
  await chipOf(2).click();
  assert.equal(await panel.getByRole('button', { name: 'Show in note' }).count(), 0, 'no Show in note for a quote that belongs to another note'); assert.equal(await panel.getByRole('button', { name: 'Cite in note' }).count(), 0);
  assert.match(await text(panel.locator('.claim-elsewhere')), /not open now/); await chipOf(2).click(); assert.equal(await text(chip('switched')), 'Open note changed: Ideas -> Plan ×');
  await chip('switched').getByRole('button', { name: 'Dismiss this notice' }).click(); await page.waitForFunction(() => !document.querySelector('#chat-panel [data-chip="switched"]'));

  // 7. A reply written while Ideas was open is added to Ideas, from the chat it is kept in (the conversation started on Plan).
  await openNote('ideas.md'); await chip('switched').waitFor();
  // The narrow full-width sheet covers the editor. The toast that says "Added from chat" must not land on the composer, or on anything else in the panel.
  await page.setViewportSize({ width: 390, height: 860 });
  await page.waitForFunction(() => { const p=document.querySelector('#chat-panel'),r=p.getBoundingClientRect();return p.dataset.layout==='sheet'&&Math.round(r.width)===innerWidth&&Math.round(r.x)===0; });
  await panel.locator('.chat-turn').nth(2).locator('.chat-add').click();
  const toast = page.locator('.thought-toast'); await toast.waitFor();
  const at = await page.evaluate(() => {
   const box = (el) => { const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, r: b.right, b: b.bottom }; }, t = document.querySelector('.thought-toast');
   return { toast: box(t), composer: box(document.querySelector('#chat-panel .chat-composer')), panel: box(document.querySelector('#chat-panel')), vw: innerWidth, vh: innerHeight, pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, toastOverflow: t.scrollWidth - t.clientWidth, text: t.innerText.replace(/\s+/g, ' ').trim() };
  });
  const hit = (a, b) => a.x < b.r && a.r > b.x && a.y < b.b && a.b > b.y;
  assert(!hit(at.toast, at.composer), 'the toast does not cover the composer: ' + JSON.stringify(at)); assert(!hit(at.toast, at.panel), 'nor anything else in the chat panel: ' + JSON.stringify(at));
  assert(at.toast.x >= 0 && at.toast.r <= at.vw && at.toast.y >= 0 && at.toast.b <= at.vh, 'the toast is inside the window: ' + JSON.stringify(at)); assert(at.pageOverflow <= 1 && at.toastOverflow <= 1, 'and nothing overflows sideways');
  assert.match(at.text, /^Added from chat/); assert(!/Ctrl\+Z/.test(at.text), 'the keyboard hint is dropped at this width'); for (const name of ['Undo', 'Close notice']) assert.equal(await toast.getByRole('button', { name }).isVisible(), true, name + ' can be reached');
  // "What was added" opens upward, over the panel only because it was asked for; the toast itself keeps its place and size.
  const sizeBefore = await toast.boundingBox(); await toast.locator('summary').click(); await toast.locator('.added-detail pre').waitFor(); const sizeOpen = await toast.boundingBox();
  assert(Math.abs(sizeOpen.height - sizeBefore.height) <= 1 && Math.abs(sizeOpen.y - sizeBefore.y) <= 1, 'opening the details does not grow the toast: ' + JSON.stringify([sizeBefore, sizeOpen]));
  assert.match(await toast.locator('.added-detail pre').innerText(), /Started|Resumed/, 'and shows what was added'); await toast.locator('summary').click();
  await toast.getByRole('button', { name: 'Close notice' }).click(); await toast.waitFor({ state: 'detached' });
  await page.setViewportSize({ width: 1440, height: 900 });
  let ideasOnDisk = '';
  for (let i = 0; i < 60 && !ideasOnDisk.includes('[!ai]'); i++) { await page.waitForTimeout(250); ideasOnDisk = await readFile(path.join(notebook, 'ideas.md'), 'utf8'); }
  assert(ideasOnDisk.includes('> [!ai]') && ideasOnDisk.includes('Resumed.'), 'the reply was added to the note that is open: ' + ideasOnDisk.slice(0, 200));
  assert.equal(await readFile(path.join(notebook, 'plan.md'), 'utf8'), PLAN, 'and nothing was written to the note the conversation started on');

  // 8. A one-off chat: no notice (it belongs to the open note), the same line goes with the message as its "editor" field.
  await panel.locator('.chat-pick-trigger').click(); await panel.locator('.chat-pick-opt[data-value=""]').click();
  await page.waitForFunction(() => /One-off/.test(document.querySelector('#chat-panel .chat-pick-trigger')?.textContent ?? ''));
  assert.equal(await panel.locator('.chat-sends [data-chip="switched"]').count(), 0);
  await select('ideas.md', 'One idea only.');
  await chip('selection').waitFor();
  review = await ask('Is this clear?');
  const line4 = `Open note: Ideas (${(await readFile(path.join(notebook, 'ideas.md'), 'utf8')).length} chars). Selection: line 3 (14 chars). Cursor section: Ideas.`;
  assert.equal(await text(review.locator('.chat-review-manifest')), line4); assert.equal(await text(review.locator('dt', { hasText: /^Editor line/ })), 'Editor line', 'a one-off message says the line travels with it');
  await sendReview(review);
  assert.equal(provider.requests.length, 1); assert.equal(provider.requests[0].editor, line4, 'the provider request carries the line');
  assert.match(await footer(), /^1 call · /, 'a one-off chat counts against its note, not against the conversation');
  const usageNow = (await page.evaluate(() => fetch('/api/usage').then((r) => r.json()))).chats;
  const owned = usageNow.filter((c) => c.session); assert.equal(owned.length, 1, 'one conversation has counters'); assert.deepEqual([owned[0].note, owned[0].label, owned[0].calls], ['plan.md', 'What does this paragraph mean?', 3], 'its own, under the note it started on');
  assert.equal(usageNow.find((c) => !c.session && c.note === 'ideas.md').calls, 1, 'the note the conversation visited keeps its own one-off count'); assert.equal(usageNow.filter((c) => !c.session && c.note === 'plan.md').reduce((n, c) => n + c.calls, 0), 0, 'and the starting note\'s one-off chat did not pay for the conversation');
  assert.match(provider.requests[0].selection, /^One idea only\.$/);
  // Switching notes in a one-off chat is another chat on the other note, as before: no notice.
  await openNote('plan.md'); await page.waitForFunction(() => /On plan$/.test(document.querySelector('#chat-panel .chat-head h2')?.textContent ?? ''));
  assert.match(await footer(), /^No calls yet/, 'on Plan the one-off chat has made no calls, though the conversation started there made three');
  // Choosing the conversation again brings its own counters back from the server.
  await panel.locator('.chat-pick-trigger').click(); await panel.locator('.chat-pick-opt', { hasText: /^What does this paragraph mean\?/ }).click();
  await page.waitForFunction(() => /^This conversation · 3 calls/.test(document.querySelector('#chat-panel .chat-usage')?.textContent ?? ''));
  assert.equal(await panel.locator('.chat-sends [data-chip="switched"]').count(), 0);
  assert.equal(await text(chip('note')), 'Open note · Plan ×');

  // 8b. Delete conversation, asked from another note: the confirmation names the note the conversation was started on and how many saved replies it will remove. Keep removes nothing.
  await openNote('ideas.md'); await chip('switched').waitFor();
  await page.route('**/api/harness/sessions/replies*', async (route) => { await new Promise((r) => setTimeout(r, 700)); await route.continue(); }); // the count takes a moment
  await panel.locator('.chat-pick-trigger').click(); await panel.locator('.chat-pick-actions').getByRole('button', { name: 'Delete' }).click();
  const confirm = panel.locator('.chat-sessions-delete'); await confirm.waitFor();
  const said = () => confirm.evaluate((e) => [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').replace(/\s+/g, ' ').trim());
  const del = confirm.getByRole('button', { name: 'Delete', exact: true });
  assert.equal(await said(), 'Delete “What does this paragraph mean?”? Counting its saved replies…', 'while the server counts'); assert.equal(await del.isDisabled(), true, 'Delete waits for the count');
  await page.waitForFunction(() => !document.querySelector('#chat-panel .chat-sessions-delete button')?.disabled);
  assert.equal(await said(), 'Delete “What does this paragraph mean?”? It was started on plan. 3 saved replies in that note’s chat are removed. Claude’s own record of the conversation and its questions are removed too.', 'the confirmation names the note and the number of saved replies');
  assert.equal(await del.isEnabled(), true);
  await confirm.getByRole('button', { name: 'Keep' }).click(); await confirm.waitFor({ state: 'detached' }); await page.unroute('**/api/harness/sessions/replies*');
  assert.match(await text(panel.locator('.chat-pick-trigger .chat-pick-value')), /^What does this paragraph mean\? · 3 messages$/, 'Keep removed nothing'); assert.match(await footer(), /^This conversation · 3 calls · /);
  await openNote('plan.md'); await chip('switched').waitFor();

  // 9. Removing the note for a message: the line says it was not sent, and no note source goes.
  await panel.locator('.chat-pick-trigger').click(); await panel.getByRole('button', { name: 'New', exact: true }).click();
  await page.waitForFunction(() => /Conversation/.test(document.querySelector('#chat-panel .chat-pick-trigger')?.textContent ?? ''));
  await chip('note').click(); assert.equal(await text(chip('note')), 'Open note · Plan · off +');
  review = await ask('Anything?');
  assert.equal(await text(review.locator('.chat-review-manifest')), 'Open note: Plan (not sent this turn). Cursor section: Plan > Risks.', 'the line says the note was not sent');
  assert.equal(await review.locator('.chat-review-source summary', { hasText: /^This note/ }).count(), 0, 'and no note source is in the review');
  await review.getByRole('button', { name: 'Cancel' }).click();

  // 10. A conversation started on a note with a very long name, then another note opened: the picker says "started on <name>", cut with an ellipsis and the full name in a tooltip; nothing overflows in the narrow sheet.
  await openNote(LONG + '.md');
  await panel.locator('.chat-pick-trigger').click(); await panel.getByRole('button', { name: 'New', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#chat-panel .chat-pick-trigger [data-x]') === null && /Conversation \d+ · 0 messages/.test(document.querySelector('#chat-panel .chat-pick-trigger')?.textContent ?? '')); // a new, empty conversation
  await openNote('ideas.md'); await chip('switched').waitFor();
  const from = panel.locator('.chat-pick-trigger .chat-pick-from'); await from.waitFor();
  assert.match(await text(from), /^started on a-very-long-note-name/);
  assert.equal(await from.locator('.chat-pick-from-name').getAttribute('title'), LONG, 'the full name is in a tooltip');
  await page.setViewportSize({ width: 390, height: 860 });
  await page.waitForFunction(() => { const p=document.querySelector('#chat-panel'),r=p.getBoundingClientRect();return p.dataset.layout==='sheet'&&Math.round(r.width)===innerWidth&&Math.round(r.x)===0; });
  const narrow = await page.evaluate(() => {
    const panel = document.querySelector('#chat-panel'), trigger = panel.querySelector('.chat-pick-trigger'), from = trigger.querySelector('.chat-pick-from'), name = from.querySelector('.chat-pick-from-name');
    const t = trigger.getBoundingClientRect(), f = from.getBoundingClientRect(), n = name.getBoundingClientRect(), p = panel.getBoundingClientRect();
    return { panelWidth: Math.round(p.width), panelOverflow: panel.scrollWidth - panel.clientWidth, triggerOverflow: trigger.scrollWidth - trigger.clientWidth, pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      nameCut: name.scrollWidth > name.clientWidth, nameInside: n.right <= t.right + 0.5 && n.left >= t.left, prefixRoom: n.left - f.left, prefixText: from.firstChild.textContent, ellipsis: getComputedStyle(name).textOverflow };
  });
  assert.equal(narrow.panelWidth, 390, 'the narrow sheet spans the viewport'); assert(narrow.panelOverflow <= 1, 'no sideways overflow in the narrow sheet: ' + narrow.panelOverflow); assert(narrow.triggerOverflow <= 1, 'the picker does not overflow: ' + narrow.triggerOverflow); assert(narrow.pageOverflow <= 1, 'nor does the page');
  assert(narrow.nameCut && narrow.ellipsis === 'ellipsis', 'the long name is cut with an ellipsis'); assert(narrow.nameInside, 'and stays inside the picker');
  assert.equal(narrow.prefixText.trim(), 'started on', '"started on" is whole'); assert(narrow.prefixRoom > 40, 'and has room: ' + narrow.prefixRoom);
  await panel.screenshot({ path: path.join(output, 'editor-context-narrow.png') });
  await page.setViewportSize({ width: 1440, height: 900 });

  assert.equal(errors.length, 0, 'no page error: ' + errors.join('; '));
  assert.equal(external.length, 0, 'no network request left the machine: ' + external.join(', '));
  assert.equal(await readFile(path.join(notebook, 'plan.md'), 'utf8'), PLAN, 'plan.md is untouched');
  console.log('editor-context: ok');
  await context.close();
} finally { watcher.stop(); await app.close(); await browser.close(); }
