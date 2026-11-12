import {describe,expect,it} from 'vitest';
import {sanitizeSvgDocument,SVG_LIMITS} from '../shared/svg-sanitize.ts';

// <use> and <pattern> are kept only inside the document: a use needs an href of "#id" where that id is an allowed element of the same svg. A use never
// points at another use, never sits inside anything a use points at (so no chains, cycles or self-reference), and the number of uses and the size they
// expand to are capped. Anything else about them is rejected exactly as before.
const ok=(doc:string)=>{const r=sanitizeSvgDocument(doc);if(!r.ok)throw new Error('refused: '+r.reason);return r.svg;};
const svg=(inner:string,attrs='')=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"${attrs}>${inner}</svg>`;
const uses=(s:string)=>(s.match(/<use\b/g)??[]).length;

describe('use that stays inside the document',()=>{
 it('keeps a use of a shape in defs, with its position and style',()=>{
  const out=ok(svg('<defs><rect id="box" width="10" height="5"/></defs><use href="#box" x="3" y="4" style="fill:red;cursor:pointer" class="k"/>'));
  expect(out).toContain('<defs><rect id="box" width="10" height="5"/></defs>');expect(out).toContain('<use href="#box" x="3" y="4" style="fill:red" class="k"/>');
 });
 it('keeps xlink:href and declares the namespace for it',()=>{
  const out=ok(svg('<rect id="r" width="1" height="1"/><use xlink:href="#r" x="5"/>'));expect(out).toContain('<use xlink:href="#r" x="5"/>');expect(out).toContain('xmlns:xlink="http://www.w3.org/1999/xlink"');
 });
 it('keeps a use of a group that holds several shapes, and text',()=>{
  const out=ok(svg('<g id="g1"><rect width="2" height="2"/><circle r="1"/><text>A</text></g><use href="#g1" x="10"/><use href="#g1" x="20"/>'));expect(uses(out)).toBe(2);expect(out).toContain('<text>A</text>');
 });
 it('keeps the first of two hrefs only',()=>{
  const out=ok(svg('<rect id="a" width="1" height="1"/><rect id="b" width="1" height="1"/><use href="#a" xlink:href="#b"/>'));expect(out).toContain('<use href="#a"/>');expect(out).not.toContain('#b"/>');
 });
 it('is stable: the result is already clean',()=>{const once=ok(svg('<defs><g id="t"><rect width="2" height="2"/></g></defs><use href="#t"/>'));expect(ok(once)).toBe(once);});
});

describe('pattern',()=>{
 it('keeps a pattern with its units and content, and a fill that refers to it',()=>{
  const out=ok(svg('<defs><pattern id="dots" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><circle cx="2" cy="2" r="1"/></pattern></defs><rect width="9" height="9" fill="url(#dots)"/>'));
  expect(out).toContain('<pattern id="dots" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><circle cx="2" cy="2" r="1"/></pattern>');expect(out).toContain('fill="url(#dots)"');
 });
 it('keeps a pattern that refers to another pattern in the document, and drops one that refers outside',()=>{
  expect(ok(svg('<pattern id="a" width="2" height="2"/><pattern id="b" href="#a" width="4" height="4"/>'))).toContain('<pattern id="b" href="#a" width="4" height="4"/>');
  const out=ok(svg('<pattern id="c" href="https://evil.test/p.svg#a" width="4" height="4"/><rect width="1" height="1"/>'));expect(out).not.toMatch(/evil|href/);
 });
 it('drops a pattern\'s content that is not allowed',()=>{
  const out=ok(svg('<pattern id="p" width="2" height="2"><script>alert(1)</script><image href="https://evil.test/i.png"/><rect width="1" height="1" onclick="x()"/></pattern>'));
  expect(out).toContain('<pattern id="p" width="2" height="2"><rect width="1" height="1"/></pattern>');expect(out).not.toMatch(/script|image|evil|onclick/);
 });
});

describe('everything that leaves the document is still rejected',()=>{
 it.each([
  ['an https url','https://evil.test/a.svg#x'],['a protocol-relative url','//evil.test/a.svg#x'],['a file url','file:///C:/Windows/win.ini#x'],['javascript','javascript:alert(1)'],
  ['a data: svg','data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%3E%3Crect%20id=%22a%22/%3E%3C/svg%3E#a'],['a base64 data: uri','data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=#a'],
  ['a relative file','other.svg#a'],['a path with a fragment','../other.svg#a'],['an empty href',''],['a bare hash','#'],['an id with a space','#a b'],['an id with a quote','#a"b'],['an id with markup','#a<b'],
  ['an id that is not in the svg','#missing'],['a fragment function','#a(1)'],
 ])('drops a use with %s',(_n,href)=>{
  const out=ok(svg(`<rect id="a" width="1" height="1"/><use href="${href.replace(/"/g,'&quot;')}"/>`));expect(uses(out)).toBe(0);expect(out).not.toMatch(/evil|data:|file:|javascript|other\.svg|missing/);expect(out).toContain('<rect id="a"');
 });
 it('drops a use whose target is outside the chosen svg, even on the same page',()=>{
  const other='<svg viewBox="0 0 5 5"><rect id="elsewhere" width="1" height="1"/></svg>',main=svg('<rect width="1" height="1"/><rect width="1" height="1"/><rect width="1" height="1"/><use href="#elsewhere"/>');
  expect(uses(ok(`<html><body>${other}${main}</body></html>`))).toBe(0);
 });
 it.each([['a script','<script id="t">1</script>'],['an image','<image id="t" href="https://evil.test/i.png"/>'],['a foreignObject','<foreignObject id="t"><div/></foreignObject>'],['an iframe','<iframe id="t"/>']])('drops a use whose target is %s (it does not survive)',(_n,target)=>{
  const out=ok(svg(`${target}<rect width="1" height="1"/><use href="#t"/>`));expect(uses(out)).toBe(0);expect(out).not.toMatch(/script|image|foreignObject|iframe|evil/);
 });
 it('still drops hostile attributes on a use',()=>{
  const out=ok(svg('<rect id="a" width="1" height="1"/><use href="#a" onclick="alert(1)" onload="x()" data-x="1" style="fill:url(https://evil.test/p);stroke:red"/>'));expect(out).toContain('<use href="#a" style="stroke:red"/>');expect(out).not.toMatch(/onclick|onload|data-x|evil/);
 });
});

