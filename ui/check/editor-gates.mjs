// Slice A gates in the real app (Edge, built bundle, fake provider only). Synthetic Markdown in a temp folder.
// Run: BATCH2A_OUTPUT=<dir outside the repo> node check/editor-gates.mjs   (after `vite build`)
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';import {chromium} from 'playwright-core';
import {Store} from '../server/store.ts';import {NoteWatcher} from '../server/watch.ts';import {createApp} from '../server/http.ts';
const ui=fileURLToPath(new URL('../',import.meta.url)),repo=path.resolve(ui,'..');
const output=path.resolve(process.env.BATCH2A_OUTPUT??'');assert(process.env.BATCH2A_OUTPUT&&!output.toLowerCase().startsWith(repo.toLowerCase()),'Output must be outside repo');await mkdir(output,{recursive:true});
const report={};let calls=0,external=0;const errors=[];
const small='\uFEFF# Gate heading\r\n\r\nIntro paragraph here.\r\n\r\n## Second heading\r\n\r\nSome **bold** and ~~struck~~ and `code` words, plus https://example.test/page and <https://angle.test>.\r\n\r\n> quoted line\r\n> > nested line\r\n\r\n---\r\n\r\nThe end.\r\n';
const wrapped='# A very long launch plan heading that wraps across several visual lines in a narrow column of text\r\n\r\n> a quoted line that is also long enough to wrap onto more than one visual line in this narrow column here\r\n\r\nStart **bold words** then ~~struck text~~ and `some code` continue with a long tail of ordinary words so that this paragraph wraps onto several lines in a narrow column.\r\n';
const big=n=>{let s='# Big note\n';for(let i=0;i<n;i++)s+=`\n## Section ${i}\n\nParagraph with **bold** words and *italic* and \`code\` and a [link](https://x.test/${i}).\n\n- bullet one\n- bullet two\n\n> quoted line ${i}\n\nPlain filler paragraph number ${i}.\n`;return s;};

async function session(name,content,fn){
 const root=await mkdtemp(path.join(os.tmpdir(),'aitiarch-gates-'));execFileSync('git',['init','-q'],{cwd:root,stdio:'pipe'});await writeFile(path.join(root,'.gitignore'),'/.cache/\n/ui-state.json*\n');
 const bytes=Buffer.from(content);await writeFile(path.join(root,'n.md'),bytes);
 const store=await Store.open(root),watcher=new NoteWatcher(store,50,10);await watcher.start();
 const app=createApp({store,watcher,distDir:path.join(ui,'dist'),provider:{name:'claude',checkAvailability:async()=>({available:true}),invoke:async()=>{calls++;throw Error('Provider calls forbidden');}}});
 const base=`http://127.0.0.1:${await app.listen(0)}`;const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  for(const theme of ['light','dark']){
   const page=await browser.newPage({viewport:{width:1440,height:1000},colorScheme:theme});
   await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin!==base){external++;return route.abort();}if(u.pathname==='/api/usage')return route.fulfill({json:{providers:[],hourlyCap:2}});return route.continue();});
   page.on('pageerror',e=>errors.push(`${name}: ${e.message}`));
   await page.goto(base+'/?debug=1');await page.waitForFunction(()=>window.__aitiarch?.['n.md']);
   await fn({page,theme,root,bytes});await page.close();
  }
 }finally{await browser.close();await app.close?.();await watcher.stop?.();await rm(root,{recursive:true,force:true});}
}
const V=`window.__aitiarch['n.md'].view`;
const settle=p=>p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
const doc=p=>p.evaluate(`${V}.state.doc.toString()`);
const put=async(p,anchor,head=anchor)=>{await p.evaluate(([a,h])=>{const v=window.__aitiarch['n.md'].view;v.dispatch({selection:{anchor:a,head:h}});v.focus();},[anchor,head]);await settle(p);};
const disk=async(p,root)=>{await p.evaluate(()=>window.__aitiarch['n.md'].session.flush());return readFile(path.join(root,'n.md'));};

