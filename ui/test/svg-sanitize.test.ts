import {describe,expect,it} from 'vitest';
import {sanitizeSvgDocument,SVG_ISSUE_TEXT,SVG_LIMITS} from '../shared/svg-sanitize.ts';
import {BARE,PAGE} from './fixtures/skill-page.ts';

// A skill returns a page or a bare SVG. Only a rebuilt, allowlisted copy of its single top-level <svg> is ever kept: the result is parsed with our
// own tokenizer and written out again from known-safe elements and attributes, so nothing the original carried can survive by being missed.
const ok=(doc:string)=>{const r=sanitizeSvgDocument(doc);if(!r.ok)throw new Error('refused: '+r.reason);return r.svg;};
const svg=(inner:string,attrs='')=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"${attrs}>${inner}</svg>`;
const RECT='<rect x="1" y="1" width="9" height="9"/>';

describe('extraction',()=>{
 it('keeps a bare svg that is already clean, rebuilt in a stable form',()=>{
  const out=ok(BARE);expect(out.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);expect(out).toContain('<rect x="1" y="1" width="38" height="18" fill="#eee" stroke="#333"/>');expect(out).toContain('<text x="6" y="14" font-size="10">Plan é</text>');
 });
 it('finds the svg inside a full html page and leaves the page out',()=>{
  const out=ok(PAGE);expect(out).toContain('viewBox="0 0 400 200"');expect(out).toContain('>Build</text>');expect(out).not.toMatch(/Footnote|<h1|wrap|<html|<body|<meta/);
 });
 it('with several svgs on the page, takes the one with the most parts',()=>{
  const icon='<svg viewBox="0 0 8 8"><circle cx="4" cy="4" r="3"/></svg>',big=svg(RECT+RECT+'<text x="1" y="1">Main</text>');
  const out=ok(`<html><body>${icon}<p>x</p>${big}${icon}</body></html>`);expect(out).toContain('Main');expect(out).not.toContain('<circle');
 });
 it('an svg nested inside the main svg stays as part of it',()=>{expect(ok(svg('<svg x="2" y="2" width="5" height="5"><rect width="5" height="5"/></svg>'))).toContain('<svg x="2" y="2" width="5" height="5"><rect width="5" height="5"/></svg>');});
 it.each([['no svg at all','<html><body><p>Words only</p></body></html>'],['an empty reply',''],['an unclosed tag soup','<svg <<<<']])('refuses %s, in plain words',(_n,doc)=>{
  const r=sanitizeSvgDocument(doc);expect(r).toEqual({ok:false,reason:'svg_none',text:SVG_ISSUE_TEXT.svg_none});expect(SVG_ISSUE_TEXT.svg_none).toMatch(/^[a-z ]+$/);
 });
 it('tolerates the usual page mess: unclosed tags, unquoted attributes, odd case, comments, CDATA and doctype',()=>{
  const out=ok(`<!DOCTYPE html><!-- c --><HTML><BODY><P>unclosed<SVG xmlns="http://www.w3.org/2000/svg" VIEWBOX="0 0 9 9" Width=9><!-- inner --><RECT X=1 y='1' width="2" HEIGHT=2 /><TEXT x="1" y="5"><![CDATA[a < b]]></TEXT></SVG></BODY>`);
  expect(out).toContain('width="9"');expect(out).toContain('<rect x="1" y="1" width="2" height="2"/>');expect(out).toContain('>a &lt; b</text>');expect(out).not.toMatch(/<!--|CDATA|DOCTYPE/i);
 });
});

