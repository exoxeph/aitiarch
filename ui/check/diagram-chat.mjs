// Real-browser check for diagram pictures in the chat, against the synthetic Claude Code CLI (no model, no live call):
//  - a diagram saved as an svg only gets its PNG the first time its note is opened (drawn in the page on a light background, checked by the server); one that cannot be drawn has none and is not retried;
//  - every diagram of the open note is a chip ("D1 <title> · about N tokens"), off until the question or the cursor points at it; a switch holds for one message; at most two pictures go;
//  - the review card shows the pictures that go, with their cost, and the line the message starts with says which diagram is attached;
//  - the CLI really gets the picture as one stream-json line, also on a resumed turn, and plain text when no picture goes;
//  - a claim about a picture reads "from the diagram image, not quote-checked"; a one-off chat offers no pictures.
// Run after `vite build`: BATCH2A_OUTPUT=<folder outside the repo> node check/diagram-chat.mjs
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
await writeFile(path.join(notebook, 'plan.md'), NOTE); await writeFile(path.join(notebook, 'plain.md'), '# Plain\n\nNo diagrams here.\n'); await writeFile(scenarioFile, 'visual-claim');
const provider = new FakeChatProvider();
const store = await Store.open(notebook), watcher = new NoteWatcher(store);
const app = createApp({ store, watcher, distDir: path.join(here, '../dist'), provider, harness: { command: process.execPath, prefixArgs: [path.join(here, '..', 'test', 'fixtures', 'harness-cli.mjs'), '@' + scenarioFile, record], dir: harness } });
const browser = await (async () => { for (const channel of ['msedge', 'chrome']) { try { return await chromium.launch({ channel, headless: true }); } catch { /* next */ } } throw new Error('Edge or Chrome is required.'); })();
const external = [], errors = [], puts = [], listings = [];
const calls = async () => (await readFile(record, 'utf8')).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
try {
  const url = `http://127.0.0.1:${await app.listen(0)}/?debug=1`, context = await browser.newContext({ viewport: { width: 1440, height: 900 } }), page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.origin !== new URL(url).origin && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) external.push(r.url());
    if (u.pathname === '/api/diagram-image' && r.method() === 'PUT') puts.push(JSON.parse(r.postData() ?? '{}').name);
    if (u.pathname === '/api/diagram-images') listings.push(decodeURIComponent(u.search));
  });
  page.on('pageerror', (e) => errors.push(e.message));
  const panel = page.locator('#chat-panel'), chip = (n) => panel.locator(`.chat-sends [data-chip="diagram-${n}"]`);
  const text = async (loc) => (await loc.innerText()).replace(/\s+/g, ' ').trim().replace(/\s?([×+])$/, ' $1');
  const pressed = (n) => chip(n).getAttribute('aria-pressed');
  const openNote = async (file) => { for (let attempt = 0; ; attempt++) { await page.keyboard.press('Control+k'); const palette = page.getByRole('dialog', { name: 'Command palette' }); await palette.waitFor(); const search = palette.getByRole('textbox'); await search.fill('Jump to note: ' + file); await search.press('Enter'); try { await page.waitForFunction((f) => window.__aitiarch?.[f] && document.querySelector('.tab.on')?.textContent?.toLowerCase().includes(f.replace('.md', '')), file, { timeout: 6000 }); return; } catch (e) { if (attempt >= 2) throw e; await page.keyboard.press('Escape'); } } };
  const caretOnLine = (file, n) => page.evaluate(([f, k]) => { const v = window.__aitiarch[f].view; v.dispatch({ selection: { anchor: v.state.doc.line(k).from } }); }, [file, n]);
  const composer = () => panel.getByRole('textbox', { name: 'Message Aitiarch AI' });
  const submit = async (question) => { await composer().fill(question); await composer().press('Enter'); const review = panel.getByRole('region', { name: 'What will be sent' }); await review.waitFor(); return review; };
  const sendReview = async (review) => { const before = await panel.locator('.chat-ai:not(.chat-streaming) .chat-add').count(); await review.getByRole('button', { name: 'Send', exact: true }).click(); await page.waitForFunction((n) => document.querySelectorAll('#chat-panel .chat-ai:not(.chat-streaming) .chat-add').length > n, before); };
  const pictureThere = {};
  const info = async (base) => (await page.evaluate((n) => fetch('/api/diagram-images?names=' + n + '.png').then((r) => r.json()), base)).images[0] ?? null;

  // 1. Lazy pictures: the diagrams were saved as svg only, so no picture exists until their note is opened; then the three drawable diagrams get a PNG, the broken one gets none and is not retried.
  assert.deepEqual((await readdir(path.join(notebook, 'assets'))).filter((n) => n.endsWith('.png')), [], 'no picture before the note is opened');
  await page.goto(url); await page.waitForFunction(() => document.querySelector('.cm-editor') && window.__aitiarch);
  // The chat is already open when the note is, so the page and the panel both ask for the pictures at once: each is still made once.
  await page.getByRole('button', { name: /^Chat/ }).click(); await panel.waitFor();
  await openNote('plan.md');
  for (let i = 0; i < 100 && ![D1, D2, D3].every((d) => pictureThere[d.base]); i++) { for (const d of [D1, D2, D3]) pictureThere[d.base] = !!(await info(d.base)); await page.waitForTimeout(200); }
  const meta = [await info(D1.base), await info(D2.base), await info(D3.base)];
  assert.deepEqual(meta.map((m) => [m.width, m.height]), [[1000, 525], [1000, 500], [1000, 520]], 'each drawn at 1,000 px on its longest side, keeping its proportions');
  assert(meta.every((m) => m.bytes <= 500 * 1024), 'at most 500 KB each');
  const look = await page.evaluate(async (n) => { const img = new Image(); img.src = '/api/diagram-image?name=' + n + '.png'; await img.decode(); const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; const g = c.getContext('2d'); g.drawImage(img, 0, 0); const bytes = new Uint8Array(await (await fetch('/api/diagram-image?name=' + n + '.png')).arrayBuffer()); return { corner: [...g.getImageData(3, 3, 1, 1).data], magic: [...bytes.slice(0, 8)] }; }, D1.base);
  assert.deepEqual(look.magic, [137, 80, 78, 71, 13, 10, 26, 10], 'a PNG'); assert.deepEqual(look.corner, [255, 255, 255, 255], 'on an opaque light background');
  await page.waitForTimeout(600);
  assert.equal(await info(D4.base), null, 'the diagram that cannot be drawn has no picture');
  assert(!puts.includes(D4.base + '.png'), 'and nothing was sent for it'); assert.deepEqual([...new Set(puts)].sort(), [D1, D2, D3].map((d) => d.base + '.png').sort(), 'one picture saved for each drawable diagram');
  assert.equal(puts.length, 3, 'each picture saved once');
  const listed = listings.filter((l) => l.includes(D4.base)).length;

  // 2. A conversation: the chips. All off, with their cost, the broken one without a picture.
  await page.waitForFunction(() => { const t = document.querySelector('.chat-composer textarea'); return t && !t.disabled; });
  assert.equal(await panel.locator('.chat-sends [data-chip^="diagram-"]').count(), 0, 'a one-off chat offers no pictures: it is one JSON document');
  await panel.locator('.chat-pick-trigger').click(); await panel.getByRole('button', { name: 'New', exact: true }).click(); await page.waitForFunction(() => /Conversation 1/.test(document.querySelector('#chat-panel .chat-pick-trigger')?.textContent ?? ''));
  await chip(1).waitFor(); assert.equal(await panel.locator('.chat-sends [data-chip^="diagram-"]').count(), 4, 'every diagram of the note is a chip');
  assert.match(await text(chip(1)), /^D1 alpha-skill · about 700 tokens \+$/); assert.match(await text(chip(2)), /^D2 bravo-skill · about 667 tokens \+$/); assert.match(await text(chip(3)), /^D3 charlie-skill · about 694 tokens \+$/);
  assert.equal(await text(chip(4)), 'D4 broken-skill · no picture'); assert.equal(await chip(4).getAttribute('aria-disabled'), 'true');
  for (const n of [1, 2, 3, 4]) assert.equal(await pressed(n), 'false', `D${n} is off until something points at it`);
  await page.screenshot({ path: path.join(output, 'diagram-chat-chips.png') });

  // 3. The question points at them: the first two (nearest the cursor) turn on, the third is over the limit and the person is told. A switch beats the automatic choice.
  await composer().fill('Which box feeds which in the diagram?');
  await page.waitForFunction(() => document.querySelector('#chat-panel [data-chip="diagram-1"]')?.getAttribute('aria-pressed') === 'true');
  assert.deepEqual([await pressed(1), await pressed(2), await pressed(3)], ['true', 'true', 'true']);
  assert.match(await text(chip(1)), /^D1 alpha-skill · about 700 tokens ×$/); assert.equal(await text(chip(3)), 'D3 charlie-skill · not attached (limit 2) ×');
  assert.equal(await text(panel.locator('.chat-send-note')), 'At most 2 pictures go with a message: D3 will not be attached. Switch another off to attach it.');
  await page.screenshot({ path: path.join(output, 'diagram-chat-limit.png') });
  await chip(2).click(); assert.deepEqual([await pressed(1), await pressed(2), await pressed(3)], ['true', 'false', 'true']); assert.equal(await panel.locator('.chat-send-note').count(), 0, 'switching one off makes room');
  assert.match(await text(chip(3)), /^D3 charlie-skill · about 694 tokens ×$/);
  await chip(3).click(); await chip(2).click(); assert.deepEqual([await pressed(1), await pressed(2), await pressed(3)], ['true', 'true', 'false']);
  await chip(4).click({ force: true }); assert.equal(await pressed(4), 'false', 'a diagram with no picture cannot be switched on');

  // 4. Send with D1 and D2: the review shows the pictures and what they cost; the editor line says which are attached; the CLI gets one stream-json line.
  await chip(2).click(); // D2 off again: only D1 goes
  let review = await panel.getByRole('textbox', { name: 'Message Aitiarch AI' }).press('Enter').then(() => panel.getByRole('region', { name: 'What will be sent' }));
  await review.waitFor();
  const thumbs = review.locator('.chat-review-images figure'); assert.equal(await thumbs.count(), 1);
  assert.equal(await text(thumbs.first().locator('figcaption')), 'D1 alpha-skill · about 700 tokens');
  assert(await thumbs.first().locator('img').evaluate((i) => i.complete && i.naturalWidth === 1000), 'a thumbnail of the picture that goes');
  assert.equal(await text(review.locator('.chat-review-manifest')), `Open note: Plan (${NOTE.length} chars). Cursor section: Plan. Diagrams: D1 'alpha-skill' (image attached), D2 'bravo-skill' (not attached), D3 'charlie-skill' (not attached), D4 'broken-skill' (not attached).`);
  await panel.screenshot({ path: path.join(output, 'diagram-chat-review.png') }); await sendReview(review);
  const [first] = await calls(), sent = JSON.parse(first.stdin);
  assert(first.args.includes('--session-id') && first.args.includes('--input-format') && first.args[first.args.indexOf('--input-format') + 1] === 'stream-json', 'a first turn with a picture is stream-json');
  assert.equal(first.args[first.args.indexOf('--tools') + 1], '', 'and still has no tools');
  assert.deepEqual(sent.message.content.map((c) => c.type), ['image', 'text']); assert.equal(sent.message.content[0].source.media_type, 'image/png');
  const png = await page.evaluate((n) => fetch('/api/diagram-image?name=' + n + '.png').then((r) => r.arrayBuffer()).then((b) => { let s = ''; const u = new Uint8Array(b); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); }), D1.base);
  assert.equal(sent.message.content[0].source.data, png, 'the picture that was saved is the picture that was sent'); assert(sent.message.content[1].text.endsWith('Which box feeds which in the diagram?'));
  // the claim about the picture
  const claim = panel.locator('.chat-turn').last().locator('.claim-chip').first(); await claim.waitFor({ state: 'attached' }); // the list of claims is closed: nothing in it needs a look
  assert.deepEqual([(await claim.locator('.claim-label').textContent()).trim(), (await claim.locator('.claim-state').textContent()).replace(/^\s*·\s*/, '').trim()], ['Diagram D1', 'From the diagram image, not quote-checked']);
  assert.equal(await panel.locator('.chat-turn').last().locator('details.chat-claims').evaluate((d) => d.open), false, 'and the list stays closed: a picture-only claim is not a problem');
  assert.match(await panel.locator('.chat-turn').last().locator('.chat-claims > summary').innerText(), /from a diagram image, not quote-checked/);
  assert.equal(await panel.locator('.chat-turn').last().getByText('No valid source').count(), 0, 'never "no valid source"');
  await page.screenshot({ path: path.join(output, 'diagram-chat-claim.png') });
  // after a send the switches are gone: nothing is on with an empty box
  for (const n of [1, 2, 3]) assert.equal(await pressed(n), 'false');

  // 5. A switch holds for one message: the question points at D1, the person switches it off, the turn goes as plain text; the next question points at D1 again and it is back (a resumed turn with a picture).
  await composer().fill('Where does the diagram start?'); await page.waitForFunction(() => document.querySelector('#chat-panel [data-chip="diagram-1"]')?.getAttribute('aria-pressed') === 'true');
  await chip(1).click(); assert.equal(await pressed(1), 'false'); assert.equal(await pressed(2), 'true', 'the rest still follow the question');
  await chip(2).click(); await chip(3).click(); assert.deepEqual([await pressed(1), await pressed(2), await pressed(3)], ['false', 'false', 'false']);
  review = await panel.getByRole('textbox', { name: 'Message Aitiarch AI' }).press('Enter').then(() => panel.getByRole('region', { name: 'What will be sent' })); await review.waitFor();
  assert.equal(await review.locator('.chat-review-images').count(), 0, 'no picture goes'); assert.match(await text(review.locator('.chat-review-manifest')), /Diagrams: D1 'alpha-skill' \(not attached\), D2 'bravo-skill' \(not attached\)/);
  await sendReview(review); const second = (await calls())[1];
  assert(second.args.includes('--resume') && !second.args.includes('--input-format'), 'a resumed turn without a picture is plain text'); assert.throws(() => JSON.parse(second.stdin)); assert(second.stdin.startsWith('Open note: Plan'));
  await composer().fill('And the arrows in the diagram?'); await page.waitForFunction(() => document.querySelector('#chat-panel [data-chip="diagram-1"]')?.getAttribute('aria-pressed') === 'true');
  review = await panel.getByRole('textbox', { name: 'Message Aitiarch AI' }).press('Enter').then(() => panel.getByRole('region', { name: 'What will be sent' })); await review.waitFor(); await sendReview(review);
  const third = (await calls())[2], again = JSON.parse(third.stdin);
  assert(third.args.includes('--resume') && third.args.includes('--input-format'), 'a resumed turn with a picture is stream-json'); assert.deepEqual(again.message.content.map((c) => c.type), ['image', 'image', 'text'], 'D1 and D2 follow the question, nearest first');

  // 6. The cursor on a diagram's line (or a selection that holds it) turns it on without a word about it; moving away turns it off.
  await caretOnLine('plan.md', 9); await page.waitForFunction(() => document.querySelector('#chat-panel [data-chip="diagram-3"]')?.getAttribute('aria-pressed') === 'true');
  assert.deepEqual([await pressed(1), await pressed(2), await pressed(3)], ['false', 'false', 'true'], 'the cursor is on the line of D3');
  await caretOnLine('plan.md', 13); await page.waitForFunction(() => document.querySelector('#chat-panel [data-chip="diagram-3"]')?.getAttribute('aria-pressed') === 'false');
  await page.evaluate(() => { const v = window.__aitiarch['plan.md'].view; v.dispatch({ selection: { anchor: v.state.doc.line(2).from, head: v.state.doc.line(7).to } }); });
  await page.waitForFunction(() => document.querySelector('#chat-panel [data-chip="diagram-2"]')?.getAttribute('aria-pressed') === 'true'); assert.deepEqual([await pressed(1), await pressed(2), await pressed(3)], ['true', 'true', 'false'], 'the selection holds D1 and D2');
  await caretOnLine('plan.md', 13); await composer().fill('What does D3 show?'); await page.waitForFunction(() => document.querySelector('#chat-panel [data-chip="diagram-3"]')?.getAttribute('aria-pressed') === 'true' && document.querySelector('#chat-panel [data-chip="diagram-1"]')?.getAttribute('aria-pressed') === 'false'); assert.equal(await pressed(1), 'false', 'a question that names D3 turns on D3 only'); await composer().fill('');

  // 7. Another note without diagrams has no diagram chips; a one-off chat on this note has none either; the broken diagram was not retried.
  await openNote('plain.md'); await page.waitForTimeout(300); assert.equal(await panel.locator('.chat-sends [data-chip^="diagram-"]').count(), 0);
  await openNote('plan.md'); await page.waitForTimeout(500); assert.equal(listings.filter((l) => l.includes(D4.base)).length, listed, 'the diagram that cannot be drawn is not looked up again'); assert(!puts.includes(D4.base + '.png'));
  assert.equal(puts.length, 3, 'no picture was made twice');
  await panel.locator('.chat-pick-trigger').click(); await panel.locator('.chat-pick-opt', { hasText: 'One-off' }).click(); await page.waitForTimeout(300);
  assert.equal(await panel.locator('.chat-sends [data-chip^="diagram-"]').count(), 0, 'a one-off chat has no picture chips');

  assert.equal(errors.length, 0, 'no page error: ' + errors.join('; '));
  assert.equal(external.length, 0, 'no network request left the machine: ' + external.join(', '));
  assert.equal((await readFile(path.join(notebook, 'plan.md'), 'utf8')), NOTE, 'the note is untouched');
  console.log('diagram-chat: ok');
  await context.close();
} finally { watcher.stop(); await app.close(); await browser.close(); }
