// Real-browser check for diagrams in a conversation, against the synthetic Claude Code CLI (no model, no live call):
//  - a diagram saved as an svg only gets its PNG the first time its note is opened (drawn in the page on a light background, checked by the server); one that cannot be drawn has none and is not retried;
//  - there are no diagram chips: the review card says which diagrams Claude may open and the cost cap, and which are withheld and why; the line the message starts with lists them;
//  - the CLI gets exactly Read with the diagram copies (d1.png ...) as its working folder, and plain text on stdin;
//  - each Read shows as a trail row "Opened D1 'title'" above the reply, the turn cost under it, and both are still there after a reload;
//  - a claim about a picture reads "from the diagram image, not quote-checked"; a Read outside the folder and the cost cap stop the turn and say so; a turn that needs no diagram opens none;
//  - a note without diagrams stays tool-less;
//  - the D3 bug: a note with an unnamed diagram, one saved without a picture and one whose saved picture is oversize, plus a secret-shaped one: the page makes or repairs the pictures, and the card
//    and the manifest show all of them with the right status; a Read of the withheld one gets a row with the reason and a reply, not a dead turn.
// Run after `vite build`: BATCH2A_OUTPUT=<folder outside the repo> node check/diagram-chat.mjs
import './config-isolation.mjs'; // first: an empty temp config folder, never the machine's real one
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
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
const notebook = await tmp('aitiarch-diagchat-nb-'), harness = await tmp('aitiarch-diagchat-h-'), scratch = await tmp('aitiarch-diagchat-s-');
const scenarioFile = path.join(scratch, 'scenario.txt'), record = path.join(scratch, 'calls.jsonl');
const sha = (t) => createHash('sha256').update(t).digest('hex');
const drawing = (label, w, h, a, b) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><rect x="10" y="10" width="${w / 3}" height="60" fill="#cfe8ff" stroke="#222"/><rect x="${w / 2}" y="10" width="${w / 3}" height="60" fill="#d8f3c8" stroke="#222"/><line x1="${w / 3 + 10}" y1="40" x2="${w / 2 - 2}" y2="40" stroke="#222" stroke-width="2"/><text x="20" y="45" font-size="16">${a}</text><text x="${w / 2 + 10}" y="45" font-size="16">${b}</text><text x="10" y="${h - 10}" font-size="12">${label}</text></svg>`;
const diagrams = [
  { title: 'alpha-skill', svg: drawing('Alpha flow', 800, 420, 'Quillfern', 'Mossgate') },
  { title: 'bravo-skill', svg: drawing('Bravo flow', 600, 300, 'Delta', 'Bravo') },
  { title: 'charlie-skill', svg: drawing('Charlie flow', 500, 260, 'Echo', 'Foxtrot') },
  { title: 'broken-skill', svg: 'this is not an svg at all, so the browser cannot draw it' },
].map((d) => ({ ...d, base: 'diagram-' + sha(d.svg) }));
const [D1, D2, D3, D4] = diagrams;
const line = (d) => `> ![AI diagram: ${d.title}](assets/${d.base}.svg)`;
const NOTE = ['# Plan', '', line(D1), '', 'Some text between.', '', line(D2), '', line(D3), '', line(D4), '', 'The end.', ''].join('\n');
execFileSync('git', ['init', '-q'], { cwd: notebook }); await writeFile(path.join(notebook, '.gitignore'), '/chat/\n'); await mkdir(path.join(notebook, 'assets'));
for (const d of diagrams) await writeFile(path.join(notebook, 'assets', d.base + '.svg'), d.svg);
await writeFile(path.join(notebook, 'plan.md'), NOTE); await writeFile(path.join(notebook, 'plain.md'), '# Plain\n\nNo diagrams here.\n'); await writeFile(scenarioFile, 'dg-read');
// The D3 bug: three diagrams (no name; saved without a picture; an oversize picture already on disk) and one with secret-shaped text.
const three = [
  { alt: '', svg: drawing('Unnamed flow', 640, 300, 'Nettle', 'Brook') },
  { alt: 'AI diagram: no-picture', svg: drawing('Saved without a picture', 640, 300, 'Larch', 'Fen') },
  { alt: 'AI diagram: oversize', svg: drawing('Oversize picture', 640, 300, 'Heron', 'Wold') },
  { alt: 'AI diagram: keys', svg: drawing('password=hunter2-check-secret', 640, 300, 'Key', 'Lock') },
].map((d) => ({ ...d, base: 'diagram-' + sha(d.svg) }));
for (const d of three) await writeFile(path.join(notebook, 'assets', d.base + '.svg'), d.svg);
const { makePng } = await import('../test/fixtures/png.ts');
await writeFile(path.join(notebook, 'assets', three[2].base + '.png'), makePng(1700, 40)); // an older picture, over 1,600 px: the page must replace it
const THREE = ['# Three', '', ...three.map((d) => `> ![${d.alt}](assets/${d.base}.svg)\n`), ''].join('\n');
await writeFile(path.join(notebook, 'three.md'), THREE);const provider = new FakeChatProvider();
const store = await Store.open(notebook), watcher = new NoteWatcher(store);
const app = createApp({ store, watcher, distDir: path.join(here, '../dist'), provider, harness: { command: process.execPath, prefixArgs: [path.join(here, '..', 'test', 'fixtures', 'harness-cli.mjs'), '@' + scenarioFile, record], dir: harness } });
const browser = await (async () => { for (const channel of ['msedge', 'chrome']) { try { return await chromium.launch({ channel, headless: true }); } catch { /* next */ } } throw new Error('Edge or Chrome is required.'); })();
const external = [], errors = [], puts = [], listings = [];
const calls = async () => (await readFile(record, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
try {
  const url = `http://127.0.0.1:${await app.listen(0)}/?debug=1`, context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' }), page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.origin !== new URL(url).origin && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) external.push(r.url());
    if (u.pathname === '/api/diagram-image' && r.method() === 'PUT') puts.push(JSON.parse(r.postData() ?? '{}').name);
    if (u.pathname === '/api/diagram-images') listings.push(decodeURIComponent(u.search));
  });
  page.on('pageerror', (e) => errors.push(e.message));
  const panel = page.locator('#chat-panel');
  const text = async (loc) => (await loc.innerText()).replace(/\s+/g, ' ').trim();
  const openNote = async (file) => { for (let attempt = 0; ; attempt++) { await page.keyboard.press('Control+k'); const palette = page.getByRole('dialog', { name: 'Command palette' }); await palette.waitFor(); const search = palette.getByRole('textbox'); await search.fill('Jump to note: ' + file); await search.press('Enter'); try { await page.waitForFunction((f) => window.__aitiarch?.[f] && document.querySelector('.tab.on')?.textContent?.toLowerCase().includes(f.replace('.md', '')), file, { timeout: 6000 }); return; } catch (e) { if (attempt >= 2) throw e; await page.keyboard.press('Escape'); } } };
  const composer = () => panel.getByRole('textbox', { name: 'Message Aitiarch AI' });
  let cards = 0; const submit = async (question) => { await page.waitForFunction(() => { const t = document.querySelector('.chat-composer textarea'); return t && !t.disabled; }); await composer().fill(question); await composer().press('Enter'); const plan = panel.getByRole('group', { name: 'Plan for this conversation' }), review = panel.getByRole('region', { name: 'What will be sent' });
    // a conversation opens diagrams only after its plan card is approved: the card comes first (once per conversation and note), then the review
    await page.waitForFunction(() => document.querySelector('#chat-panel .chat-plan') || document.querySelector('#chat-panel .chat-review'));
    if (await plan.count()) { cards++; await plan.getByRole('button', { name: 'Approve and send' }).click(); } await review.waitFor(); return review; };
  const settled = (n) => page.waitForFunction((k) => document.querySelectorAll('#chat-panel .chat-turn[data-status="complete"], #chat-panel .chat-turn[data-status="error"]').length > k, n);
  const done = () => page.evaluate(() => document.querySelectorAll('#chat-panel .chat-turn[data-status="complete"], #chat-panel .chat-turn[data-status="error"]').length);
  const ask = async (scenario, question) => { await writeFile(scenarioFile, scenario); const before = await done(), review = await submit(question); await review.getByRole('button', { name: 'Send', exact: true }).click(); await settled(before); return panel.locator('.chat-turn').last(); };
  const pictureThere = {};
  const info = async (base) => (await page.evaluate((n) => fetch('/api/diagram-images?names=' + n + '.png').then((r) => r.json()), base)).images[0] ?? null;

  // 1. Lazy pictures: the diagrams were saved as svg only, so no picture exists until their note is opened; then the three drawable diagrams get a PNG, the broken one gets none and is not retried.
  assert.deepEqual((await readdir(path.join(notebook, 'assets'))).filter((n) => n.endsWith('.png')), [three[2].base + '.png'], 'no picture before the note is opened, apart from the oversize one placed for the D3 case');
  await page.goto(url); await page.waitForFunction(() => document.querySelector('.cm-editor') && window.__aitiarch);
  await page.getByRole('button', { name: /^Chat/ }).click(); await panel.waitFor();
  await openNote('plan.md');
  for (let i = 0; i < 100 && ![D1, D2, D3].every((d) => pictureThere[d.base]); i++) { for (const d of [D1, D2, D3]) pictureThere[d.base] = !!(await info(d.base)); await page.waitForTimeout(200); }
  const meta = [await info(D1.base), await info(D2.base), await info(D3.base)];
  assert.deepEqual(meta.map((m) => [m.width, m.height]), [[1000, 525], [1000, 500], [1000, 520]], 'each drawn at 1,000 px on its longest side, keeping its proportions');
  assert(meta.every((m) => m.bytes <= 500 * 1024), 'at most 500 KB each');
  await page.waitForTimeout(600);
  assert.equal(await info(D4.base), null, 'the diagram that cannot be drawn has no picture'); assert(!puts.includes(D4.base + '.png'));
  assert.equal(puts.length, 3, 'each picture saved once');
  const listed = listings.filter((l) => l.includes(D4.base)).length;

  // 2. No diagram chips anywhere, in a one-off chat or a conversation.
  await page.waitForFunction(() => { const t = document.querySelector('.chat-composer textarea'); return t && !t.disabled; });
  assert.equal(await panel.locator('[data-chip^="diagram-"]').count(), 0, 'a one-off chat has no diagram chips');
  await panel.locator('.chat-pick-trigger').click(); await panel.getByRole('button', { name: 'New', exact: true }).click(); await page.waitForFunction(() => /Conversation 1/.test(document.querySelector('#chat-panel .chat-pick-trigger')?.textContent ?? ''));
  assert.equal(await panel.locator('[data-chip^="diagram-"]').count(), 0, 'a conversation has no diagram chips either');

  // 3. The review card: which diagrams Claude may open, the cap, the one withheld and why, and the editor line.
  let review = await submit('Which box feeds which in the diagram?'); assert.equal(cards, 1, 'the plan card came first, once');
  assert.equal(await text(review.locator('.chat-review-diagrams')), "Claude may open these diagrams: D1 'alpha-skill', D2 'bravo-skill', D3 'charlie-skill' (up to $0.50). It opens one only when your question needs it.");
  assert.equal(await text(review.locator('.chat-review-block')), "D4 'broken-skill' withheld: no picture yet.");
  assert.equal(await review.locator('img').count(), 0, 'no thumbnails');
  assert.equal(await text(review.locator('.chat-review-manifest')), `Open note: Plan (${NOTE.length} chars). Cursor section: Plan. Diagrams: D1 'alpha-skill', D2 'bravo-skill', D3 'charlie-skill'. D4 'broken-skill' withheld: no picture yet.`);
  await panel.screenshot({ path: path.join(output, 'diagram-read-review.png') });
  let before = await done(); await review.getByRole('button', { name: 'Send', exact: true }).click(); await settled(before);

  // 4. The CLI got Read and the copies; the trail row, the cost and the claim are shown.
  const [first] = await calls();
  assert.equal(first.args[first.args.indexOf('--tools') + 1], 'Read'); assert.equal(first.args[first.args.indexOf('--allowedTools') + 1], 'Read(./**)'); assert.equal(first.args[first.args.indexOf('--permission-mode') + 1], 'dontAsk');
  assert.equal(first.args[first.args.indexOf('--max-budget-usd') + 1], '0.50'); assert(!first.args.includes('--input-format'), 'no stream-json input');
  assert.deepEqual(first.cwdFiles.map((f) => f.name), ['d1.png', 'd2.png', 'd3.png'], 'the folder held only the copies of the three pictures');
  assert(first.stdin.startsWith('Open note: Plan') && first.stdin.endsWith('Which box feeds which in the diagram?'), 'plain text on stdin');
  let turn = panel.locator('.chat-turn').last();
  assert.deepEqual(await turn.locator('.chat-opened .inv-row').allInnerTexts().then((l) => l.map((x) => x.trim())), ["Opened D1 'alpha-skill'"], 'one trail row per diagram it opened');
  assert.equal(await turn.locator('.chat-opened .inv-row').first().getAttribute('data-state'), 'ok');
  assert.equal(await text(turn.locator('.chat-turn-cost')), 'This turn cost $0.012');
  const claim = turn.locator('.claim-chip').first(); await claim.waitFor({ state: 'attached' });
  assert.deepEqual([(await claim.locator('.claim-label').textContent()).trim(), (await claim.locator('.claim-state').textContent()).replace(/^\s*·\s*/, '').trim()], ['Diagram D1', 'From the diagram image, not quote-checked']);
  assert.equal(await turn.getByText('No valid source').count(), 0, 'never "no valid source" for a diagram it opened');
  await panel.screenshot({ path: path.join(output, 'diagram-read-row.png') });

  // 5. A turn that does not need a diagram opens none: no row. A Read outside the folder and the cost cap stop the turn and say so; nothing of them is kept.
  turn = await ask('dg-none', 'What is the plan?');
  assert.equal(await turn.locator('.chat-opened').count(), 0, 'no row when nothing was opened'); assert.equal(await text(turn.locator('.chat-turn-cost')), 'This turn cost $0.012');
  turn = await ask('dg-path|..\\x.png', 'Look at it');
  assert.equal(await text(turn.locator('.chat-error p')), 'The turn was stopped: it tried to open something that is not one of the diagram pictures. Nothing from it was kept.');
  await turn.getByRole('button', { name: 'Dismiss' }).click();
  turn = await ask('dg-budget', 'Look at every diagram');
  assert.equal(await text(turn.locator('.chat-error p')), 'The turn reached its cost cap of $0.50, so it was stopped. Nothing from it was kept.');
  await turn.getByRole('button', { name: 'Dismiss' }).click();

  // 6. After a reload the conversation shows the row, the cost and the claim again: they were saved with the reply.
  await page.reload(); await page.waitForFunction(() => document.querySelector('.cm-editor') && window.__aitiarch);
  if (!(await panel.isVisible())) await page.getByRole('button', { name: /^Chat/ }).click();
  await page.waitForFunction(() => document.querySelectorAll('#chat-panel .chat-turn[data-status="complete"]').length >= 2);
  const kept = panel.locator('.chat-turn[data-status="complete"]').first();
  assert.deepEqual(await kept.locator('.chat-opened .inv-row').allInnerTexts().then((l) => l.map((x) => x.trim())), ["Opened D1 'alpha-skill'"], 'the row is kept with the reply');
  assert.equal(await text(kept.locator('.chat-turn-cost')), 'This turn cost $0.012');
  assert.equal((await kept.locator('.claim-chip .claim-state').first().textContent()).replace(/^\s*·\s*/, '').trim(), 'From the diagram image, not quote-checked');

  // 8. The D3 bug. The page names the unnamed diagram, makes the missing picture and replaces the oversize one; the card and the manifest show every diagram with its status.
  await openNote('three.md');
  const ready = async () => { for (let i = 0; i < 100; i++) { const ok = await Promise.all(three.slice(0, 3).map((d) => info(d.base))); if (ok.every((m) => m && m.width <= 1600)) return ok; await page.waitForTimeout(200); } throw new Error('the pictures were not made'); };
  const made3 = await ready(); assert.deepEqual(made3.map((m) => m.width), [1000, 1000, 1000], 'the missing picture was made and the oversize one replaced');
  await panel.locator('.chat-pick-trigger').click(); await panel.getByRole('button', { name: 'New', exact: true }).click(); await page.waitForFunction(() => /Conversation 2/.test(document.querySelector('#chat-panel .chat-pick-trigger')?.textContent ?? ''));
  review = await submit('Explain the diagrams'); assert.equal(cards, 2, 'another conversation, another note: the card again');
  assert.equal(await text(review.locator('.chat-review-diagrams')), "Claude may open these diagrams: D1 'Diagram 1 under Three', D2 'no-picture', D3 'oversize' (up to $0.50). It opens one only when your question needs it.");
  assert.deepEqual(await review.locator('.chat-review-block[data-status="withheld"]').allInnerTexts(), ["D4 'keys' withheld: looks like a secret (it holds text that looks like a secret)."]);
  assert.match(await text(review.locator('.chat-review-manifest')), /Diagrams: D1 'Diagram 1 under Three', D2 'no-picture', D3 'oversize'\. D4 'keys' withheld: looks like a secret/);
  await panel.screenshot({ path: path.join(output, 'diagram-three-review.png') });
  before = await done(); await writeFile(scenarioFile, 'dg-unavailable|4'); await review.getByRole('button', { name: 'Send', exact: true }).click(); await settled(before);
  turn = panel.locator('.chat-turn').last();
  assert.deepEqual(await turn.locator('.chat-opened .inv-row').allInnerTexts().then((l) => l.map((x) => x.trim())), ["Could not open D4 'keys': looks like a secret (it holds text that looks like a secret)"]);
  assert.equal(await turn.locator('.chat-opened .inv-row').first().getAttribute('data-state'), 'error');
  assert.match(await text(turn.locator('.chat-ai')), /D4 is unavailable: looks like a secret/);
  assert.deepEqual((await calls()).at(-1).cwdFiles.map((f) => f.name), ['d1.png', 'd2.png', 'd3.png'], 'the withheld diagram was not copied');
  // 7. A note without diagrams stays tool-less; the broken diagram was not retried on this page (a reload starts a new page, which may look it up once more).
  await page.waitForTimeout(600);const listedNow = listings.filter((l) => l.includes(D4.base)).length, putsNow = puts.length;
  await openNote('plain.md'); await page.waitForTimeout(300);
  await panel.locator('.chat-pick-trigger').click(); await panel.getByRole('button', { name: 'New', exact: true }).click(); await page.waitForFunction(() => /Conversation 3/.test(document.querySelector('#chat-panel .chat-pick-trigger')?.textContent ?? ''));
  review = await submit('What is this note about?'); assert.equal(await review.locator('.chat-review-diagrams').count(), 0); assert.doesNotMatch(await text(review.locator('.chat-review-manifest')), /Diagrams/);
  before = await done(); await writeFile(scenarioFile, 'ok'); await review.getByRole('button', { name: 'Send', exact: true }).click(); await settled(before);
  const last = (await calls()).at(-1); assert.equal(last.args[last.args.indexOf('--tools') + 1], '', 'tool-less'); assert(!last.args.includes('--permission-mode')); assert.deepEqual(last.cwdFiles, [], 'an empty folder');
  await openNote('plan.md'); await page.waitForTimeout(500); assert.equal(listings.filter((l) => l.includes(D4.base)).length, listedNow, 'the diagram that cannot be drawn is not looked up again'); assert.equal(puts.length, putsNow, 'no picture was made twice'); assert(listed >= 1);

  assert.equal(errors.length, 0, 'no page error: ' + errors.join('; '));
  assert.equal(external.length, 0, 'no network request left the machine: ' + external.join(', '));
  assert.equal((await readFile(path.join(notebook, 'plan.md'), 'utf8')), NOTE, 'the note is untouched');
  assert.deepEqual(await readdir(path.join(harness, 'chat-cwd')), [], 'the folder is empty after every turn');
  console.log('diagram-chat: ok');
  await context.close();
} finally { watcher.stop(); await app.close(); await browser.close(); }