describe('the look carries over',()=>{
 const out=ok(PAGE);
 it('resolves CSS custom properties into the svg\'s own style block',()=>{
  expect(out).toContain('.box{fill:#f4efe6;stroke:#1c1b19;stroke-width:1.5}');expect(out).toContain('.box.hot{stroke:#c4552d}');expect(out).toContain('.label{font-size:14px;font-weight:600;fill:#1c1b19}');
  expect(out).toContain('.arrow{stroke:rgba(28,27,25,.25);fill:none;marker-end:url(#head)}');expect(out).not.toMatch(/var\(|--paper|--ink|--local/);
 });
 it('resolves variables used in attributes and in style attributes',()=>{expect(out).toContain('<path d="M0 0L10 5L0 10z" fill="#1c1b19"/>');expect(out).toContain('style="stroke:#c4552d"');});
 it('keeps the page\'s font and colour for the drawing, and its background as a rectangle',()=>{
  expect(out).toContain("svg{color:#1c1b19;font-family:'Segoe UI',system-ui,sans-serif}");expect(out).toContain('<rect width="100%" height="100%" fill="#f4efe6"/>');
 });
 it('drops what cannot belong to an image: @font-face, @media, page layout rules',()=>{expect(out).not.toMatch(/@font-face|@media|evil\.test|Evil|max-width|\.wrap/);});
 it('keeps the structure, the markers and the accessible names',()=>{expect(out).toContain('<title>Release flow</title>');expect(out).toContain('role="img"');expect(out).toContain('aria-label="Release flow"');expect(out).toContain('<marker id="head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">');});
 it('variables: a fallback is used, a missing one drops only that declaration, a cycle does not hang, nesting resolves',()=>{
  const page=`<style>:root{--a:var(--b);--b:var(--a);--c:var(--d);--d:#123456}</style>${svg('<rect id="r1" style="fill:var(--missing,#abcdef);stroke:var(--nothing);opacity:var(--a)"/><rect id="r2" fill="var(--c)"/>')}`;
  const o=ok(page);expect(o).toContain('<rect id="r1" style="fill:#abcdef"/>');expect(o).toContain('<rect id="r2" fill="#123456"/>');
 });
});

describe('every kind of thing that must not survive',()=>{
 it.each([
  ['a script element and its code',svg(RECT+'<script>alert(1)</script>'),/script|alert/i],
  ['a script in odd case with attributes',svg(RECT+'<ScRiPt type="text/javascript">alert(1)</ScRiPt>'),/script|alert/i],
  ['a script that closes itself in the page',svg(RECT+'<script src="https://evil.test/a.js"/>'),/script|evil/i],
  ['an onload handler on the root',svg(RECT,' onload="alert(1)"'),/onload|alert/i],
  ['an onclick handler',svg('<rect onclick="alert(1)" x="1" y="1" width="2" height="2"/>'),/onclick|alert/i],
  ['an onmouseover handler in odd case',svg('<g ONMOUSEOVER="alert(1)"><rect x="1" y="1" width="2" height="2"/></g>'),/mouseover|alert/i],
  ['a foreignObject with html, a form and a script',svg(RECT+'<foreignObject width="9" height="9"><div xmlns="http://www.w3.org/1999/xhtml"><form action="https://evil.test"><input name="a"></form><script>1</script></div></foreignObject>'),/foreignObject|<div|<form|<input|evil/i],
  ['an image with an external href',svg(RECT+'<image href="https://evil.test/a.png" width="9" height="9"/>'),/<image|evil/i],
  ['an image with a data: uri',svg(RECT+'<image xlink:href="data:image/png;base64,AAAA" width="9" height="9"/>'),/<image|data:/i],
  ['a use pointing outside the document',svg(RECT+'<use href="https://evil.test/a.svg#x"/>'),/<use|evil/i],
  ['a use pointing inside the document (use is not on the list)',svg('<defs><rect id="a" width="2" height="2"/></defs><use href="#a"/>'),/<use/i],
  ['a link with a javascript: href (the link goes, its drawing stays)',svg('<a href="javascript:alert(1)"><rect x="1" y="1" width="2" height="2"/></a>'),/<a[ >]|javascript|alert|href/i],
  ['an iframe',svg(RECT+'<iframe src="https://evil.test"></iframe>'),/iframe|evil/i],
  ['an object',svg(RECT+'<object data="https://evil.test/a.swf"></object>'),/object|evil/i],
  ['an embed',svg(RECT+'<embed src="https://evil.test/a.swf"/>'),/embed|evil/i],
  ['an animate that rewrites an href',svg('<a><animate attributeName="href" values="javascript:alert(1)"/><rect x="1" y="1" width="2" height="2"/></a>'),/animate|javascript/i],
  ['a set element',svg(RECT+'<set attributeName="onload" to="alert(1)"/>'),/<set|alert/i],
  ['an animateTransform and animateMotion',svg('<rect x="1" y="1" width="2" height="2"><animateTransform attributeName="transform" type="rotate" to="9"/><animateMotion path="M0 0L9 9"/></rect>'),/animate/i],
  ['audio and video',svg(RECT+'<audio src="https://evil.test/a.mp3"/><video src="https://evil.test/a.mp4"/>'),/audio|video|evil/i],
  ['an unknown element and a math element',svg(RECT+'<custom-thing x="1"><rect x="2" y="2" width="1" height="1"/></custom-thing><math><mi>x</mi></math>'),/custom|math|<mi/i],
  ['an external href on a gradient',svg('<defs><linearGradient id="g" href="https://evil.test/g.svg#x"><stop offset="0"/></linearGradient></defs>'),/evil|href/i],
  ['a javascript: href on a gradient',svg('<defs><linearGradient id="g" xlink:href="javascript:alert(1)"/></defs>'),/javascript|href/i],
  ['an @import in a style element',svg(RECT+'<style>@import url(https://evil.test/a.css); .a{fill:red}</style>'),/@import|evil/i],
  ['a url() to another site in a style element',svg(RECT+'<style>.a{fill:url(https://evil.test/p)} .b{fill:red}</style>'),/evil|https/i],
  ['a url() to another site in a style attribute',svg('<rect style="fill:url(//evil.test/p);stroke:red" x="1" y="1" width="2" height="2"/>'),/evil|url\(/i],
  ['a url() to another site in an attribute',svg('<rect fill="url(https://evil.test/p#a)" x="1" y="1" width="2" height="2"/>'),/evil|https/i],
  ['an expression() value',svg('<rect style="width:expression(alert(1));fill:red" x="1" y="1" width="2" height="2"/>'),/expression|alert/i],
  ['a javascript: value in an attribute',svg('<rect fill="javascript:alert(1)" x="1" y="1" width="2" height="2"/>'),/javascript|alert/i],
  ['a javascript: value hidden by entities',svg('<rect fill="&#106;avascript&#58;alert(1)" x="1" y="1" width="2" height="2"/>'),/javascript|alert/i],
  ['a url hidden by a css escape',svg(RECT+'<style>.a{fill:u\\72l(https://evil.test/p)} .b{fill:red}</style>'),/evil|\\72l/i],
  ['a data: uri in a style',svg(RECT+'<style>.a{fill:url(data:image/svg+xml;base64,AAAA)} .b{fill:red}</style>'),/data:/i],
  ['a binding / behavior property',svg(RECT+'<style>.a{-moz-binding:url(https://evil.test/x.xml#b);behavior:url(x.htc)} .b{fill:red}</style>'),/binding|behavior|evil/i],
  ['data-, srcset and other unknown attributes',svg('<rect data-x="1" srcset="a.png" is="x-y" ping="https://evil.test" x="1" y="1" width="2" height="2"/>'),/data-x|srcset|is=|ping|evil/i],
  ['a processing instruction and a doctype with an entity',`<?xml-stylesheet href="https://evil.test/a.css"?><!DOCTYPE svg [<!ENTITY x "y">]>${svg(RECT)}`,/xml-stylesheet|DOCTYPE|ENTITY|evil/i],
 ])('removes %s',(_n,doc,banned)=>{const out=ok(doc);expect(out).not.toMatch(banned);expect(out).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);expect(out).toMatch(/<(rect|g|defs|svg)\b/);});

 it('keeps an in-document reference on a gradient, and in-document url() references',()=>{
  const out=ok(svg('<defs><linearGradient id="a"><stop offset="0" stop-color="#fff"/></linearGradient><linearGradient id="b" xlink:href="#a"/></defs><rect fill="url(#b)" clip-path="url(#c)" x="1" y="1" width="2" height="2"/>'));
  expect(out).toContain('<linearGradient id="b" xlink:href="#a"/>');expect(out).toContain('fill="url(#b)"');expect(out).toContain('clip-path="url(#c)"');
 });
 it('a link is unwrapped, not dropped with its drawing',()=>{expect(ok(svg('<a href="https://evil.test"><rect id="in-link" x="1" y="1" width="2" height="2"/></a>'))).toContain('<rect id="in-link"');});
 it('writes the root namespace itself and ignores the one the page gave it',()=>{
  const out=ok('<svg xmlns="http://evil.test/ns" xmlns:x="http://evil.test/x" viewBox="0 0 1 1"><rect width="1" height="1"/></svg>');expect(out.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1">')).toBe(true);expect(out).not.toContain('evil');
 });
 it('text is escaped on the way out, so text cannot become markup',()=>{
  const out=ok(svg('<text x="1" y="1">a &lt;/text&gt;&lt;script&gt;alert(1)&lt;/script&gt; &amp; b</text>'));expect(out).toContain('a &lt;/text&gt;&lt;script&gt;alert(1)&lt;/script&gt; &amp; b');expect(out).not.toMatch(/<script/);
 });
 it('a style attribute keeps only drawing properties',()=>{
  expect(ok(svg('<rect style="fill:red;position:fixed;background:url(https://evil.test);stroke:#000;z-index:9" x="1" y="1" width="2" height="2"/>'))).toContain('<rect style="fill:red;stroke:#000" x="1"');
 });
 it('the hostile page of everything at once yields a sanitized svg with none of it, and keeps the drawing',()=>{
  const out=ok(`<html><head><style>@import url(https://evil.test/a.css);body{background:url(https://evil.test/b.png)}</style></head><body onload="alert(1)"><svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)" viewBox="0 0 50 30"><script>alert(1)</script><foreignObject><iframe src="https://evil.test"></iframe></foreignObject><image href="https://evil.test/i.png"/><use href="https://evil.test/u.svg#a"/><a href="javascript:alert(1)"><rect id="keep" x="1" y="1" width="9" height="9" fill="red" onclick="alert(1)" style="fill:url(https://evil.test/p)"/></a><animate attributeName="x" to="9"/><text x="2" y="20">Diagram</text></svg></body></html>`);
  expect(out).not.toMatch(/script|alert|onload|onclick|foreignObject|<image|<use|<a[ >]|iframe|animate|href|javascript|@import|evil|expression|data:/i);
  expect(out).toContain('<rect id="keep" x="1" y="1" width="9" height="9" fill="red"/>');expect(out).toContain('>Diagram</text>');
 });
});

describe('stable, bounded, in plain words',()=>{
 it('gives the same bytes every time, and the result is already clean (sanitizing it again changes nothing)',()=>{
  expect(ok(PAGE)).toBe(ok(PAGE));const once=ok(PAGE);expect(ok(once)).toBe(once);const bare=ok(BARE);expect(ok(bare)).toBe(bare);
 });
 it('refuses a drawing nested too deeply',()=>{
  const deep=svg('<g>'.repeat(SVG_LIMITS.depth+2)+RECT+'</g>'.repeat(SVG_LIMITS.depth+2));
  expect(sanitizeSvgDocument(deep)).toEqual({ok:false,reason:'svg_too_complex',text:SVG_ISSUE_TEXT.svg_too_complex});expect(ok(svg('<g>'.repeat(SVG_LIMITS.depth-4)+RECT+'</g>'.repeat(SVG_LIMITS.depth-4)))).toContain('<rect');
 });
 it('refuses a drawing with too many parts',()=>{
  expect(sanitizeSvgDocument(svg(RECT.repeat(SVG_LIMITS.elements+10))).ok).toBe(false);expect(ok(svg(RECT.repeat(SVG_LIMITS.elements-50)))).toContain('<rect');
  expect(sanitizeSvgDocument(`<div>${'<p>'.repeat(SVG_LIMITS.parsedElements+10)}</div>${svg(RECT)}`)).toMatchObject({ok:false,reason:'svg_too_complex'});
 });
 it('refuses a style block that is too big',()=>{expect(sanitizeSvgDocument(svg(RECT+'<style>'+'.a{fill:red}\n'.repeat(4000)+'</style>'))).toMatchObject({ok:false,reason:'svg_too_complex'});});
 it('refuses a result over 300 KB',()=>{
  const path=`<path d="${'M0 0L1 1'.repeat(6000)}"/>`;expect(path.length).toBeGreaterThan(40000);
  const r=sanitizeSvgDocument(svg(path.repeat(8)));expect(r).toEqual({ok:false,reason:'svg_too_large',text:SVG_ISSUE_TEXT.svg_too_large});
 });
 it('every reason is a short plain sentence fragment, with no markup and none of the skill\'s own words',()=>{
  for(const t of Object.values(SVG_ISSUE_TEXT)){expect(t).toMatch(/^[a-z][a-z ,']+$/);expect(t.length).toBeLessThan(80);}
 });
});
