// Synthetic data and fake provider only. Run after building, with output outside the repo.
import './config-isolation.mjs';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {gzipSync} from 'node:zlib';
import {chromium} from 'playwright-core';
import {Store} from '../server/store.ts';
import {NoteWatcher} from '../server/watch.ts';
import {createApp} from '../server/http.ts';
import {InkStore} from '../server/ink-store.ts';
import {captureAnchor} from '../shared/anchors.ts';

const here=path.dirname(fileURLToPath(import.meta.url));
const out=path.resolve(process.env.BATCH2A_OUTPUT??'');
const relative=path.relative(path.resolve(here,'../..'),out);
assert(process.env.BATCH2A_OUTPUT&&(relative.startsWith('..'+path.sep)||path.isAbsolute(relative)),'Use an output folder outside the repo');
await mkdir(out,{recursive:true});
const graph=JSON.parse(await readFile(path.join(here,'out/diagram-build-graph.json'),'utf8'));
const chunks=new Map(graph.map(chunk=>[chunk.file,chunk]));
const initial=new Set();
function visit(chunk){
 if(initial.has(chunk.file))return;
 initial.add(chunk.file);
 for(const file of chunk.imports)visit(chunks.get(file));
}
const entry=graph.find(chunk=>chunk.isEntry);
visit(entry);
const renderLibrary=/node_modules\/(?:katex|mermaid|elkjs)\//;
for(const file of initial)assert(!chunks.get(file).modules.some(module=>renderLibrary.test(module)),file+' statically loads a render library');
const libraries=[['KaTeX',/node_modules\/katex\/dist\/katex/],['Mermaid core',/node_modules\/mermaid\/dist\/mermaid/],['ELK',/node_modules\/elkjs\/lib\/elk[.-]/]];
const sizes={};
for(const [name,chunk] of [['Entry',entry],...libraries.map(([name,pattern])=>{
 const matches=graph.filter(chunk=>chunk.modules.some(module=>pattern.test(module)));
 assert.equal(matches.length,1,name+' must have one chunk');
 assert(!initial.has(matches[0].file),name+' must be lazy');
 return [name,matches[0]];
})]){
 const buffer=await readFile(path.join(here,'../dist',chunk.file));
 sizes[name]={file:chunk.file,raw:buffer.length,gzip:gzipSync(buffer).length};
}
await writeFile(path.join(out,'bundle-sizes.json'),JSON.stringify(sizes,null,2));

const root=await mkdtemp(path.join(os.tmpdir(),'aitiarch-rich-fixture-'));
const note='# Synthetic notebook\n\nThis paragraph holds the imaginary flow.\n';
const filename=path.join(root,'fixture.md');
const original=Buffer.from('\uFEFF'+note.replace(/\n/g,'\r\n'));
await writeFile(filename,original);
const rich=[
 'Energy is $E=mc^2$. Price $5 and $10. Inline code `$literal$`.',
 '$$\n\\frac{1}{2}\n$$',
 '```js\nconst x = "$literal$";\n```',
 '| Step | Output |\n| --- | --- |\n| One | Two |',
 '- A list\n- [x] Completed',
 '```mermaid\nflowchart TD\nA[Start] --> B[Finish]\n```',
 '<img src="https://example.invalid/image.png">',
 '```mermaid\nflowchart TD\nA --> B\nclick A "https://example.invalid/"\n```',
].join('\n\n');
const ink=await InkStore.open(root), snapshot=await ink.read('fixture.md');
const from=note.indexOf('This paragraph'),to=note.indexOf('imaginary')+9,anchor=captureAnchor(note,from,to);
snapshot.document.items.push({id:'rich-seed',kind:'answer',body:rich,anchor,originalAnchor:anchor,attachment:{status:'attached',from,to},
 generation:{requestId:'rich-seed',action:'think',provider:'claude',model:null,createdAt:new Date().toISOString(),status:'complete',evidence:[],dismissed:false}});
