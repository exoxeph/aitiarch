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
  await panel.getByRole('button', { name: 'New', exact: true }).click();

  // The plan card comes first; there is no composer until it is confirmed, and the server refuses a turn without it.
  const card = panel.getByRole('group', { name: 'Plan for this investigation' }); await card.waitFor();
  const cardText = await card.innerText();
  for (const s of ['Repo folder', 'Files Claude can read', 'Never copied', 'notebook.md', 'Cost cap', '$0.50', 'Turn limit', '12 model turns']) assert(cardText.includes(s), 'plan card shows ' + s);
  assert.equal(await panel.getByRole('textbox', { name: 'Ask about the repo' }).count(), 0, 'no composer before the plan is confirmed');
  const session = await page.evaluate(() => document.querySelector('#chat-panel .chat-sessions-pick select').value);
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
  assert.deepEqual(rows.map((r) => [r.text.split(' ')[0], r.state]), [['Glob', 'ok'], ['Grep', 'ok'], ['Read', 'denied'], ['Read', 'ok']]);
  assert.match(rows[2].text, /Denied by policy: Permission to read notes\.private\.md has been denied\./);
  assert.match(rows[0].text, /2 lines of output/);
  assert.equal(await panel.locator('.inv-thinking details').evaluate((d) => d.open), false, 'thinking is collapsed by default');
  assert.match(await panel.locator('.inv-thinking summary').innerText(), /Thinking/);
  assert.match(await panel.locator('.inv-banner[data-kind="denied"]').innerText(), /Denied reads: Read notes\.private\.md/);
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
  assert.match(await status.innerText(), /of 12 turns.*cap \$0\.50/s);
  await status.getByRole('button', { name: 'Cancel' }).click();
  await panel.locator('.inv-banner[data-kind="stopped"]').last().waitFor();
  assert.match(await panel.locator('.inv-banner[data-kind="stopped"]').last().innerText(), /You cancelled it/);

  // The turn limit: a partial answer, said honestly, with what was opened and how much was not.
  await scenario('inv-turns'); await composer.fill('Look everywhere'); await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('#chat-panel .inv-banner[data-kind="stopped"]').length === 2);
  const partial = await panel.locator('.inv-banner[data-kind="stopped"]').last().innerText();
  assert.match(partial, /It reached the turn limit\. The answer below is partial/); assert.match(partial, /files in the copy were not opened/);
  await panel.screenshot({ path: path.join(output, 'investigate-partial.png') });

  // The tripwire: a change to the notebook during a run shows a banner; Restore puts it back.
  await scenario('inv-write-notebook|' + path.join(notebook, 'plan.md')); await composer.fill('Anything'); await page.keyboard.press('Enter');
  const trip = panel.locator('.inv-banner[data-kind="tripwire"]'); await trip.waitFor();
  assert.match(await trip.innerText(), /Your notebook changed during this run\. Changed: plan\.md/);
  await trip.getByRole('button', { name: /Restore/ }).click(); await panel.getByText('The notebook is back as it was before the run.').waitFor();
  assert.equal(await readFile(path.join(notebook, 'plan.md'), 'utf8'), '# Plan\n\nKeep this.\n');

  // A reload shows the questions and answers of this investigation (kept outside the repo).
  await openPanel(); await panel.locator('.chat-sessions-pick select').selectOption(session);
  await panel.locator('.inv-turn').nth(3).waitFor();
  const questions = await panel.locator('.inv-turn .chat-you p').allInnerTexts();
  assert.deepEqual(questions, ['How does login work?', 'Something slow', 'Look everywhere', 'Anything']);
  assert(path.relative(notebook, harness).startsWith('..'), 'the record is outside the notebook');

  // Narrow width: nothing overflows sideways.
  await page.setViewportSize({ width: 420, height: 860 });
  const overflow = await panel.evaluate((p) => p.scrollWidth - p.clientWidth); assert(overflow <= 1, 'no sideways overflow at 420px: ' + overflow);
  await panel.screenshot({ path: path.join(output, 'investigate-narrow.png') });
  await page.setViewportSize({ width: 1440, height: 900 });

  // Delete removes it from the list and removes its stored turns.
  await panel.getByRole('button', { name: 'Delete', exact: true }).click();
  await panel.getByRole('group', { name: 'Delete this conversation' }).getByRole('button', { name: 'Delete', exact: true }).click();
  await page.waitForFunction((s) => ![...document.querySelectorAll('#chat-panel .chat-sessions-pick option')].some((o) => o.value === s), session);
  assert.equal((await readdir(path.join(harness, 'investigations'))).includes(session + '.json'), false, 'its stored turns are gone');
  assert.deepEqual(external, [], 'no request left the machine');
  console.log(JSON.stringify({ passed: true, ...report }, null, 1));
  await context.close();
} finally { await browser.close(); watcher.stop(); await app.close(); for (const d of [notebook, repo, harness, scratch]) await rm(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
