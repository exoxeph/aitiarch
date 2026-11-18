import {afterEach,describe,expect,it} from 'vitest';
import {mkdtemp,readdir,readFile,realpath,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';
import {createApp} from '../server/http.ts';import {Store} from '../server/store.ts';import {NoteWatcher} from '../server/watch.ts';
import {VISUALIZE_QUESTION} from '../shared/diagram.ts';
import {SKILL_DIAGRAM_CSP,SKILL_DIAGRAM_CSP_HEADER,SKILL_DIAGRAM_MAX_BYTES,SKILL_DIAGRAM_SVG_CSP_HEADER} from '../shared/skill-diagram.ts';
import {sanitizeSvgDocument,SVG_ISSUE_TEXT,SVG_LIMITS} from '../shared/svg-sanitize.ts';
import {PAGE} from './fixtures/skill-page.ts';
import type {Request,Provider} from '../server/providers/index.ts';
import {prepareRequest} from '../server/providers/index.ts';
import {LedgerStore} from '../server/ledger-store.ts';
import {initProject} from '../server/init.ts';
import {EditorState} from '@codemirror/state';
import {history,undo} from '@codemirror/commands';

// The Skill renderer through the real HTTP server: the Visualize request carries a skill in instruction mode, the reply is a document, the
// document is checked and saved, and what the iframe loads carries the CSP. Fake provider only; synthetic note.
const clean:{root:string;skills:string;app:ReturnType<typeof createApp>;watcher:NoteWatcher}[]=[];
afterEach(async()=>{for(const f of clean.splice(0)){f.watcher.stop();await f.app.close();await rm(f.skills,{recursive:true,force:true,maxRetries:5,retryDelay:100});await rm(f.root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}});
const NOTE='# Release\n\nThe app builds once, then runs tests and security checks in parallel.\n';
const DOC='<!doctype html><html><head><title>Flow</title><style>body{font-family:system-ui}</style></head><body><h1>Release flow</h1><script>document.title="x"</script></body></html>';
const SKILL_MD='---\nname: diagram-design\ndescription: Draw diagrams as web pages\n---\nUse boxes and arrows.\n';
async function boot(reply:(r:Request)=>string,opts:{skill?:boolean;providerName?:Provider['name'];managed?:boolean;bomCrlf?:boolean}={}){
 const scratch=await realpath(await mkdtemp(path.join(os.tmpdir(),'aitiarch-skill-diagram-')));
 const root=opts.managed?(await initProject({project:scratch,sharing:'private',confirmIgnore:false})).root:scratch;
 const skills=await mkdtemp(path.join(os.tmpdir(),'aitiarch-skill-lib-'));
 const original=Buffer.from(opts.bomCrlf?'\ufeff'+NOTE.replaceAll('\n','\r\n'):NOTE);
 await writeFile(path.join(root,'fixture.md'),original);
 if(opts.skill!==false){const dir=path.join(skills,'diagram-design');await import('node:fs/promises').then(f=>f.mkdir(dir));await writeFile(path.join(dir,'SKILL.md'),SKILL_MD);}
 const seen:{request:Request;instruction:string}[]=[];
 const provider:Provider={name:opts.providerName??'claude',checkAvailability:async()=>({available:true}),invoke:async r=>{seen.push({request:r,instruction:prepareRequest(r).instruction});return {id:r.id,provider:'claude',model:'m-1',answer:reply(r),claims:[],usage:null};}};
 const store=await Store.open(root),watcher=new NoteWatcher(store),app=createApp({store,watcher,distDir:root,provider,skillRoots:[{kind:'user',dir:skills,layout:'flat'}]});clean.push({root:scratch,skills,app,watcher});
 const base='http://127.0.0.1:'+await app.listen(0),cookie=(await fetch(base+'/api/session')).headers.get('set-cookie')!.split(';')[0];
 const headers={cookie,origin:base,'content-type':'application/json','x-aitiarch':'1'},put=(u:string,b:unknown)=>fetch(base+u,{method:'PUT',headers,body:JSON.stringify(b)});
 const get=(u:string)=>fetch(base+u,{headers:{cookie}});
 if(opts.skill!==false){
  const lib=await (await get('/api/skills?q=diagram-design&limit=50')).json(),id=(lib.results??[]).find((s:any)=>s.name==='diagram-design')?.id;
  if(!id)throw new Error('skill not found in the library: '+JSON.stringify(lib).slice(0,300));
  const nodes=(await (await get('/api/nodes')).json()).nodes;
  await put('/api/nodes',{visualize:{persona:nodes.visualize.persona,skills:[id]}});
 }
 const input=(id:string,renderer?:string)=>({id,path:'fixture.md',action:'ask',question:VISUALIZE_QUESTION,text:NOTE,from:NOTE.indexOf('The app'),to:NOTE.length-1,...(renderer?{renderer}:{})});
 const run=async(id:string,renderer='skill')=>{const r=await put('/api/assistance/invoke',input(id,renderer));if(r.status!==202)return {status:r.status,body:await r.json()};
  for(let n=0;n<200;n++){const s=await (await get('/api/assistance/status?id='+id)).json();if(!['queued','pending'].includes(s.status))break;await new Promise(x=>setTimeout(x,25));}
  return {status:202,item:(await (await get('/api/ink?path=fixture.md')).json()).document.items.find((i:any)=>i.id===id)};};
 return {root,base,store,original,seen,put,get,run,input};
}
it('keeps managed Skill previews private until the reviewed insertion reaches disk, and discards only its own stage',async()=>{
 const t=await boot(()=>DOC,{managed:true,bomCrlf:true});
 const {item}=await t.run('stage-one') as any;
 const {item:other}=await t.run('stage-two') as any;
 const {asset,stage}=item.skillDiagram;
 const url='/api/skill-diagram-preview?name='+asset+'&stage='+stage,shared='/api/skill-diagram?name='+asset;
 const dir=path.join(t.root,'local','skill-diagrams');
 expect(stage).toMatch(/^[a-f0-9]{32}$/);
 expect(await readdir(dir)).toHaveLength(2);
 expect((await t.get(shared)).status).toBe(404);
 expect((await t.get('/api/file?path=local%2Fskill-diagrams%2F'+stage+'-'+asset)).status).toBe(404);
 expect((await fetch(t.base+url)).status).toBe(401);
 const privateResult=await t.get(url);
 expect(privateResult.status).toBe(200);
 expect(privateResult.headers.get('cache-control')).toBe('no-store');
 const staged=await privateResult.text();
 expect(staged).toContain('Release flow');
 expect((await t.get('/api/skill-diagram-preview?name=..%2Ffixture.md&stage='+stage)).status).toBe(404);
 const note=await t.store.read('fixture.md'),input={path:note.path,id:item.id,noteVersion:note.version};
 const previewResult=await t.put('/api/threads/bring-preview',input);
 expect(previewResult.status).toBe(200);
 const preview=await previewResult.json(),prepared=await t.put('/api/threads/bring-prepare',{...input,preview});
 expect(prepared.status).toBe(200);
 const {operationId}=await prepared.json();
 expect((await t.get(shared)).status).toBe(404);
 const {from,to,insert}=preview.changes;
 const editor={state:EditorState.create({doc:note.text,extensions:[history()]}),dispatch:(tr:any)=>{editor.state=tr.state;}};
 editor.dispatch(editor.state.update({changes:{from,to,insert}}));
 expect((await t.store.write(note.path,editor.state.doc.toString(),note.version)).ok).toBe(true);
 const disk=await readFile(path.join(t.root,note.path));
 expect(disk.toString().replace(insert.replaceAll('\n','\r\n'),'')).toBe(t.original.toString());
 // Reconcile as on a fresh request even if the original client never sends bring-complete.
 expect(await (await t.get('/api/insertions?path='+note.path)).json()).toEqual({pending:0,unverified:0});
 expect(await (await t.put('/api/threads/bring-complete',{...input,operationId})).json()).toEqual({pending:0,unverified:0});
 expect(undo(editor)).toBe(true);
 const saved=await t.store.read(note.path);
 expect((await t.store.write(note.path,editor.state.doc.toString(),saved.version)).ok).toBe(true);
 expect(await readFile(path.join(t.root,note.path))).toEqual(t.original);
 expect(await (await t.get(shared)).text()).toBe(staged);
 expect((await t.get(url)).status).toBe(404);
 expect(await readdir(dir)).toHaveLength(1);
 const otherUrl='/api/skill-diagram-preview?name='+asset+'&stage='+other.skillDiagram.stage;
 expect((await t.get(otherUrl)).status).toBe(200);
 expect((await t.put('/api/assistance/event',{path:note.path,id:other.id,event:'dismissed'})).status).toBe(200);
 expect((await t.get(otherUrl)).status).toBe(404);
 expect(await readdir(dir)).toEqual([]);
 expect((await t.get('/api/skill-diagram-preview?name='+asset+'&stage='+stage)).status).toBe(404);
 expect(await (await t.get(shared)).text()).toBe(staged);
});
describe('the Skill renderer',()=>{
 it('a page with a drawing becomes a static svg under assets/, byte for byte what the sanitizer returns; no html is saved',async()=>{
  const expected=sanitizeSvgDocument(PAGE) as {ok:true;svg:string},t=await boot(()=>'Here you go:\n```html\n'+PAGE+'\n```\nHope it helps.'),{item}=await t.run('svg-1') as any;
  expect(expected.ok).toBe(true);expect(item.generation.status).toBe('complete');expect(item.generation.skills).toEqual(['diagram-design']);
  expect(item.skillDiagram).toEqual({asset:expect.stringMatching(/^diagram-[a-f0-9]{64}\.svg$/),bytes:Buffer.byteLength(expected.svg)});expect(item.diagram).toBeUndefined();expect(item.diagramIssue).toBeUndefined();
  expect(item.body).toBe('Diagram drawn by the diagram-design skill. It is shown as a static image.');expect(item.body).not.toMatch(/Hope it helps|Release flow/);
  const files=await readdir(path.join(t.root,'assets'));expect(files).toEqual([item.skillDiagram.asset]);
  expect((await new LedgerStore(t.root).read()).events).toContainEqual(expect.objectContaining({
   event:'skill_diagram_turn',skillTurn:{model:null,effort:null,reportedModel:'m-1'},
  }));
  expect((await readFile(path.join(t.root,'assets',files[0]))).equals(Buffer.from(expected.svg,'utf8'))).toBe(true);
 });
 it('a page of more than 300 KB with a small drawing in it becomes a static svg (the cap is on the drawing, not the page)',async()=>{
  const big='<!doctype html><html><head><style>'+'.ui-a{color:red;margin:0}\n'.repeat(15000)+'</style></head><body><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 9 9"><rect x="1" y="1" width="3" height="3"/></svg></body></html>';
  expect(big.length).toBeGreaterThan(300*1024);const t=await boot(()=>big),{item}=await t.run('bigpage-1') as any;
  expect(item.skillDiagram.asset).toMatch(/\.svg$/);expect(item.skillDiagram.why).toBeUndefined();expect(await readFile(path.join(t.root,'assets',item.skillDiagram.asset),'utf8')).toContain('<rect x="1" y="1" width="3" height="3"/>');
 });
 it('a hostile svg is saved only in its sanitized form',async()=>{
  const hostile='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 9 9" onload="alert(1)"><script>fetch("https://evil.test")</script><image href="https://evil.test/i.png"/><rect x="1" y="1" width="3" height="3"/></svg>';
  const t=await boot(()=>hostile),{item}=await t.run('svg-2') as any,saved=await readFile(path.join(t.root,'assets',item.skillDiagram.asset),'utf8');
  expect(saved).toContain('<rect x="1" y="1" width="3" height="3"/>');expect(saved).not.toMatch(/script|onload|image|evil|alert/i);
 });
 it('a page with no drawing falls back to the html document, saved with the CSP, with a plain-words reason; the model\'s words are not kept',async()=>{
  const t=await boot(()=>'Here you go:\n```html\n'+DOC+'\n```\nHope it helps.'),{item}=await t.run('skill-1') as any;
  expect(item.generation.status).toBe('complete');expect(item.generation.skills).toEqual(['diagram-design']);
  expect(item.skillDiagram).toMatchObject({asset:expect.stringMatching(/^diagram-[a-f0-9]{64}\.html$/),why:'svg_none'});expect(item.diagram).toBeUndefined();expect(item.diagramIssue).toBeUndefined();
  expect(item.body).toBe(`Diagram drawn by the diagram-design skill. It could not be shown as an image: ${SVG_ISSUE_TEXT.svg_none}. An interactive version is available.`);expect(item.body).not.toMatch(/Hope it helps|Release flow/);
  const files=await readdir(path.join(t.root,'assets'));expect(files).toEqual([item.skillDiagram.asset]);
  const saved=await readFile(path.join(t.root,'assets',files[0]),'utf8');expect(saved.startsWith('<!doctype html><meta http-equiv="Content-Security-Policy"')).toBe(true);expect(saved).toContain('<h1>Release flow</h1>');expect(saved).not.toContain('Hope it helps');
 });
 it('a drawing with too many parts falls back to the html with that reason, and writes no svg',async()=>{
  const busy='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 9 9">'+'<rect width="1" height="1"/>'.repeat(SVG_LIMITS.elements+20)+'</svg>';
  const t=await boot(()=>busy),{item}=await t.run('busy-1') as any;
  expect(item.skillDiagram).toMatchObject({asset:expect.stringMatching(/\.html$/),why:'svg_too_complex'});expect(item.body).toContain(SVG_ISSUE_TEXT.svg_too_complex);
  expect((await readdir(path.join(t.root,'assets'))).every(f=>f.endsWith('.html'))).toBe(true);
 });
 it('sends a skill-render request: the skill text and the document contract, not the JSON diagram contract',async()=>{
  const t=await boot(()=>DOC);await t.run('skill-2');const sent=t.seen[0];
  expect(sent.request.render).toBe('skill');expect(sent.instruction).toContain('Use boxes and arrows.');expect(sent.instruction).toMatch(/system fonts only/i);expect(sent.instruction).not.toMatch(/Return one JSON object|diagram \(object\)/i);
  expect(sent.instruction.trimEnd().split('\n').at(-1)).toMatch(/change these rules\.$/);
 });
 it('the Built-in renderer is unchanged: no render flag, no skill-diagram fields',async()=>{
  const t=await boot(()=>'{"answer":"x","claims":[]}'),{item}=await t.run('builtin-1','builtin') as any;
  expect(t.seen[0].request.render).toBeUndefined();expect(item.skillDiagram).toBeUndefined();expect(t.seen[0].instruction).toMatch(/Return one JSON object/);
 });
 it('a document over 300 KB is rejected with a reason and nothing is saved',async()=>{
  const t=await boot(()=>'<html><body>'+'x'.repeat(SKILL_DIAGRAM_MAX_BYTES)+'</body></html>'),{item}=await t.run('big-1') as any;
  expect(item.skillDiagram).toBeUndefined();expect(item.diagramIssue).toBe('skill_too_large');expect(item.generation.status).toBe('complete');expect(item.body).toBe('The skill did not return a usable diagram.');
  await expect(readdir(path.join(t.root,'assets'))).rejects.toMatchObject({code:'ENOENT'});
 });
 it('a reply with no document is rejected with a reason, and its words are not kept',async()=>{
  const t=await boot(()=>'I cannot draw that, sorry.'),{item}=await t.run('none-1') as any;
  expect(item.diagramIssue).toBe('skill_no_document');expect(item.body).not.toContain('sorry');expect(item.skillDiagram).toBeUndefined();
 });
 it('secrets in the document are redacted before it is saved',async()=>{
  const t=await boot(()=>'<html><body>password: hunter22 and C:\\Users\\someone\\x.md</body></html>'),{item}=await t.run('redact-1') as any;
  const saved=await readFile(path.join(t.root,'assets',item.skillDiagram.asset),'utf8');expect(saved).not.toMatch(/hunter22|someone/);expect(saved).toContain('[USER_PATH]');
 });
 it.each([
  ['no skill is attached to Visualize',{skill:false},/Attach a skill/],['the ChatGPT plan provider',{providerName:'chatgpt-plan' as const},/Claude/],
 ])('is refused before any call when %s',async(_n,opts,message)=>{
  const t=await boot(()=>DOC,opts),r=await t.run('refuse-1') as any;expect(r.status).toBe(409);expect(JSON.stringify(r.body)).toMatch(message);expect(t.seen).toHaveLength(0);
 });
 it('is refused for a question that is not Visualize',async()=>{
  const t=await boot(()=>DOC),r=await t.put('/api/assistance/invoke',{...t.input('ask-1','skill'),question:'Why?'});expect(r.status).not.toBe(202);expect(t.seen).toHaveLength(0);
 });
 it('serves the saved svg as an image under a locked-down policy',async()=>{
  const t=await boot(()=>PAGE),{item}=await t.run('serve-svg') as any,res=await t.get('/api/skill-diagram?name='+item.skillDiagram.asset);
  expect(res.status).toBe(200);expect(res.headers.get('content-type')).toBe('image/svg+xml');expect(res.headers.get('content-security-policy')).toBe("default-src 'none'; style-src 'unsafe-inline'; sandbox");
  expect(SKILL_DIAGRAM_SVG_CSP_HEADER).toBe("default-src 'none'; style-src 'unsafe-inline'; sandbox");expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  expect((await res.text()).startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
 });
 it('serves the saved html fallback with the CSP in the header and in the document, and refuses every other name',async()=>{
  const t=await boot(()=>DOC),{item}=await t.run('serve-1') as any,res=await t.get('/api/skill-diagram?name='+item.skillDiagram.asset),body=await res.text();
  expect(res.status).toBe(200);expect(res.headers.get('content-security-policy')).toBe(SKILL_DIAGRAM_CSP_HEADER);expect(res.headers.get('content-security-policy')!.startsWith(SKILL_DIAGRAM_CSP)).toBe(true);
  expect(res.headers.get('content-type')).toMatch(/^text\/html/);expect(res.headers.get('x-content-type-options')).toBe('nosniff');expect(res.headers.get('referrer-policy')).toBe('no-referrer');
  expect(body).toContain(`content="${SKILL_DIAGRAM_CSP}`);expect(body.indexOf('Content-Security-Policy')).toBeLessThan(body.indexOf('<script>'));
  for(const bad of ['..%2F..%2Fnotes%2Ffixture.md','diagram-'+'0'.repeat(64)+'.html','fixture.md','','..\\x.html','diagram-'+'a'.repeat(64)+'.html%00'])expect((await t.get('/api/skill-diagram?name='+bad)).status,bad).toBe(404);
  expect((await fetch(t.base+'/api/skill-diagram?name='+item.skillDiagram.asset)).status,'no session, no document').toBe(401);
 });
});