// ---- 1. byte-exact, undo, IME, copy, geometry on a BOM + CRLF note
await session('small',small,async({page,theme,root,bytes})=>{
 const d=await doc(page);const R={};report[`small-${theme}`]=R;
 for(let p=0;p<=d.length;p+=3)await put(page,p);
 assert.deepEqual(await disk(page,root),bytes,'sweep changed bytes');
 const h2=d.indexOf('## Second');await put(page,h2+5);await page.keyboard.type('Z');assert.notEqual(await doc(page),d);await page.keyboard.press('Control+z');assert.equal(await doc(page),d);
 assert.deepEqual(await disk(page,root),bytes,'type+undo changed bytes');R.byteExactAfterTypeUndo=true;
 const cdp=await page.context().newCDPSession(page);R.ime={};
 for(const [label,needle,expect] of [['heading line start','## Second heading','\u3042## Second heading'],['quote line start','> quoted line','\u3042> quoted line']]){
  await put(page,d.length);await put(page,d.indexOf(needle));
  await cdp.send('Input.imeSetComposition',{text:'\u3042',selectionStart:1,selectionEnd:1});await cdp.send('Input.insertText',{text:'\u3042'});
  const after=(await doc(page)).split('\n').filter(l=>l.includes('\u3042'));R.ime[label]={ok:after.length===1&&after[0]===expect,after};assert.equal(after.length,1);assert.equal(after[0],expect);
  await page.keyboard.press('Control+z');assert.equal(await doc(page),d);
 }
 assert.deepEqual(await disk(page,root),bytes,'IME+undo changed bytes');
 const b=d.indexOf('**bold**');await put(page,b,b+8);
 R.copy=await page.evaluate(()=>{const v=window.__aitiarch['n.md'].view,dt=new DataTransfer();v.contentDOM.dispatchEvent(new ClipboardEvent('copy',{clipboardData:dt,bubbles:true,cancelable:true}));return dt.getData('text/plain');});assert.equal(R.copy,'**bold**');
 const x=async pos=>page.evaluate(p=>Math.round(window.__aitiarch['n.md'].view.coordsAtPos(p).left*10)/10,pos);
 R.shift={};
 for(const [label,needle,off] of [['heading','## Second heading',8],['quote','> quoted line',5],['nested quote','> > nested line',9]]){
  const i=d.indexOf(needle)+off;await put(page,d.length);const a=await x(i);await put(page,i);const c=await x(i);R.shift[label]=Math.round((c-a)*10)/10;assert.equal(R.shift[label],0,`${label} text moved`);
 }
 await put(page,d.indexOf('Intro')+6,h2+11);
 R.selection=await page.evaluate(()=>{const rects=[...document.querySelectorAll('.cm-selectionBackground')].map(e=>e.getBoundingClientRect()),m=document.querySelector('.cm-gm-on');if(!m)return{marker:false};const r=m.getBoundingClientRect();return{marker:true,ownTint:m.classList.contains('cm-gm-sel'),covers:m.classList.contains('cm-gm-sel')||rects.some(q=>q.left<=r.left+1&&q.right>=r.right-1&&q.top<=r.bottom&&q.bottom>=r.top)};});
 assert.equal(R.selection.covers,true,'selection does not cover the gutter marker');
 await page.locator('.editor-col').screenshot({path:path.join(output,`gate-selection-${theme}.png`)});
 await put(page,d.length);await page.locator('.editor-col').screenshot({path:path.join(output,`gate-away-${theme}.png`)});
 await put(page,h2+4);await page.locator('.editor-col').screenshot({path:path.join(output,`gate-on-heading-${theme}.png`)});
 R.contrast=await page.evaluate(()=>{const m=document.querySelector('.cm-gm-on');const lin=c=>{c/=255;return c<=.03928?c/12.92:((c+.055)/1.055)**2.4};const rgb=s=>(s.match(/[\d.]+/g)||[]).slice(0,3).map(Number);const L=a=>.2126*lin(a[0])+.7152*lin(a[1])+.0722*lin(a[2]);const fg=rgb(getComputedStyle(m).color),bg=rgb(getComputedStyle(document.body).backgroundColor);const a=L(fg),b=L(bg);return Math.round((Math.max(a,b)+.05)/(Math.min(a,b)+.05)*100)/100;});
 assert(R.contrast>=4.5,`gutter marker contrast ${R.contrast}`);
});

