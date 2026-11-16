// Real-browser check for the chat's claim chips: states in words, the quote on a click, "Show in note" (a temporary mark that changes nothing),
// an honest "not found" when the quote has moved, and (Cite in note) the exact bytes of the inserted link in LF, CRLF and BOM notes. Keyboard only.
// Synthetic OS-temp note, fake provider that returns scripted claims, no live call. Run after `vite build`:
//   BATCH2A_OUTPUT=<folder outside the repo> node check/claim-chips.mjs
import './config-isolation.mjs'; // first: an empty temp config folder, never the machine's real one
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
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

const SQLITE = 'We chose SQLite for the local store\nbecause it needs no server.';
const filler = Array.from({ length: 45 }, (_, i) => `Filler paragraph ${i + 1} that only exists to push the quoted passage below the first screen.`).join('\n\n');
const NOTE = `# Decisions\n\nIntro.\n\n${filler}\n\n## Setup choices\n\n${SQLITE}\n\n## Later\n\nParking is a problem.\n`;
const CLAIMS = [{ sourceId: 'N1', quote: 'We chose SQLite for the local store' }, { sourceId: 'N1', quote: 'We chose Postgres' }, { sourceId: 'banana', quote: 'noon' }];

const browser = await (async () => { for (const channel of ['msedge', 'chrome']) { try { return await chromium.launch({ channel, headless: true }); } catch { /* next */ } } throw new Error('Edge or Chrome is required.'); })();
const external = [], report = {};

async function inApp(name, text, run) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aitiarch-claim-chips-'));
  await writeFile(path.join(root, 'decisions.md'), Buffer.from(text));
  const provider = { name: 'claude', async checkAvailability() { return { available: true }; },
    async invoke(request, options = {}) { options.onTextDelta?.('{"answer":"The store is SQLite."}');
      return { id: request.id, provider: 'claude', model: null, answer: 'The store is SQLite. Does that fit?', claims: CLAIMS, usage: { inputTokens: 50, outputTokens: 10 } }; } };
  const store = await Store.open(root), watcher = new NoteWatcher(store), app = createApp({ store, watcher, distDir: path.join(here, '../dist'), provider });
  try {
    const url = `http://127.0.0.1:${await app.listen(0)}/?debug=1`, context = await browser.newContext({ viewport: { width: 1440, height: 900 } }), page = await context.newPage();
    page.setDefaultTimeout(10000);
    page.on('request', (r) => { if (!r.url().startsWith('http://127.0.0.1') && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) external.push(r.url()); });
    await page.goto(url); await page.waitForSelector('.cm-editor');
    const panel = page.locator('#chat-panel');
    await page.getByRole('button', { name: /^Chat/ }).click(); await panel.waitFor();
    await page.waitForFunction(() => { const t = document.querySelector('.chat-composer textarea'); return t && !t.disabled; });
    const composer = panel.getByRole('textbox', { name: 'Message Aitiarch AI' });
    await composer.fill('Which store did we pick?'); await composer.press('Enter');
    await panel.getByRole('region', { name: 'What will be sent' }).getByRole('button', { name: 'Send to Claude', exact: true }).click();
    await panel.locator('.claim-chips').waitFor();
    await run({ page, panel, root, name });
    await context.close();
  } finally { watcher.stop(); await app.close(); await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
}
const disk = (root) => readFile(path.join(root, 'decisions.md'));
const docText = (page) => page.evaluate(() => window.__aitiarch['decisions.md'].view.state.doc.toString());

