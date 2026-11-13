// Real-browser check for Investigate in the chat panel, against the synthetic Claude Code CLI (no model): the repo folder, the plan card before the
// first question (also enforced by the server), the live trail (thinking, Glob, Grep, Read, a denied read), file claim chips and the read-only excerpt,
// Cancel, the partial-answer banner at the turn limit, the tripwire banner and Restore, a reload that shows the questions, Delete, narrow width and
// keyboard focus. Run after `vite build`: BATCH2A_OUTPUT=<folder outside the repo> node check/investigate-ui.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { Store } from '../server/store.ts';
import { NoteWatcher } from '../server/watch.ts';
import { createApp } from '../server/http.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const output = process.env.BATCH2A_OUTPUT || process.env.GROVE_OUTPUT;
if (!output || path.resolve(output).toLowerCase().startsWith(path.resolve(here, '..', '..').toLowerCase())) throw new Error('Set BATCH2A_OUTPUT to a folder outside the repository.');
await mkdir(output, { recursive: true });
const tmp = (n) => mkdtemp(path.join(os.tmpdir(), n));
const notebook = await tmp('aitiarch-invui-nb-'), repo = await tmp('aitiarch-invui-repo-'), harness = await tmp('aitiarch-invui-h-'), scratch = await tmp('aitiarch-invui-s-');
const scenarioFile = path.join(scratch, 'scenario.txt'), record = path.join(scratch, 'calls.jsonl'), scenario = (s) => writeFile(scenarioFile, s);
execFileSync('git', ['init', '-q'], { cwd: notebook }); await writeFile(path.join(notebook, 'plan.md'), '# Plan\n\nKeep this.\n');
execFileSync('git', ['init', '-q'], { cwd: repo }); await mkdir(path.join(repo, 'src'));
await writeFile(path.join(repo, 'src', 'login.js'), "const http = require('http');\n// Sessions live in memory.\nconst sessions = new Map();\nfunction login(name) { return sessions.get(name); }\n");
await writeFile(path.join(repo, 'src', 'server.js'), 'const port = 4100;\n'); await writeFile(path.join(repo, '.env'), 'KEY=CANARY-INVUI\n');
await scenario('inv-trail');
const provider = { name: 'claude', async checkAvailability() { return { available: true }; }, async invoke() { throw new Error('the one-off chat is not used here'); } };
const store = await Store.open(notebook), watcher = new NoteWatcher(store);
const app = createApp({ store, watcher, distDir: path.join(here, '../dist'), provider, harness: { command: process.execPath, prefixArgs: [path.join(here, '..', 'test', 'fixtures', 'harness-cli.mjs'), '@' + scenarioFile, record], dir: harness } });
const browser = await (async () => { for (const channel of ['msedge', 'chrome']) { try { return await chromium.launch({ channel, headless: true }); } catch { /* next */ } } throw new Error('Edge or Chrome is required.'); })();
const external = [], report = {};
try {
  const url = `http://127.0.0.1:${await app.listen(0)}/?debug=1`, context = await browser.newContext({ viewport: { width: 1440, height: 900 } }), page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on('request', (r) => { if (!r.url().startsWith('http://127.0.0.1') && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) external.push(r.url()); });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  const panel = page.locator('#chat-panel'), focused = () => page.evaluate(() => document.activeElement?.getAttribute('aria-label') || document.activeElement?.textContent?.trim().slice(0, 40));
  const openPanel = async () => { await page.goto(url); await page.waitForSelector('.cm-editor'); await page.getByRole('button', { name: /^Chat/ }).click(); await panel.waitFor(); await panel.getByRole('radio', { name: 'Investigate' }).click(); };
  await openPanel();

  // The repo folder, chosen once for the project.
  await panel.getByRole('button', { name: 'Choose a folder' }).click();
  await panel.getByRole('textbox', { name: 'Repo folder (absolute path)' }).fill(repo); await panel.getByRole('button', { name: 'Use this folder' }).click();
  await panel.locator('.chat-sessions-repo code').waitFor(); assert.equal(await panel.locator('.chat-sessions-repo code').innerText(), repo);
  await panel.locator('.chat-pick-trigger').click(); await panel.getByRole('button', { name: 'New', exact: true }).click();

  // The plan card comes first; there is no composer until it is confirmed, and the server refuses a turn without it.
  const card = panel.getByRole('group', { name: 'Plan for this investigation' }); await card.waitFor();
  const cardText = await card.innerText();
  for (const s of ['Repo folder', 'Files Claude can read', 'Never copied', 'your notebook folder, if it is inside this repo', 'Cost cap per question']) assert(cardText.includes(s), 'plan card shows ' + s);
  assert(!/turn limit|12 model turns|of 12/i.test(cardText), 'no turn limit is shown on the plan card');
  // The cost cap is editable (default $0.50); a changed cap must be applied to the plan before it can be confirmed.
  const cap = card.getByLabel('Cost cap per question'); assert.equal(await cap.inputValue(), '0.50');
  await cap.fill('0.25'); assert.equal(await card.getByRole('button', { name: 'Confirm' }).isDisabled(), true, 'Confirm waits for the updated plan');
  await card.getByRole('button', { name: 'Update the plan' }).click(); await page.waitForFunction(() => document.querySelector('#chat-panel .inv-plan .inv-confirm')?.disabled === false);
  assert.equal(await cap.inputValue(), '0.25'); await cap.fill('0.50'); await card.getByRole('button', { name: 'Update the plan' }).click(); await page.waitForFunction(() => document.querySelector('#chat-panel .inv-plan .inv-confirm')?.disabled === false);
  assert.equal(await panel.getByRole('textbox', { name: 'Ask about the repo' }).count(), 0, 'no composer before the plan is confirmed');
  const session = await page.evaluate(() => document.querySelector('#chat-panel .chat-pick-trigger').dataset.session);
  const refused = await page.evaluate(async (s) => (await fetch('/api/harness/investigate/send', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Aitiarch': '1' }, body: JSON.stringify({ session: s, question: 'q' }) })).json(), session);
  assert.equal(refused.error, 'plan_required', 'the server refuses a turn before the plan is confirmed');
  await panel.screenshot({ path: path.join(output, 'investigate-plan-card.png') });
  assert.equal(await focused(), 'Confirm', 'focus starts on Confirm'); await page.keyboard.press('Enter');
  const composer = panel.getByRole('textbox', { name: 'Ask about the repo' }); await composer.waitFor();
  assert.equal(await focused(), 'Ask about the repo', 'then on the question box');

  // The trail: thinking (collapsed), Glob, Grep, a denied Read, a Read; the answer with file claim chips; an unknown event is tolerated.
  await composer.fill('How does login work?'); await page.keyboard.press('Enter');
  await panel.locator('.inv-status-done').waitFor();
  const rows = await panel.locator('.inv-trail .inv-row:not(.inv-thinking)').evaluateAll((els) => els.map((e) => ({ state: e.dataset.state, text: e.innerText.replace(/\s+/g, ' ').trim() })));
  report.rows = rows;
  assert.deepEqual(rows.map((r) => [r.text.split(' ')[0], r.state]), [['Glob', 'ok'], ['Grep', 'ok'], ['Read', 'denied'], ['Read', 'error'], ['Read', 'ok']]);
  // Only a real permission denial reads "Denied by policy". A tool error (a path that is not there) reads "Error: path not found" with the repo-relative path, never a user path.
  assert.match(rows[2].text, /Denied by policy: Permission to read notes\.private\.md has been denied\./);
  assert.match(rows[3].text, /^Read src\/missing\.ts Error: path not found: src\/missing\.ts$/, 'a missing path is an error, with the repo-relative path');
  assert.doesNotMatch(rows[3].text, /Denied by policy|USER_PATH|AppData|Temp|aitiarch-inv/i, 'and is not called a denial or shown as a user path');
  assert.doesNotMatch(rows[2].text, /^Read notes\.private\.md Error/, 'the denial is not an error');
  assert.match(rows[0].text, /2 lines of output/);
  assert.equal(await panel.locator('.inv-thinking details').evaluate((d) => d.open), false, 'thinking is collapsed by default');
  assert.match(await panel.locator('.inv-thinking summary').innerText(), /Thinking/);
  const banner = await panel.locator('.inv-banner[data-kind="denied"]').innerText();
  assert.match(banner, /Denied reads: Read notes\.private\.md/); assert.doesNotMatch(banner, /missing\.ts/, 'the denied list holds real denials only, not tool errors');
  const chips = panel.locator('button.claim-chip'); assert.equal(await chips.count(), 2);
  assert.match(await chips.nth(0).innerText(), /src\/login\.js:3.*Found/s); assert.match(await chips.nth(1).innerText(), /Quote not found/);
  assert.equal(errors.length, 0, 'no page error (the unknown event was tolerated): ' + errors.join('; '));
  await panel.screenshot({ path: path.join(output, 'investigate-trail.png') });
  // A file claim opens a read-only excerpt of the real file at its line; Escape closes it and puts focus back.
  await chips.nth(0).focus(); await page.keyboard.press('Enter'); await panel.getByRole('button', { name: 'Show the file' }).click();
  const excerpt = panel.getByRole('complementary', { name: 'Excerpt of src/login.js' }); await excerpt.waitFor();
  assert.match(await excerpt.locator('.inv-line[data-here]').innerText(), /const sessions = new Map\(\);/);
  assert.equal(await focused(), 'Close excerpt'); await page.keyboard.press('Escape'); await excerpt.waitFor({ state: 'detached' });
  assert.equal(await focused(), 'Show the file', 'focus returns to where the excerpt was opened from');
  // A Read row opens the same excerpt.
  await panel.locator('.inv-target-link').first().click(); await panel.locator('.inv-excerpt').waitFor(); await page.keyboard.press('Escape');

  // Cancel while a turn runs: the status bar shows time, turns and the cap; Cancel stops it and says so.
  await scenario('inv-slow'); await composer.fill('Something slow'); await page.keyboard.press('Enter');
  const status = panel.getByRole('status', { name: 'Investigation progress' }); await status.waitFor();
  assert.match(await status.innerText(), /\d+s.*tool calls?.*cap \$0\.50/s); assert(!/of 12|turns/i.test(await status.innerText()), 'the status bar shows no turn limit');
  await page.waitForTimeout(650); // Cancel ignores clicks for 600 ms after a send, so a double tap on Send cannot cancel the run it started
  await status.getByRole('button', { name: 'Cancel' }).click();
  await panel.locator('.inv-banner[data-kind="stopped"]').last().waitFor();
  assert.match(await panel.locator('.inv-banner[data-kind="stopped"]').last().innerText(), /You cancelled it/);

  // The turn limit: a partial answer, said honestly, with what was opened and how much was not.
  await scenario('inv-turns'); await composer.fill('Look everywhere'); await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('#chat-panel .inv-banner[data-kind="stopped"]').length === 2);
  const partial = await panel.locator('.inv-banner[data-kind="stopped"]').last().innerText();
  assert.match(partial, /Stopped as a safety measure/); assert.doesNotMatch(partial, /turn limit|12/i); assert.match(partial, /files in the copy were not opened/);
  // The text written before the calls is narration, not an answer: the banner says no answer was written yet.
  assert.match(partial, /No answer was written yet\./); assert.doesNotMatch(partial, /Partial so far/);
  assert.match(await panel.locator('.inv-turn').last().locator('.inv-narration').first().innerText(), /Partial so far: login lives in src\./);
  assert.equal(await panel.locator('.inv-turn').last().locator('.chat-ai').count(), 0, 'narration is not shown as an answer');
  assert.match(await panel.locator('.inv-turn').last().locator('.inv-trail').innerText(), /stopped before it finished/); assert.doesNotMatch(await panel.locator('.inv-turn').last().locator('.inv-trail').innerText(), /running…/);
  await panel.locator('.inv-turn').last().screenshot({ path: path.join(output, 'investigate-partial.png') });
  // The backstop stop also needs a fresh confirmed plan before the same session goes on (the server wants it too).
  const idle = () => page.waitForFunction(() => !document.querySelector('#chat-panel .inv-status[aria-label="Investigation progress"]'));
  await scenario('inv-ok'); await panel.locator('.inv-banner[data-kind="stopped"]').last().getByRole('button', { name: 'Continue with a new plan' }).click();
  await panel.getByRole('group', { name: 'Plan for this investigation' }).getByRole('button', { name: 'Confirm and continue' }).click();
  await page.waitForFunction(() => document.querySelectorAll('#chat-panel .inv-turn').length === 4); await idle();

  // Narration before the calls is a grey row in order; the answer is only the final text, in two paragraphs.
  await scenario('inv-narrate'); await composer.fill('Explain it'); await page.keyboard.press('Enter');
  const narr = panel.locator('.inv-turn').nth(4); await narr.getByText('That is the whole story.').waitFor(); await idle();
  const order = await narr.locator('.inv-trail > li').evaluateAll((els) => els.map((e) => (e.classList.contains('inv-narration') ? 'narration' : e.querySelector('.inv-tool')?.textContent)));
  assert.deepEqual(order, ['narration', 'Glob', 'narration', 'Read'], 'narration and tool rows in the order they happened');
  assert.deepEqual(await narr.locator('.inv-narration').allInnerTexts(), ['I will look at the files first.', 'Now reading the login file.']);
  const paras = await narr.locator('.chat-ai p').allInnerTexts(); assert.deepEqual(paras.filter(Boolean), ['Login keeps sessions in a Map.', 'That is the whole story.'], 'the answer is only the final text, paragraphs separated');
  await narr.screenshot({ path: path.join(output, 'investigate-narration.png') });

  // The cost cap: a stop on it offers Continue, which needs a fresh confirmed plan and resumes the same session.
  await scenario('inv-budget'); await composer.fill('Read everything'); await page.keyboard.press('Enter');
  const capStop = panel.locator('.inv-banner[data-kind="stopped"]').last(); await capStop.getByText('It reached the cost cap.').waitFor();
  assert.match(await capStop.innerText(), /No answer was written yet\./); assert.equal(await panel.getByRole('textbox', { name: 'Ask about the repo' }).count(), 0 || await panel.getByRole('textbox', { name: 'Ask about the repo' }).count());
  const refused2 = await page.evaluate(async (s) => (await fetch('/api/harness/investigate/send', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Aitiarch': '1' }, body: JSON.stringify({ session: s, question: 'again' }) })).json(), session);
  assert.equal(refused2.error, 'plan_required', 'after a cap stop the server wants a fresh confirmed plan');
  await scenario('inv-ok'); await capStop.getByRole('button', { name: 'Continue with a new plan' }).click();
  const card2 = panel.getByRole('group', { name: 'Plan for this investigation' }); await card2.waitFor();
  assert.match(await card2.innerText(), /Before it continues/); await card2.getByLabel('Cost cap per question').fill('0.40'); await card2.getByRole('button', { name: 'Update the plan' }).click();
  await page.waitForFunction(() => document.querySelector('#chat-panel .inv-plan .inv-confirm')?.disabled === false);
  await card2.getByRole('button', { name: 'Confirm and continue' }).click();
  await page.waitForFunction(() => document.querySelectorAll('#chat-panel .inv-turn').length === 7); await idle();
  assert.equal(await panel.locator('.inv-turn .chat-you p').last().innerText(), 'Please continue where you stopped.');
  const calls = (await readFile(record, 'utf8')).trim().split('\n').map((l) => JSON.parse(l)), last = calls.at(-1);
  assert(last.args.includes('--resume') && last.args[last.args.indexOf('--max-budget-usd') + 1] === '0.40', 'it resumed the same session with the new cap');

  // The tripwire: a change to the notebook during a run shows a banner; Restore puts it back.
  await scenario('inv-write-notebook|' + path.join(notebook, 'plan.md')); await composer.fill('Anything'); await page.keyboard.press('Enter');
  const trip = panel.locator('.inv-banner[data-kind="tripwire"]'); await trip.waitFor();
  assert.match(await trip.innerText(), /Your notebook changed during this run\. Changed: plan\.md/);
  await trip.getByRole('button', { name: /Restore/ }).click(); await panel.getByText('The notebook is back as it was before the run.').waitFor();
  assert.equal(await readFile(path.join(notebook, 'plan.md'), 'utf8'), '# Plan\n\nKeep this.\n');

  // A reload shows the questions and answers of this investigation (kept outside the repo).
  await openPanel(); await panel.locator('.chat-pick-trigger').click(); await panel.locator('.chat-pick-opt[data-value="' + session + '"]').click();
  await panel.locator('.inv-turn').nth(7).waitFor();
  const questions = await panel.locator('.inv-turn .chat-you p').allInnerTexts();
  assert.deepEqual(questions, ['How does login work?', 'Something slow', 'Look everywhere', 'Please continue where you stopped.', 'Explain it', 'Read everything', 'Please continue where you stopped.', 'Anything']);
  assert(path.relative(notebook, harness).startsWith('..'), 'the record is outside the notebook');

  // Narrow width: nothing overflows sideways.
  await page.setViewportSize({ width: 420, height: 860 });
  const overflow = await panel.evaluate((p) => p.scrollWidth - p.clientWidth); assert(overflow <= 1, 'no sideways overflow at 420px: ' + overflow);
  await panel.screenshot({ path: path.join(output, 'investigate-narrow.png') });
  await page.setViewportSize({ width: 1440, height: 900 });

  // Markdown renders while the answer streams, by the same renderer as the final answer. Every animation frame is recorded: no raw ** or backtick ever reaches the DOM text,
  // the DOM re-renders at most once per frame, nothing above the answer moves, and the DOM after the final replace is exactly what the last streamed frame showed.
  await scenario('inv-md'); await composer.fill('Explain it with formatting');
  await page.evaluate(() => {
    const rec = window.__rec = { snaps: [], batches: [], tops: [], done: false }; let batches = 0, observed = null, observer = null, seenRunning = false;
    const tick = () => {
      const turn = [...document.querySelectorAll('#chat-panel .inv-turn')].at(-1), ai = turn?.querySelector('.chat-ai .reply-markdown'), running = turn?.dataset.running !== undefined;
      seenRunning ||= running; // nothing is recorded until the new turn is on the page (the last turn before that is the previous one)
      if (!seenRunning) { requestAnimationFrame(tick); return; }
      if (ai) {
        if (ai !== observed) { observer?.disconnect(); observer = new MutationObserver(() => { batches++; }); observer.observe(ai, { childList: true, subtree: true, characterData: true, attributes: true }); observed = ai; }
        rec.snaps.push({ running, html: ai.innerHTML, text: ai.innerText, caret: !!turn.querySelector('.chat-ai > .chat-caret') });
        rec.batches.push(batches); batches = 0;
        const sc = turn.closest('.inv-log')?.scrollTop ?? 0; // position inside the log, so following the answer down does not count as movement
        rec.tops.push([turn.querySelector('.chat-you').getBoundingClientRect().top + sc, turn.querySelector('.inv-trail').getBoundingClientRect().top + sc]);
        if (seenRunning && !running) { rec.done = true; return; }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__rec.done, null, { timeout: 30000 });
  const rec = await page.evaluate(() => window.__rec), live = rec.snaps.filter((s) => s.running), fin = rec.snaps.at(-1);
  assert(live.length > 20, `the answer was captured while streaming (${live.length} frames)`);
  assert(new Set(live.map((s) => s.html)).size >= 15, 'the rendered answer changed many times as it streamed');
  const rawMark = /\*\*|`|~~|\]\(/, loneMarker = /^\s*(?:[-*+]|\d+[.)]|>|#{1,6})\s*$/m;
  const raw = rec.snaps.filter((s) => rawMark.test(s.text) || loneMarker.test(s.text)).map((s) => JSON.stringify(s.text.slice(-60)));
  assert.deepEqual(raw, [], 'no raw ** or backtick, and no lone list marker, ever appeared in the answer text: ' + raw.slice(0, 3).join(' | '));
  assert(live.some((s) => /<strong>/.test(s.html) && /<code>/.test(s.html) && /<li>/.test(s.html) && /<pre/.test(s.html)), 'bold, code, a list and a code block were already formatted while streaming');
  assert(live.every((s) => s.caret) && !fin.caret, 'the caret shows while it streams and goes when it ends');
  assert.equal(fin.running, false); const lastLive = live.at(-1);
  assert.equal(lastLive.html, fin.html, 'the DOM after the final replace is exactly the last streamed render');
  assert(Math.max(...rec.batches) <= 1, 'the answer re-rendered at most once per animation frame (most in one frame: ' + Math.max(...rec.batches) + ')');
  for (const col of [0, 1]) { const ys = rec.tops.map((t) => t[col]); assert(Math.max(...ys) - Math.min(...ys) <= 0.5, `nothing above the answer moved while it streamed (${col ? 'trail' : 'question'}: ${Math.min(...ys)}..${Math.max(...ys)})`); }
  const narr2 = panel.locator('.inv-turn').last().locator('.inv-narration').first();
  assert.equal(await narr2.locator('code').allInnerTexts().then((a) => a.join('|')), 'src/login.js', 'narration shows inline code as code');
  assert.equal(await narr2.locator('strong, em, a, ul, li').count(), 0, 'and nothing else is formatted in narration'); assert.match(await narr2.innerText(), /\*\*not bold\*\*/);
  assert.equal(await panel.locator('.inv-turn').last().locator('.chat-ai a').count(), 0, 'links are not clickable, while streaming or after');
  await panel.locator('.inv-turn').last().screenshot({ path: path.join(output, 'investigate-markdown.png') });

  // Delete removes it from the list and removes its stored turns.
  await panel.locator('.chat-pick-trigger').click(); await panel.getByRole('button', { name: 'Delete', exact: true }).click();
  await panel.getByRole('group', { name: 'Delete this conversation' }).getByRole('button', { name: 'Delete', exact: true }).click();
  await panel.locator('.chat-pick-trigger').click(); await page.waitForFunction((s) => ![...document.querySelectorAll('#chat-panel .chat-pick-opt')].some((o) => o.dataset.value === s), session);
  assert.equal((await readdir(path.join(harness, 'investigations'))).includes(session + '.json'), false, 'its stored turns are gone');
  assert.deepEqual(external, [], 'no request left the machine');
  console.log(JSON.stringify({ passed: true, ...report }, null, 1));
  await context.close();
} finally { await browser.close(); watcher.stop(); await app.close(); for (const d of [notebook, repo, harness, scratch]) await rm(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
