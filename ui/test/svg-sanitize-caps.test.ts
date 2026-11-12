import {describe,expect,it} from 'vitest';
import {sanitizeSvgDocument,SVG_ISSUE_TEXT,SVG_LIMITS} from '../shared/svg-sanitize.ts';

// The size limits are about the DRAWING, not the page around it. A skill page may be several hundred KB of interface; what is bounded is the svg inside it,
// the style that is kept, and the sanitized output (300 KB). Raw input is bounded too, so the parser cannot be fed without limit.
const ok=(doc:string)=>{const r=sanitizeSvgDocument(doc);if(!r.ok)throw new Error('refused: '+r.reason);return r.svg;};
const small='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 20"><rect class="box" x="1" y="1" width="9" height="9"/><text x="2" y="5">Hello</text></svg>';
const around=(svg:string,before='',after='')=>`<!doctype html><html><head>${before}</head><body>${after}${svg}</body></html>`;
const KB=1024;

describe('the page can be large; the drawing cannot',()=>{
 it('accepts a drawing inside a page of more than 300 KB (script, styles, markup)',()=>{
  const junk='<style>'+'.ui-a{color:red;margin:0}\n'.repeat(12000)+'</style><script>'+'var x=1;\n'.repeat(30000)+'</script>';
  const doc=around(small,junk,'<div>'+'<p>text</p>'.repeat(5000)+'</div>');expect(doc.length).toBeGreaterThan(600*KB);
  const out=ok(doc);expect(out).toContain('<text x="2" y="5">Hello</text>');expect(out).not.toMatch(/ui-a|var x/);
 });
 it('accepts a page with far more markup elements than the drawing may have',()=>{
  const out=ok(around(small,'','<ul>'+'<li><span>a</span></li>'.repeat(40000)+'</ul>'));expect(out).toContain('Hello');
 });
 it('refuses a drawing whose own source is over 300 KB, in plain words',()=>{
  const big='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 9 9">'+Array.from({length:22},()=>'<text x="1" y="1">'+'a'.repeat(14*KB)+'</text>').join('')+'</svg>';
  expect(big.length).toBeGreaterThan(300*KB);
  expect(sanitizeSvgDocument(around(big))).toEqual({ok:false,reason:'svg_too_large',text:SVG_ISSUE_TEXT.svg_too_large});
 });
 it('accepts a drawing just under 300 KB of source even if most of it is dropped or trimmed',()=>{
  const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 9 9"><desc>'+'d'.repeat(250*KB)+'</desc><rect width="1" height="1"/></svg>';
  const out=ok(around(svg));expect(out.length).toBeLessThan(10*KB);expect(out).toContain('<rect');
 });
 it('the cap on the sanitized OUTPUT is still 300 KB: a small source that a variable expands past it is refused',()=>{
  const svg=`<style>:root{--p:${'M0 0L1 1'.repeat(1200)}}</style><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 9 9">${'<path d="var(--p)"/>'.repeat(40)}</svg>`;
  expect(svg.length).toBeLessThan(40*KB);expect(sanitizeSvgDocument(svg)).toEqual({ok:false,reason:'svg_too_large',text:SVG_ISSUE_TEXT.svg_too_large});
  expect(ok(`<style>:root{--p:${'M0 0L1 1'.repeat(1200)}}</style><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 9 9">${'<path d="var(--p)"/>'.repeat(5)}</svg>`)).toContain('<path d="M0 0L1 1');
 });
 it('the element, depth and style caps still apply to the drawing',()=>{
  expect(sanitizeSvgDocument(around(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 9 9">${'<rect width="1" height="1"/>'.repeat(SVG_LIMITS.elements+5)}</svg>`))).toMatchObject({ok:false,reason:'svg_too_complex'});
  expect(sanitizeSvgDocument(around(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 9 9">${'<g>'.repeat(SVG_LIMITS.depth+3)}<rect width="1" height="1"/>${'</g>'.repeat(SVG_LIMITS.depth+3)}</svg>`))).toMatchObject({ok:false,reason:'svg_too_complex'});
 });
});

describe('raw input is bounded',()=>{
 it('refuses input over 4 MB without parsing it, and says so in plain words',()=>{
  const huge=around(small,'','<p>'+'x'.repeat(SVG_LIMITS.inputBytes)+'</p>');expect(huge.length).toBeGreaterThan(4*1024*KB);
  const r=sanitizeSvgDocument(huge);expect(r).toEqual({ok:false,reason:'svg_page_too_large',text:SVG_ISSUE_TEXT.svg_page_too_large});
  expect(SVG_ISSUE_TEXT.svg_page_too_large).toMatch(/^[a-z][a-z ,']+$/);
 });
 it('counts bytes, not characters',()=>{
  const wide=around(small,'','<p>'+'é'.repeat(SVG_LIMITS.inputBytes/2+1000)+'</p>'); // about 2.1M characters, but more than 4 MB of bytes
  expect(wide.length).toBeLessThan(SVG_LIMITS.inputBytes);expect(Buffer.byteLength(wide)).toBeGreaterThan(SVG_LIMITS.inputBytes);
  expect(sanitizeSvgDocument(wide)).toMatchObject({ok:false,reason:'svg_page_too_large'});
 });
 it('input just under 4 MB is read',()=>{
  const near=around(small,'','<p>'+'x'.repeat(SVG_LIMITS.inputBytes-2000)+'</p>');expect(Buffer.byteLength(near)).toBeLessThan(SVG_LIMITS.inputBytes);expect(ok(near)).toContain('Hello');
 });
});