try {
  await inApp('states-and-show', NOTE, async ({ page, panel, root }) => {
    const chips = panel.locator('button.claim-chip'), texts = (await chips.allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
    assert.equal(texts.length, 3, 'three claims, three chips');
    assert.match(texts[0], /^AI N decisions › Setup choices · Found$/, 'found: note name, heading, the AI mark, the kind and the word');
    assert.match(texts[1], /^AI N decisions · Quote not found$/); assert.match(texts[2], /^AI Unrecognised source · No valid source$/);
    assert.equal(await panel.locator('.chat-claims').evaluate((d) => d.open), true, 'open by itself because some claim needs a look');
    const styles = await chips.evaluateAll((els) => els.map((e) => getComputedStyle(e).borderTopStyle));
    assert.deepEqual(styles, ['solid', 'dashed', 'double'], 'found is solid, quote not found dashed, no valid source double: the words say it, the outline backs it up');
    await panel.locator('.claim-sources').screenshot({ path: path.join(output, 'claim-chips-states.png') });
    report.states = texts;

    // Make one typed edit first, so there is exactly one undo step to compare against.
    await page.evaluate(() => { const { view } = window.__aitiarch['decisions.md']; view.dispatch({ changes: { from: view.state.doc.length, insert: 'Typed.' }, userEvent: 'input.type' }); });
    const before = await docText(page); assert(before.endsWith('Typed.'));
    const sel = await page.evaluate(() => JSON.stringify(window.__aitiarch['decisions.md'].view.state.selection.toJSON()));
    const scrollBefore = await page.evaluate(() => document.querySelector('.pane').scrollTop);

    // By keyboard: focus the found chip, Enter shows its quote, Tab to Show in note, Enter.
    await chips.nth(0).focus(); await page.keyboard.press('Enter');
    const quote = panel.locator('.claim-quote'); await quote.waitFor();
    assert.match(await quote.innerText(), /We chose SQLite for the local store/, 'the claimed quote is shown');
    assert.equal(await chips.nth(0).getAttribute('aria-expanded'), 'true');
    await page.keyboard.press('Tab'); assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Show in note');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.cm-quote-flash');
    // The editor scrolls to the passage in its next measure cycle, so the mark can exist a frame before it is on screen: give the scroll a moment to land
    // (it never gets here by waiting if it was not scrolled to), then check exactly what was checked before.
    await page.waitForFunction(() => { const r = document.querySelector('.cm-quote-flash')?.getBoundingClientRect(); return !!r && r.top >= 0 && r.bottom <= innerHeight; }, undefined, { timeout: 3000 }).catch(() => {});
    const flash = await page.evaluate(() => { const els = [...document.querySelectorAll('.cm-quote-flash')], r = els[0].getBoundingClientRect(); return { text: els.map((e) => e.textContent).join(''), top: r.top, bottom: r.bottom, vh: innerHeight }; });
    assert.match(flash.text.replace(/\s+/g, ' '), /We chose SQLite for the local store/, 'the right passage is marked'); assert(flash.top >= 0 && flash.bottom <= flash.vh, 'and it is on screen');
    assert((await page.evaluate(() => document.querySelector('.pane').scrollTop)) > scrollBefore, 'the editor scrolled to it');
    assert.equal(await docText(page), before, 'the document is exactly as it was'); assert.equal(await page.evaluate(() => JSON.stringify(window.__aitiarch['decisions.md'].view.state.selection.toJSON())), sel, 'and so is the selection');
    assert.match(await panel.locator('.claim-said').innerText(), /Shown in the note/);
    await page.screenshot({ path: path.join(output, 'claim-chips-show-in-note.png') });
    await page.waitForFunction(() => !document.querySelector('.cm-quote-flash'), null, { timeout: 8000 });
    assert.equal(await docText(page), before, 'still unchanged after the mark fades');
    // One undo takes back exactly the typed edit: the mark was never an undo step.
    await page.evaluate(() => window.__aitiarch['decisions.md'].view.focus()); await page.keyboard.press('Control+z');
    assert.equal(await docText(page), before.slice(0, -'Typed.'.length), 'one Ctrl+Z undoes only what was typed');
    await page.waitForTimeout(1200); // the typed edit and its undo may autosave; the mark itself must never reach the file
    const saved = (await disk(root)).toString(); assert(saved === NOTE || saved === NOTE + 'Typed.', 'the file on disk holds only the note and what was typed: nothing was saved for the mark');

    // Escape closes the quote and puts focus back on its chip.
    await quote.waitFor(); await chips.nth(0).focus(); await page.keyboard.press('Escape');
    await quote.waitFor({ state: 'detached' }); assert.equal(await chips.nth(0).evaluate((e) => e === document.activeElement), true, 'focus returns to the chip');

    // A quote that is not in the note: the words say so, nothing is marked, nothing scrolls.
    const scroll2 = await page.evaluate(() => document.querySelector('.pane').scrollTop), sel2 = await page.evaluate(() => JSON.stringify(window.__aitiarch['decisions.md'].view.state.selection.toJSON()));
    await chips.nth(1).focus(); await page.keyboard.press('Enter'); await page.keyboard.press('Tab'); await page.keyboard.press('Enter');
    assert.match(await panel.locator('.claim-said').innerText(), /Quote not found in the current note\./);
    assert.equal(await page.locator('.cm-quote-flash').count(), 0); assert.equal(await page.evaluate(() => document.querySelector('.pane').scrollTop), scroll2, 'and the editor did not move');
    assert.equal(await page.evaluate(() => JSON.stringify(window.__aitiarch['decisions.md'].view.state.selection.toJSON())), sel2);
    await page.keyboard.press('Escape');

    // No valid source: its quote is shown, and there is no Show in note.
    await chips.nth(2).focus(); await page.keyboard.press('Enter'); assert.match(await quote.innerText(), /noon/); assert.equal(await panel.getByRole('button', { name: 'Show in note' }).count(), 0, 'no Show in note without a source'); await page.keyboard.press('Escape');

    // The note changes so the passage is gone: the found chip says so honestly and jumps nowhere.
    await page.evaluate(() => { const { view } = window.__aitiarch['decisions.md']; const d = view.state.doc.toString(), at = d.indexOf('We chose SQLite'); view.dispatch({ changes: { from: at, to: at + 'We chose SQLite for the local store'.length, insert: 'Rewritten.' } }); });
    const scroll3 = await page.evaluate(() => document.querySelector('.pane').scrollTop);
    await chips.nth(0).focus(); await page.keyboard.press('Enter'); await page.keyboard.press('Tab'); await page.keyboard.press('Enter');
    assert.match(await panel.locator('.claim-said').innerText(), /Quote not found in the current note\./, 'a moved quote says so');
    assert.equal(await page.locator('.cm-quote-flash').count(), 0); assert.equal(await page.evaluate(() => document.querySelector('.pane').scrollTop), scroll3);
  });

  // Cite in note: the exact link at the cursor, by keyboard, in LF, CRLF and BOM+CRLF notes; the file's other bytes (line endings, BOM) are untouched; one undo step.
  const LINK = '[@Decisions#Setup choices](decisions.md#setup-choices)';
  for (const [name, text] of [['lf', NOTE], ['crlf', NOTE.replace(/\n/g, '\r\n')], ['bom-crlf', '﻿' + NOTE.replace(/\n/g, '\r\n')]]) {
    await inApp('cite-' + name, text, async ({ page, panel, root }) => {
      const chips = panel.locator('button.claim-chip'), at = text.indexOf('Intro.') + 'Intro.'.length, expected = Buffer.from(text.slice(0, at) + LINK + text.slice(at));
      await page.evaluate(() => { const { view } = window.__aitiarch['decisions.md'], d = view.state.doc.toString(), a = d.indexOf('Intro.') + 6; view.dispatch({ selection: { anchor: a } }); });
      const before = await docText(page);
      assert.equal(await panel.getByRole('button', { name: 'Cite in note' }).count(), 0, 'nothing is cited until you ask: no Cite button without opening a chip, and nothing inserted');
      assert.equal(await docText(page), before);
      // Thread/selection/not-found claims offer no Cite: the not-found chip has none.
      await chips.nth(1).focus(); await page.keyboard.press('Enter'); assert.equal(await panel.getByRole('button', { name: 'Cite in note' }).count(), 0, 'a claim whose quote is not found offers no Cite'); await page.keyboard.press('Escape');
      // The found chip: Enter, Tab (Show in note), Tab (Cite in note), Enter.
      await chips.nth(0).focus(); await page.keyboard.press('Enter'); await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Cite in note'); await page.keyboard.press('Enter');
      assert.match(await panel.locator('.claim-said').innerText(), /Cited in the note, at the cursor\./);
      const after = await docText(page); assert.equal(after, before.slice(0, before.indexOf('Intro.') + 6) + LINK + before.slice(before.indexOf('Intro.') + 6), 'the exact link is at the cursor');
      await page.waitForSelector('.cm-cite', { timeout: 5000 }); // the editor reads it as an @ citation, like one made with the picker
      // The saved file is the original bytes plus the link, nothing else (line endings and BOM kept).
      const waitDisk = async (want) => { for (let i = 0; i < 60; i++) { const d = await disk(root); if (d.equals(want)) return true; await page.waitForTimeout(150); } return false; };
      assert(await waitDisk(expected), `${name}: the file is the original bytes with only the link added`);
      // One undo step takes it back exactly.
      await page.evaluate(() => window.__aitiarch['decisions.md'].view.focus()); await page.keyboard.press('Control+z');
      assert.equal(await docText(page), before, `${name}: one Ctrl+Z removes the whole link`);
      assert(await waitDisk(Buffer.from(text)), `${name}: and the file is the original bytes again`);
      report['cite-' + name] = 'exact bytes, one undo';
    });
  }
  assert.deepEqual(external, [], 'no request left the machine');
  console.log(JSON.stringify({ passed: true, ...report }, null, 1));
} finally { await browser.close(); }
