import {describe,expect,it} from 'vitest';
import {sanitizeSvgDocument,SVG_ISSUE_TEXT} from '../shared/svg-sanitize.ts';

// A skill page carries the CSS of its whole interface; the drawing needs only the rules that can match its own elements. The page's CSS is pruned to
// those rules BEFORE any size check, and pruning can only ever keep fewer rules. (The drawing's own <style> is its own and is kept whole.)
const ok=(doc:string)=>{const r=sanitizeSvgDocument(doc);if(!r.ok)throw new Error('refused: '+r.reason);return r.svg;};
const drawing='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 20"><g class="grp"><rect class="box hot" x="1" y="1" width="9" height="9"/><text class="label" x="2" y="5">A</text></g><path id="edge1" class="edge" d="M0 0L9 9"/></svg>';
const page=(css:string,svg=drawing)=>`<!doctype html><html><head><style>${css}</style></head><body>${svg}</body></html>`;
const RULES='.box{fill:#111111}\n.label{fill:#222222}\n.edge{stroke:#333333}';
const junk=(n:number)=>Array.from({length:n},(_,i)=>`.ui-widget-${i}{fill:#aaaaaa;stroke:#bbbbbb;stroke-width:${i%9}}`).join('\n');

describe('the page\'s CSS is pruned to what can match the drawing',()=>{
 it('a page with far more unrelated CSS than the old guard allowed is accepted, and only the matching rules are kept',()=>{
  const css=RULES+'\n'+junk(6000);expect(css.length).toBeGreaterThan(300000);
  const out=ok(page(css));expect(out).toContain('.box{fill:#111111}');expect(out).toContain('.label{fill:#222222}');expect(out).toContain('.edge{stroke:#333333}');expect(out).not.toContain('ui-widget');
 });
 it('adding rules that cannot match changes nothing at all (pruning only ever keeps fewer)',()=>{
  const base=ok(page(RULES)),more=ok(page(RULES+'\n'+junk(200)+'\n@media (min-width:600px){.box{fill:#999999}}\n.nothing .box{fill:#888888}\nfoo{fill:#777777}\n.box.cold{fill:#666666}'));
  expect(more).toBe(base);
 });
 it('rules whose class, id or tag is absent from the drawing are dropped, and present ones kept',()=>{
  const out=ok(page('.box{fill:#111111}\n.absent{fill:#222222}\n#edge1{stroke:#333333}\n#other{stroke:#444444}\ntext{fill:#555555}\ntspan{fill:#666666}\npath{stroke-width:3}\ncircle{fill:#777777}'));
  expect(out).toContain('.box{');expect(out).toContain('#edge1{');expect(out).toContain('text{fill:#555555}');expect(out).toContain('path{stroke-width:3}');
  expect(out).not.toMatch(/absent|#other|tspan|circle/);
 });
 it('a rule with ancestors keeps only if every step can exist inside the drawing',()=>{
  const out=ok(page('.grp .box{fill:#111111}\ng > .label{fill:#222222}\nsvg .edge{stroke:#333333}\n.panel .box{fill:#444444}\nbody .label{fill:#555555}\n.grp .gone{fill:#666666}'));
  expect(out).toContain('.grp .box{fill:#111111}');expect(out).toContain('g &gt; .label{fill:#222222}'); // the child combinator is escaped in XML text; a browser reads it back as ">"expect(out).toContain('svg .edge{stroke:#333333}');
  expect(out).not.toMatch(/panel|body|gone/);
 });
 it('a compound with two classes needs ONE element that has both',()=>{
  const out=ok(page('.box.hot{fill:#111111}\n.box.label{fill:#222222}\n.hot.edge{stroke:#333333}'));expect(out).toContain('.box.hot{fill:#111111}');expect(out).not.toMatch(/\.box\.label|\.hot\.edge/);
 });
 it('lists keep only their matching selectors',()=>{
  const out=ok(page('.box, .absent, .label{fill:#111111}'));expect(out).toContain('.box,.label{fill:#111111}');expect(out).not.toContain('absent');
 });
 it('a hover rule for an element that exists is kept (an image has no hover, but it is harmless and the drawing may rely on it elsewhere)',()=>{
  expect(ok(page('.box:hover{fill:#111111}'))).toContain('.box:hover{fill:#111111}');
 });
 it('the drawing\'s own <style> is kept whole, rules that match nothing included',()=>{
  const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 9 9"><style>.own{fill:#111111}\n.unused{fill:#222222}</style><rect class="own" width="9" height="9"/></svg>';
  const out=ok(page('.unused{fill:#999999}',svg));expect(out).toContain('.own{fill:#111111}');expect(out).toContain('.unused{fill:#222222}');expect(out).not.toContain('999999');
 });
 it('the first definition order is kept: page rules come before the drawing\'s own, as in the page',()=>{
  const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 9 9"><style>.own{fill:#222222}</style><rect class="own" width="9" height="9"/></svg>';
  const out=ok(page('.own{fill:#111111}',svg));expect(out.indexOf('#111111')).toBeLessThan(out.indexOf('#222222'));
 });
});

describe('the style-size cap still applies, to what is kept',()=>{
 it('matching rules that together exceed the cap are refused in plain words',()=>{
  const n=1000,els=Array.from({length:n},(_,i)=>`<rect class="c${i}" width="1" height="1"/>`).join('');
  const css=Array.from({length:n},(_,i)=>`.c${i}{fill:#123456;stroke:#654321;stroke-width:2}`).join('\n');
  const r=sanitizeSvgDocument(page(css,`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 9 9">${els}</svg>`));
  expect(r).toEqual({ok:false,reason:'svg_too_complex',text:SVG_ISSUE_TEXT.svg_too_complex});
 });
 it('a drawing\'s own oversized style block is still refused',()=>{
  const r=sanitizeSvgDocument(page('',`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 9 9"><style>${'.a{fill:red}\n'.repeat(4000)}</style><rect width="1" height="1"/></svg>`));
  expect(r).toMatchObject({ok:false,reason:'svg_too_complex'});
 });
});
