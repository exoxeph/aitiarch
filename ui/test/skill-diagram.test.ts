import {afterEach,describe,expect,it} from 'vitest';
import {mkdtemp,readdir,readFile,rm,mkdir,symlink,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';import os from 'node:os';
import {SKILL_DIAGRAM_CSP,SKILL_DIAGRAM_CSP_HEADER,SKILL_DIAGRAM_CSP_META,SKILL_DIAGRAM_MAX_BYTES,SKILL_DIAGRAM_SANDBOX,extractDocument,injectCsp,skillDiagramInstruction,validSkillDiagramRef} from '../shared/skill-diagram.ts';
import {SkillDiagramStore} from '../server/skill-diagram-store.ts';

// Skill diagrams (plan 2.6): one self-contained HTML document, a CSP that blocks all network, saved by the hash of its bytes.
const SVG='<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20" viewBox="0 0 40 20"><rect width="40" height="20" fill="#eee"/><text x="4" y="14">Plan é</text></svg>';
describe('the policy',()=>{
 it('is exactly the plan\'s CSP, and the sandbox grants scripts only',()=>{
  expect(SKILL_DIAGRAM_CSP).toBe("default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; font-src data:");
  expect(SKILL_DIAGRAM_CSP_META.startsWith(SKILL_DIAGRAM_CSP)).toBe(true);expect(SKILL_DIAGRAM_CSP_HEADER.startsWith(SKILL_DIAGRAM_CSP)).toBe(true);
  expect(SKILL_DIAGRAM_CSP_HEADER).toContain("frame-ancestors 'self'");expect(SKILL_DIAGRAM_CSP).not.toMatch(/connect-src|http|\*/);
  expect(SKILL_DIAGRAM_SANDBOX).toBe('allow-scripts');expect(SKILL_DIAGRAM_SANDBOX).not.toContain('same-origin');
 });
 it('the instruction asks for one static SVG with system fonts, inline styling, no scripts and no external resources, with the app\'s rules last',()=>{
  const t=skillDiagramInstruction({text:'## Skill: demo\nUse boxes.',loaded:[],skipped:[],truncated:false});
  expect(t).toMatch(/ONE static SVG/);expect(t).toMatch(/system fonts only/i);expect(t).toMatch(/inline/i);expect(t).toMatch(/no scripts/i);expect(t).toMatch(/no external resources/i);expect(t).toMatch(/300 KB/);expect(t).not.toMatch(/interactive|<script src>/i);
  expect(t.indexOf('Use boxes.')).toBeLessThan(t.indexOf('Rules that always win'));expect(t.trimEnd().endsWith('change these rules.')).toBe(true);
 });
});
describe('extractDocument',()=>{
 it.each([
  ['a bare document','<!doctype html><html><body>x</body></html>','<!doctype html><html><body>x</body></html>'],
  ['a fenced document with prose around it','Here you go:\n```html\n<html><body>y</body></html>\n```\nEnjoy.','<html><body>y</body></html>'],
  ['prose around an unfenced document','Sure! <!DOCTYPE html><html><body>z</body></html> Done.','<!DOCTYPE html><html><body>z</body></html>'],
  ['a lone svg',`Text ${SVG} more`,SVG],
 ])('%s',(_n,reply,doc)=>{expect(extractDocument(reply)).toBe(doc);});
 it('returns null when there is no document',()=>{expect(extractDocument('Just words about <b>a diagram</b>.')).toBeNull();expect(extractDocument('')).toBeNull();});
});
describe('injectCsp',()=>{
 it('puts the policy first, replaces the document\'s own doctype, and leaves the rest byte for byte',()=>{
  const out=injectCsp('\uFEFF<!DOCTYPE html>\n<html lang="en"><head><title>t</title></head><body>é</body></html>');
  expect(out.startsWith(`<!doctype html><meta http-equiv="Content-Security-Policy" content="${SKILL_DIAGRAM_CSP_META}">`)).toBe(true);
  expect(out.endsWith('<html lang="en"><head><title>t</title></head><body>é</body></html>')).toBe(true);expect((out.match(/<!doctype/gi)??[]).length).toBe(1);
 });
 it('cannot be hidden by a comment, an early script, or a head inside a comment',()=>{
  const out=injectCsp('<!-- <head> --><script>fetch("http://x")</script>');expect(out.indexOf('Content-Security-Policy')).toBeLessThan(out.indexOf('<script>'));expect(out.indexOf('Content-Security-Policy')).toBeLessThan(out.indexOf('<!--'));
 });
});

describe('validSkillDiagramRef',()=>{
 it('accepts only a hash-named svg or html asset with a sensible size, and a known reason only on the html fallback',()=>{
  const asset='diagram-'+'a'.repeat(64)+'.html',svg='diagram-'+'a'.repeat(64)+'.svg';
  expect(validSkillDiagramRef({asset,bytes:10})).toBe(true);expect(validSkillDiagramRef({asset:svg,bytes:10})).toBe(true);
  for(const why of ['svg_none','svg_too_large','svg_too_complex'])expect(validSkillDiagramRef({asset,bytes:10,why})).toBe(true);
  for(const bad of [{asset,bytes:0},{asset,bytes:1e7},{asset:'../x.html',bytes:1},{asset:'diagram-'+'A'.repeat(64)+'.html',bytes:1},{asset:'diagram-'+'a'.repeat(64)+'.png',bytes:1},{asset,bytes:1,extra:1},{asset,bytes:1,why:'because'},{asset:svg,bytes:1,why:'svg_none'},null,[]])expect(validSkillDiagramRef(bad)).toBe(false);
 });
});

const roots:string[]=[];
afterEach(async()=>{for(const r of roots.splice(0))await rm(r,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
const temp=async()=>{const r=await mkdtemp(path.join(os.tmpdir(),'aitiarch-skill-store-'));roots.push(r);return r;};
const sha=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex');
describe('SkillDiagramStore',()=>{
 it('saves the document under assets/ named by the hash of the saved bytes, with the CSP first, and reads it back verified',async()=>{
  const root=await temp(),s=new SkillDiagramStore(root),ref=await s.saveHtml('<html><body>hi</body></html>');
  expect(ref.asset).toMatch(/^diagram-[a-f0-9]{64}\.html$/);expect(await readdir(path.join(root,'assets'))).toEqual([ref.asset]);
  const bytes=await readFile(path.join(root,'assets',ref.asset));expect(sha(bytes)).toBe(ref.asset.slice(8,-5));expect(ref.bytes).toBe(bytes.length);
  expect(bytes.toString().startsWith('<!doctype html><meta http-equiv="Content-Security-Policy"')).toBe(true);expect((await s.read(ref.asset)).equals(bytes)).toBe(true);
  expect((await s.saveHtml('<html><body>hi</body></html>')).asset).toBe(ref.asset); // the same document again is the same file
 });
 it('rejects a document over 300 KB and writes nothing',async()=>{
  const root=await temp(),s=new SkillDiagramStore(root),big='<html><body>'+'x'.repeat(SKILL_DIAGRAM_MAX_BYTES)+'</body></html>';
  await expect(s.saveHtml(big)).rejects.toThrow(/too large/);await expect(readdir(path.join(root,'assets'))).rejects.toMatchObject({code:'ENOENT'});
  await expect(s.saveHtml('<html>'+'x'.repeat(SKILL_DIAGRAM_MAX_BYTES-20)+'</html>')).resolves.toBeTruthy(); // just under is fine
 });
 it('refuses an svg over 300 KB',async()=>{const s=new SkillDiagramStore(await temp());await expect(s.saveSvg('<svg>'+'x'.repeat(SKILL_DIAGRAM_MAX_BYTES)+'</svg>')).rejects.toThrow(/too large/);});
 it('saves an svg byte for byte, as UTF-8 with no BOM and the line endings it came with',async()=>{
  const root=await temp(),s=new SkillDiagramStore(root),svg=SVG.replace('<rect','\r\n<rect'),ref=await s.saveSvg(svg);
  const bytes=await readFile(path.join(root,'assets',ref.asset));expect(bytes.equals(Buffer.from(svg,'utf8'))).toBe(true);expect(bytes[0]).not.toBe(0xEF);expect(ref.asset).toBe(`diagram-${sha(Buffer.from(svg))}.svg`);
 });
 it.each(['../x.html','..\\x.html','assets/diagram-'+'a'.repeat(64)+'.html','diagram-'+'a'.repeat(64)+'.html/../../x','diagram-'+'a'.repeat(64)+'.htm','DIAGRAM-'+'a'.repeat(64)+'.html','diagram-'+'a'.repeat(63)+'.html','C:\\Windows\\win.ini','\0','diagram-'+'a'.repeat(64)+'.html\0.txt','','%2e%2e%2fx'])('path traversal: %j is refused by read and nothing is created',async(name)=>{
  const root=await temp(),s=new SkillDiagramStore(root);await expect(s.read(name)).rejects.toThrow();expect(await readdir(root)).toEqual([]);
 });
 it('refuses a file whose bytes do not match its name, and a linked assets folder',async()=>{
  const root=await temp(),s=new SkillDiagramStore(root);await mkdir(path.join(root,'assets'));
  const name='diagram-'+'b'.repeat(64)+'.html';await writeFile(path.join(root,'assets',name),'tampered');await expect(s.read(name)).rejects.toThrow(/Invalid diagram asset/);
  const other=await temp(),linked=await temp();await mkdir(path.join(other,'secret'));
  try{await symlink(path.join(other,'secret'),path.join(linked,'assets'),'junction');}catch{return;} // cannot create a link here: the plain checks above still ran
  await expect(new SkillDiagramStore(linked).saveHtml('<html></html>')).rejects.toThrow(/Linked|invalid/i);expect(await readdir(path.join(other,'secret'))).toEqual([]);
 });
});