// ---- 2. wrapped headings and inline reveal on wrapped lines (narrow editor)
await session('wrapped',wrapped,async({page,theme})=>{
 await page.setViewportSize({width:760,height:900});await settle(page);const d=await doc(page);const R={};report[`wrapped-${theme}`]=R;
 await put(page,6);
 R.heading=await page.evaluate(()=>{const v=window.__aitiarch['n.md'].view,m=document.querySelector('.cm-gm-on'),line=m.closest('.cm-line');const lr=line.getBoundingClientRect(),mr=m.getBoundingClientRect(),lh=v.coordsAtPos(8);return{visualLines:Math.round(lr.height/(lh.bottom-lh.top)),markerTopMinusLineTop:Math.round(mr.top-lr.top)};});
 assert(R.heading.visualLines>=2,'heading did not wrap');assert.equal(R.heading.markerTopMinusLineTop,0);
 const heads=[];for(let k=0;k<4;k++){await page.keyboard.press('ArrowDown');await page.waitForTimeout(40);heads.push(await page.evaluate(`${V}.state.selection.main.head`));}R.arrowDownHeads=heads;assert(heads.every((h,i)=>i===0||h>heads[i-1]),'ArrowDown did not advance monotonically');
 await page.screenshot({path:path.join(output,`gate-wrapped-heading-${theme}.png`),clip:{x:0,y:0,width:760,height:420}});
 R.inline={};
 const para=d.indexOf('Start **bold');
 const probe=([a,b])=>{const v=window.__aitiarch['n.md'].view;return{x:v.coordsAtPos(b).left,h:Math.round(v.lineBlockAt(a).height)};};
 for(const [label,needle,inside] of [['bold','**bold words**',4],['strike','~~struck text~~',4],['code','`some code`',3]]){
  const i=d.indexOf(needle),after=i+needle.length+1;
  await put(page,d.length);const r0=await page.evaluate(probe,[para,after]);
  await put(page,i+inside);const r1=await page.evaluate(probe,[para,after]);
  R.inline[label]={dxSameLine:Math.round((r1.x-r0.x)*10)/10,heightBefore:r0.h,heightAfter:r1.h};
 }
 await put(page,para+8);await page.screenshot({path:path.join(output,`gate-inline-reveal-${theme}.png`),clip:{x:0,y:200,width:760,height:420}});
});

// ---- 3. cost at about 5,000 and 50,000 lines (real app, ink and anchors on)
for(const n of [380,3850]){
 await session(`big-${n}`,big(n),async({page,theme})=>{
  if(theme!=='light')return;
  const m=await page.evaluate(async()=>{const v=window.__aitiarch['n.md'].view,N=v.state.doc.lines,sl=()=>new Promise(r=>requestAnimationFrame(()=>r()));const st=a=>{a=[...a].sort((x,y)=>x-y);return{median:+a[a.length>>1].toFixed(1),p95:+a[Math.floor(a.length*.95)].toFixed(1)}};
   const mv=[],ty=[];for(let k=0;k<25;k++){const l=v.state.doc.line(1+Math.floor((N-1)*((k*37)%100)/100));const t=performance.now();v.dispatch({selection:{anchor:l.from}});mv.push(performance.now()-t);await sl();}
   const mid=v.state.doc.line(Math.floor(N/2)).from;for(let k=0;k<25;k++){const t=performance.now();v.dispatch({changes:{from:mid,insert:'x'},selection:{anchor:mid+1}});ty.push(performance.now()-t);await sl();v.dispatch({changes:{from:mid,to:mid+1}});}
   return{lines:N,move:st(mv),keystroke:st(ty),domLines:document.querySelectorAll('.cm-line').length};});
  report[`perf-${m.lines}`]=m;
 });
}
await writeFile(path.join(output,'editor-gates.json'),JSON.stringify({report,providerCalls:calls,externalRequests:external,errors},null,2));
console.log(JSON.stringify({report,providerCalls:calls,externalRequests:external,errors},null,1));
assert.equal(calls,0);assert.equal(external,0);assert.deepEqual(errors,[]);