await ink.write('fixture.md',snapshot.document,snapshot.version);
const store=await Store.open(root),watcher=new NoteWatcher(store);
let calls=0;
const provider={name:'claude',checkAvailability:async()=>({available:true}),async invoke(request){
 calls++;
 return {id:request.id,provider:'claude',model:null,answer:rich,claims:[],usage:{inputTokens:120,cachedTokens:0,outputTokens:60}};
}};
const app=createApp({store,watcher,distDir:path.join(here,'../dist'),provider});
let browser;
try{
 const origin='http://127.0.0.1:'+await app.listen(0);
 browser=await chromium.launch({channel:'msedge',headless:true});
 const context=await browser.newContext({viewport:{width:1500,height:1000},permissions:['clipboard-read','clipboard-write'],reducedMotion:'reduce'});
 const page=await context.newPage();
 const external=[];
 await page.route('**/*',route=>{
  const url=route.request().url();
  if(new URL(url).origin===origin||url.startsWith('data:')||url.startsWith('blob:'))return route.continue();
  external.push(url);return route.abort();
 });
 await page.goto(origin+'/?debug=1');
 const verify=async(surface,name)=>{
  await surface.locator('[data-rich-math="inline"] math').first().waitFor({state:'attached'});
  await surface.locator('[data-rich-math="display"] math').first().waitFor({state:'attached'});
  await surface.locator('[data-rich-diagram] svg').first().waitFor({state:'attached'});
  await surface.getByText('Diagram syntax is outside the supported rendering limits.').first().waitFor({state:'attached'});
  assert.equal(await surface.locator('.reply-markdown :is(a[href],img,foreignObject,script,[onclick],[onload])').count(),0,name+' contained active markup');
  assert.equal(await surface.locator('.reply-markdown table').count(),1);
  assert.equal(await surface.locator('.reply-markdown ul').count(),1);
  await surface.getByRole('button',{name:'Copy JavaScript code'}).first().click();
  assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),'const x = "$literal$";');
 };
 const blob=page.locator('.margin-card.thought-blob').first();
 await verify(blob,'margin');
 await blob.locator('.thought-text .reply-markdown p').first().click();
 const thread=page.locator('.thread-panel .thread-reply').first();
 await verify(thread,'thread');
 assert.equal(await page.getByRole('textbox',{name:'Your takeaway'}).inputValue(),'');
 assert.equal(await page.getByRole('button',{name:'Submit my takeaway'}).isEnabled(),false);
 assert.equal(calls,0,'stored replies must render without inference');
 await page.getByRole('button',{name:/^Chat/}).click();
 const panel=page.locator('#chat-panel'),composer=panel.getByRole('textbox',{name:'Message Aitiarch AI'});
 await composer.fill('Explain the synthetic flow.');
 await composer.press('Enter');
 await panel.getByRole('region',{name:'What will be sent'}).getByRole('button',{name:/^Send/}).click();
 await verify(panel.locator('.chat-message.chat-ai').first(),'chat');
 assert.equal(calls,1);
 assert.deepEqual(await readFile(filename),original,'render and Copy leave BOM/CRLF document bytes untouched');
 await panel.getByRole('button',{name:'Add to note',exact:true}).first().click();
 const toast=page.locator('.thought-toast').filter({hasText:'Added from chat'});
 await toast.waitFor();
 const documentText=()=>page.evaluate(()=>window.__aitiarch['fixture.md'].view.state.doc.toString());
 const quoted=rich.split('\n').map(line=>'> '+line).join('\n');
 assert((await documentText()).includes(quoted),'Add to note must insert the original Markdown');
 await toast.getByRole('button',{name:'Undo',exact:true}).click();
 assert.equal(await documentText(),note);
 for(let attempts=0;attempts<40;attempts++){if((await readFile(filename)).equals(original))break;await page.waitForTimeout(150);}
 assert.deepEqual(await readFile(filename),original,'Undo restores BOM/CRLF bytes');
 assert.deepEqual(external,[]);
 console.log('Rich rendering and Copy passed in chat, margin and thread. Bundle sizes:',sizes);
}finally{
 await browser?.close();
 watcher.stop();
 await app.close();
}