describe('no chains, cycles or self-reference',()=>{
 it('a use of a use is dropped; the inner use, which targets a shape, stays',()=>{
  const out=ok(svg('<defs><rect id="a" width="1" height="1"/><use id="b" href="#a"/></defs><use href="#b" x="9"/>'));expect(uses(out)).toBe(1);expect(out).toContain('<use id="b" href="#a"/>');expect(out).not.toContain('x="9"');
 });
 it('a use inside the group another use points at is dropped (no use inside a use target)',()=>{
  const out=ok(svg('<rect id="r" width="1" height="1"/><g id="t"><use href="#r" x="7"/><circle r="1"/></g><use href="#t" x="2"/>'));expect(uses(out)).toBe(1);expect(out).toContain('<use href="#t" x="2"/>');expect(out).not.toContain('x="7"');
 });
 it('a use two levels down inside a target is dropped too',()=>{
  const out=ok(svg('<rect id="r" width="1" height="1"/><g id="t"><g><g><use href="#r"/></g></g></g><use href="#t"/>'));expect(uses(out)).toBe(1);
 });
 it('a two-element cycle is dropped completely',()=>{
  const out=ok(svg('<g id="a"><use href="#b"/></g><g id="b"><use href="#a"/></g><rect width="1" height="1"/>'));expect(uses(out)).toBe(0);expect(out).toContain('<g id="a"/>');
 });
 it('a longer cycle is dropped completely',()=>{
  expect(uses(ok(svg('<g id="a"><use href="#b"/></g><g id="b"><use href="#c"/></g><g id="c"><use href="#a"/></g><rect width="1" height="1"/>')))).toBe(0);
 });
 it('a use inside its own target (self-reference) is dropped',()=>{expect(uses(ok(svg('<g id="a"><rect width="1" height="1"/><use href="#a"/></g>')))).toBe(0);});
 it('a use that points at itself is dropped',()=>{expect(uses(ok(svg('<use id="u" href="#u"/><rect width="1" height="1"/>')))).toBe(0);});
 it('a use that points at its own parent or ancestor is dropped',()=>{
  expect(uses(ok(svg('<g id="outer"><g><use href="#outer"/></g></g>')))).toBe(0);
 });
 it('a nested-use "bomb" collapses: levels of g/use that would expand exponentially keep at most the first level',()=>{
  let inner='<rect id="l0" width="1" height="1"/>';for(let i=1;i<=10;i++)inner+=`<g id="l${i}">`+Array.from({length:10},()=>`<use href="#l${i-1}"/>`).join('')+'</g>';
  const out=ok(svg(inner));expect(uses(out)).toBeLessThanOrEqual(10);
 });
});

describe('caps',()=>{
 it('more than the allowed number of uses is refused as too complex',()=>{
  const body='<rect id="a" width="1" height="1"/>'+'<use href="#a"/>'.repeat(SVG_LIMITS.uses+1);
  expect(sanitizeSvgDocument(svg(body))).toMatchObject({ok:false,reason:'svg_too_complex'});expect(uses(ok(svg('<rect id="a" width="1" height="1"/>'+'<use href="#a"/>'.repeat(SVG_LIMITS.uses))))).toBe(SVG_LIMITS.uses);
 });
 it('a small count of uses of a big target is refused when the expanded size is over the cap',()=>{
  const target='<g id="big">'+'<rect width="1" height="1"/>'.repeat(400)+'</g>',many=SVG_LIMITS.expanded/400+5;
  expect(many).toBeLessThan(SVG_LIMITS.uses);expect(sanitizeSvgDocument(svg(target+'<use href="#big"/>'.repeat(many)))).toMatchObject({ok:false,reason:'svg_too_complex'});
  expect(ok(svg(target+'<use href="#big"/>'.repeat(5)))).toContain('<use href="#big"/>'); // 400 + 5*400 is under the cap
 });
 it('only allowed elements count toward the expanded size',()=>{
  const target='<g id="big">'+'<script>1</script>'.repeat(3000)+'<rect width="1" height="1"/></g>';expect(ok(svg(target+'<use href="#big"/>'.repeat(50)))).toContain('<use');
 });
});
