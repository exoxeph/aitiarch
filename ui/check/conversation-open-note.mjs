// Real-browser check (C3): diagrams follow the OPEN note, against the synthetic Claude Code CLI (no model, no live call).
//  - a conversation started on A (no diagrams): the person opens B (D1 and an untitled D2) and asks about D1: the plan card lists B's diagrams, approving lets the turn open B's pictures, an "Opened D1" row shows;
//  - back on A: tool-less, no card, nothing of B in the message; on C: the approval for B does not cover it (card again, C's diagram only, and the server refuses the turn without it); then B needs the card again;
//  - a diagram that is withheld (secret-looking text) and that the model asks for: the row "Could not open D2" and a plain reply, and the row is still there after a reload.
// Run after `vite build`: BATCH2A_OUTPUT=<folder outside the repo> node check/conversation-open-note.mjs
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

const here = path.dirname(fileURLToPath(import.meta.url));
const output = process.env.BATCH2A_OUTPUT || process.env.GROVE_OUTPUT;
if (!output || path.resolve(output).toLowerCase().startsWith(path.resolve(here, '..', '..').toLowerCase())) throw new Error('Set BATCH2A_OUTPUT to a folder outside the repository.');
await mkdir(output, { recursive: true });
const tmp = (n) => mkdtemp(path.join(os.tmpdir(), n));
const notebook = await tmp('aitiarch-opennote-nb-'), harness = await tmp('aitiarch-opennote-h-'), scratch = await tmp('aitiarch-opennote-s-');
const scenarioFile = path.join(scratch, 'scenario.txt'), record = path.join(scratch, 'calls.jsonl'), scenario = (s) => writeFile(scenarioFile, s);
const sha = (t) => createHash('sha256').update(t).digest('hex');
const drawing = (label, a, b) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 300" width="640" height="300"><rect x="10" y="10" width="200" height="60" fill="#cfe8ff" stroke="#222"/><rect x="320" y="10" width="200" height="60" fill="#d8f3c8" stroke="#222"/><text x="20" y="45" font-size="16">${a}</text><text x="330" y="45" font-size="16">${b}</text><text x="10" y="290" font-size="12">${label}</text></svg>`;
const mk = (alt, label, a, b) => { const svg = drawing(label, a, b); return { alt, svg, base: 'diagram-' + sha(svg) }; };
const alpha = mk('AI diagram: alpha-skill', 'Alpha flow', 'Quillfern', 'Mossgate'), untitled = mk('', 'Untitled flow', 'Nettle', 'Brook'), gamma = mk('AI diagram: gamma-skill', 'Gamma flow', 'Heron', 'Wold'), keys = mk('AI diagram: keys', 'password=hunter2-opennote-secret', 'Key', 'Lock');
const line = (d) => `> ![${d.alt}](assets/${d.base}.svg)\n`;
execFileSync('git', ['init', '-q'], { cwd: notebook }); await writeFile(path.join(notebook, '.gitignore'), '/chat/\n'); await mkdir(path.join(notebook, 'assets'));
for (const d of [alpha, untitled, gamma, keys]) await writeFile(path.join(notebook, 'assets', d.base + '.svg'), d.svg);
await writeFile(path.join(notebook, 'a.md'), '# A\n\nA note without diagrams.\n');
await writeFile(path.join(notebook, 'b.md'), ['# B', '', line(alpha), line(untitled)].join('\n'));
await writeFile(path.join(notebook, 'c.md'), ['# C', '', line(gamma)].join('\n'));
await writeFile(path.join(notebook, 'd.md'), ['# D', '', line(alpha), line(keys)].join('\n'));
await scenario('ok');
const store = await Store.open(notebook), watcher = new NoteWatcher(store);
const app = createApp({ store, watcher, distDir: path.join(here, '../dist'), provider: new FakeChatProvider(), harness: { command: process.execPath, prefixArgs: [path.join(here, '..', 'test', 'fixtures', 'harness-cli.mjs'), '@' + scenarioFile, record], dir: harness } });
const browser = await (async () => { for (const channel of ['msedge', 'chrome']) { try { return await chromium.launch({ channel, headless: true }); } catch { /* next */ } } throw new Error('Edge or Chrome is required.'); })();
const external = [], errors = [];
const calls = async () => (await readFile(record, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const arg = (c, flag) => c.args[c.args.indexOf(flag) + 1];
try {
  const url = `http://127.0.0.1:${await app.listen(0)}/?debug=1`, context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' }), page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('request', (r) => { const u = new URL(r.url()); if (u.origin !== new URL(url).origin && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) external.push(r.url()); });
  page.on('pageerror', (e) => errors.push(e.message));
  const panel = page.locator('#chat-panel'), composer = () => panel.getByRole('textbox', { name: 'Message Aitiarch AI' });
  const text = async (loc) => (await loc.innerText()).replace(/\s+/g, ' ').trim();
  const openNote = async (file) => { for (let attempt = 0; ; attempt++) { await page.keyboard.press('Control+k'); const palette = page.getByRole('dialog', { name: 'Command palette' }); await palette.waitFor(); const search = palette.getByRole('textbox'); await search.fill('Jump to note: ' + file); await search.press('Enter'); try { await page.waitForFunction((f) => window.__aitiarch?.[f] && document.querySelector('.tab.on')?.textContent?.toLowerCase().includes(f.replace('.md', '')), file, { timeout: 6000 }); return; } catch (e) { if (attempt >= 2) throw e; await page.keyboard.press('Escape'); } } };
  const ready = () => page.waitForFunction(() => { const t = document.querySelector('#chat-panel .chat-composer textarea'); return t && !t.disabled; });
  const done = () => page.evaluate(() => document.querySelectorAll('#chat-panel .chat-turn[data-status="complete"]').length);
  const settled = (n) => page.waitForFunction((k) => document.querySelectorAll('#chat-panel .chat-turn[data-status="complete"]').length > k, n);
  const picturesFor = async (assets) => { for (let i = 0; i < 100; i++) { const have = (await page.evaluate((a) => fetch('/api/diagram-images?names=' + a.map((x) => x + '.png').join(',')).then((r) => r.json()), assets)).images.length; if (have === assets.length) return; await page.waitForTimeout(200); } throw new Error('the pictures were not made'); };
  let reviewed = false;
  /** Sends a question. `card`: the plan card must (or must not) be shown first. */
  const ask = async (q, { card = false } = {}) => {
    await ready(); const before = await done(); await composer().fill(q); await composer().press('Enter');
    const plan = panel.getByRole('group', { name: 'Plan for this conversation' }), review = panel.getByRole('region', { name: 'What will be sent' });
    await page.waitForFunction((k) => document.querySelector('#chat-panel .chat-plan') || document.querySelector('#chat-panel .chat-review') || document.querySelectorAll('#chat-panel .chat-turn[data-status="complete"]').length > k || document.querySelector('#chat-panel .chat-turn[data-status="streaming"]'), before);
    assert.equal(await plan.count() > 0, card, `"${q}": the plan card ${card ? 'is' : 'is not'} shown`);
    return { plan, review, before,
      approve: async () => { await plan.getByRole('button', { name: 'Approve and send' }).click(); await page.waitForFunction(() => !document.querySelector('#chat-panel .chat-plan')); },
      send: async () => { if (await review.count()) { if (!reviewed) { await review.getByRole('checkbox').check(); reviewed = true; } await review.getByRole('button', { name: 'Send to Claude', exact: true }).click(); } await settled(before); } };
  };
  const put = (u, b) => page.evaluate(async ([x, body]) => { const r = await fetch(x, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Aitiarch': '1' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => null) }; }, [u, b]);
  const diagramsLine = (t) => text(t.plan.locator('[data-plan="diagrams"]'));

  await page.goto(url); await page.waitForSelector('.cm-editor'); await openNote('a.md');
  await page.getByRole('button', { name: /^Chat/ }).click(); await panel.waitFor(); await ready();
  // the page makes the pictures of a note's diagrams when the note is open: open each note once
  await openNote('b.md'); await picturesFor([alpha.base, untitled.base]); await openNote('c.md'); await picturesFor([gamma.base]); await openNote('d.md'); await picturesFor([alpha.base, keys.base]); await openNote('a.md');

  // 1. A conversation started on A (no diagrams): a notes turn needs no card and is tool-less.
  await panel.locator('.chat-pick-trigger').click(); await panel.getByRole('button', { name: 'New', exact: true }).click(); await page.waitForFunction(() => /Conversation 1/.test(document.querySelector('#chat-panel .chat-pick-trigger')?.textContent ?? ''));
  let t = await ask('What is this note about?'); await t.send(); let c = (await calls()).at(-1);
  assert.equal(arg(c, '--tools'), '', 'tool-less on A'); assert.deepEqual(c.cwdFiles, []);
  const session = await page.evaluate(() => document.querySelector('#chat-panel .chat-pick-trigger').dataset.session);

  // 2. Open B and ask about D1: the card lists B's diagrams (the untitled one under its fallback label); approving it opens B's pictures; the row "Opened D1" shows.
  await openNote('b.md'); await scenario('dg-read');
  t = await ask('What does D1 show?', { card: true });
  assert.equal(await diagramsLine(t), "Claude may open these diagrams: D1 'alpha-skill', D2 'Diagram 2 under B' (up to $0.50). It opens one only when your question needs it.");
  assert.equal(await t.plan.locator('.chat-plan-withheld').count(), 0, 'nothing of B is withheld');
  await panel.screenshot({ path: path.join(output, 'open-note-card-b.png') });
  await t.approve(); await t.send(); c = (await calls()).at(-1);
  assert.equal(arg(c, '--tools'), 'Read'); assert.deepEqual(c.cwdFiles.map((f) => f.name), ['d1.png', 'd2.png'], "the folder holds B's two pictures");
  assert.match(c.stdin.split('\n\n')[0], /^Open note: B \(.*Diagrams: D1 'alpha-skill', D2 'Diagram 2 under B'\./);
  assert.match(await text(panel.locator('.chat-turn').last().locator('.chat-opened')), /Opened D1 'alpha-skill'/);
  t = await ask('And once more?'); await t.send(); assert.equal(arg((await calls()).at(-1), '--tools'), 'Read', 'B is covered now: no card');

  // 3. Back on A: A's set (none). Tool-less, no card, nothing of B in the message; the approval for B is not used for A.
  await openNote('a.md'); await scenario('ok');
  t = await ask('Back on A: what is here?'); await t.send(); c = (await calls()).at(-1);
  assert.equal(arg(c, '--tools'), ''); assert.deepEqual(c.cwdFiles, []); assert.doesNotMatch(c.stdin.split('\n\n')[0], /alpha-skill|Diagram 2|Diagrams/, "no diagram of B in A's message");

  // 4. C: the approval for B does not cover it. The server refuses the turn without the card, the card lists C's diagram only, and afterwards B needs the card again.
  await openNote('c.md'); await scenario('dg-read');
  const refused = await put('/api/conversation/turn', { conversationId: session, path: 'a.md', openNote: 'c.md', attachments: {}, text: 'q', id: 'm-direct', editor: { path: 'c.md', title: 'C' } });
  assert.equal(refused.status, 409); assert.equal(refused.body.error, 'plan_required'); assert.deepEqual(refused.body.plan.openDiagrams, [{ n: 1, title: 'gamma-skill' }]);
  t = await ask('What does C show?', { card: true });
  assert.equal(await diagramsLine(t), "Claude may open this diagram: D1 'gamma-skill' (up to $0.50). It opens one only when your question needs it.", "C's diagram only, not B's");
  await t.approve(); await t.send(); c = (await calls()).at(-1); assert.equal(arg(c, '--tools'), 'Read'); assert.deepEqual(c.cwdFiles.map((f) => f.name), ['d1.png']);
  await openNote('b.md'); t = await ask('Back to B, D1 again?', { card: true });
  assert.match(await diagramsLine(t), /D1 'alpha-skill', D2 'Diagram 2 under B'/, 'B needs its card again: one note\'s approval at a time');
  await t.plan.getByRole('button', { name: 'Cancel' }).click(); await page.waitForFunction(() => !document.querySelector('#chat-panel .chat-plan'));

  // 5. A withheld diagram the model asks for: the card lists it with its reason; the turn gets the row "Could not open D2" and a plain reply; the row survives a reload.
  await openNote('d.md'); await scenario('dg-unavailable|2');
  t = await ask('What does D2 show?', { card: true });
  assert.match(await diagramsLine(t), /Claude may open this diagram: D1 'alpha-skill'/);
  assert.match(await text(t.plan.locator('.chat-plan-withheld')), /D2 'keys' withheld: looks like a secret/);
  await t.approve(); await t.send();
  const row = () => panel.locator('.chat-turn').last().locator('.chat-opened .inv-row');
  const rowText = "Could not open D2 'keys': looks like a secret (it holds text that looks like a secret)";
  assert.deepEqual((await row().allInnerTexts()).map((x) => x.replace(/\s+/g, ' ').trim()), [rowText]); assert.equal(await row().first().getAttribute('data-state'), 'error');
  assert.match(await text(panel.locator('.chat-turn').last().locator('.chat-ai')), /D2 is unavailable: looks like a secret/);
  await page.reload(); await page.waitForFunction(() => document.querySelector('.cm-editor') && window.__aitiarch); await openNote('d.md'); await page.getByRole('button', { name: /^Chat/ }).click(); await panel.waitFor(); await ready();
  await page.waitForFunction(() => document.querySelectorAll('#chat-panel .chat-turn[data-status="complete"]').length >= 5);
  assert.deepEqual((await row().allInnerTexts()).map((x) => x.replace(/\s+/g, ' ').trim()), [rowText], 'the row is still there after a reload');
  await panel.screenshot({ path: path.join(output, 'open-note-miss-reloaded.png') });

  assert.equal(errors.length, 0, 'no page error: ' + errors.join('; ')); assert.deepEqual(external, [], 'no request left the machine');
  assert.equal(await readFile(path.join(notebook, 'a.md'), 'utf8'), '# A\n\nA note without diagrams.\n', 'the notes are untouched');
  console.log('conversation-open-note: ok');
  await context.close();
} finally { watcher.stop(); await app.close(); await browser.close(); for (const d of [notebook, harness, scratch]) await rm(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
