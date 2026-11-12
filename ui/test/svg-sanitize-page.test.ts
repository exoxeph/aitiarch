import {describe,expect,it} from 'vitest';
import {sanitizeSvgDocument} from '../shared/svg-sanitize.ts';

// Real skill pages keep their palette in custom properties declared on page-level selectors. These tests use tiny ORIGINAL pages that only mimic that
// structure. A rule is read for its declarations when ANY selector of its list is a page-level selector that matches the page; the selector is never emitted.
const ok=(doc:string)=>{const r=sanitizeSvgDocument(doc);if(!r.ok)throw new Error('refused: '+r.reason);return r.svg;};
const shape='<rect class="db" x="1" y="1" width="9" height="9"/>';
const page=(css:string,htmlAttrs='',svgAttrs='')=>`<!doctype html><html lang="en"${htmlAttrs}><head><style>${css}</style></head><body><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"${svgAttrs}>${shape}</svg></body></html>`;
const USE='.db{fill:var(--db-fill);stroke:var(--db-stroke)}';

describe('custom properties on a mixed selector list',()=>{
 it('resolves a variable declared on ":root, [data-theme=dark]" instead of dropping the fill (the shapes were black)',()=>{
  const out=ok(page(`:root, [data-theme="dark"] { --db-fill: #123456; --db-stroke: #abcdef }\n${USE}`,' data-theme="dark"'));
  expect(out).toContain('.db{fill:#123456;stroke:#abcdef}');expect(out).not.toMatch(/var\(|--db/);
 });
 it('also works when the page has no theme attribute at all (":root" matches)',()=>{
  expect(ok(page(`:root, [data-theme="dark"] { --db-fill: #123456; --db-stroke: #abcdef }\n${USE}`))).toContain('.db{fill:#123456;stroke:#abcdef}');
 });
 it('works for a bare svg that carries no html page at all',()=>{
  expect(ok(`<style>:root,[data-theme="dark"]{--db-fill:#123456;--db-stroke:#abcdef}${USE}</style><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">${shape}</svg>`)).toContain('.db{fill:#123456;stroke:#abcdef}');
 });
 it('never emits the page-level selector or the theme attribute',()=>{
  const out=ok(page(`:root, [data-theme="dark"], html[data-preset="classic"] { --db-fill: #123456; --db-stroke: #abcdef }\n${USE}`,' data-theme="dark" data-preset="classic"'));
  expect(out).not.toMatch(/:root|data-theme|data-preset|html/);
 });
 it('reads a rule when only SOME selectors of its list are page-level, but never a rule that has none',()=>{
  expect(ok(page(`:root, .card { --db-fill: #111111; --db-stroke: #222222 }\n${USE}`))).toContain('.db{fill:#111111;stroke:#222222}');
  const none=ok(page(`.card { --db-fill: #999999; --db-stroke: #888888 }\n${USE}`));expect(none).not.toMatch(/999999|888888/);expect(none).not.toContain('.db{');
 });
});

describe('the theme the page is actually in wins, as in a browser',()=>{
 const css=`:root, [data-theme="dark"] { --db-fill: #101010; --db-stroke: #202020 }\n[data-theme="light"] { --db-fill: #f0f0f0; --db-stroke: #e0e0e0 }\n${USE}`;
 it('dark page: the dark values, although the light rule comes later',()=>{expect(ok(page(css,' data-theme="dark"'))).toContain('.db{fill:#101010;stroke:#202020}');});
 it('light page: the later light rule overrides, as the cascade would',()=>{expect(ok(page(css,' data-theme="light"'))).toContain('.db{fill:#f0f0f0;stroke:#e0e0e0}');});
 it('a page with no theme attribute keeps the base (":root") values',()=>{expect(ok(page(css))).toContain('.db{fill:#101010;stroke:#202020}');});
 it('a standalone exported svg that carries the theme on its own root is read the same way',()=>{
  const bare=`<style>${css}</style><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" data-theme="light">${shape}</svg>`;expect(ok(bare)).toContain('.db{fill:#f0f0f0;stroke:#e0e0e0}');
 });
 it('a more specific rule beats a later, less specific one',()=>{
  const c=`html[data-theme="dark"] { --db-fill: #aa0000; --db-stroke: #bb0000 }\n:root { --db-fill: #00aa00; --db-stroke: #00bb00 }\n${USE}`;
  expect(ok(page(c,' data-theme="dark"'))).toContain('.db{fill:#aa0000;stroke:#bb0000}');
 });
 it('a preset the page is not using does not leak in',()=>{
  const c=`:root, [data-theme="dark"] { --db-fill: #101010; --db-stroke: #202020 }\n[data-preset="signal-flow"][data-theme="dark"] { --db-fill: #ff0000; --db-stroke: #ee0000 }\n${USE}`;
  const classic=ok(page(c,' data-theme="dark" data-preset="classic"'));expect(classic).toContain('.db{fill:#101010;stroke:#202020}');expect(classic).not.toMatch(/ff0000|ee0000/);
  expect(ok(page(c,' data-theme="dark" data-preset="signal-flow"'))).toContain('.db{fill:#ff0000;stroke:#ee0000}');
 });
 it('attribute operators are honoured (prefix, suffix, contains, list)',()=>{
  const c=`[data-x^="ab"] { --db-fill: #010101 }\n[data-x$="yz"] { --db-stroke: #020202 }\n[data-x*="mid"] { --db-fill: #030303 }\n[data-y~="two"] { --db-stroke: #040404 }\n${USE}`;
  expect(ok(page(c,' data-x="abmidyz" data-y="one two three"'))).toContain('.db{fill:#030303;stroke:#040404}');
  expect(ok(page(c,' data-x="zzz" data-y="one three"'))).not.toContain('.db{');
 });
});

describe('page properties from a mixed list',()=>{
 it('takes colour, font and background from "html, body, [data-theme=dark]" the same way',()=>{
  const out=ok(page(`html, body, [data-theme="dark"] { background: #0a0a0a; color: #eeeeee; font-family: 'Segoe UI', sans-serif }\n${USE}`,' data-theme="dark"'));
  expect(out).toContain('<rect width="100%" height="100%" fill="#0a0a0a"/>');expect(out).toContain("svg{color:#eeeeee;font-family:'Segoe UI', sans-serif}");
 });
});
