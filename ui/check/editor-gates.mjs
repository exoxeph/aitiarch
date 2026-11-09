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
 if(process.env.EDITOR_GATE_ONLY && process.env.EDITOR_GATE_ONLY!==name)return;
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

// ---- 2b. D1: bullets, checkboxes and code blocks must not shift text; click and key toggle are byte-exact; Copy; highlighting
const d1='\uFEFF# Lists and code\r\n\r\n- plain bullet text\r\n- [ ] open task text\r\n- [x] done task text\r\n\r\n```js\r\nconst answer = "forty-two"; // note\r\nfunction go(n) { return n + 1; }\r\n```\r\n\r\n```sh\r\necho hello\r\n```\r\n\r\nThe end.\r\n';
await session('d1',d1,async({page,theme,root,bytes})=>{
 const R={};report[`d1-${theme}`]=R;let d=await doc(page);
 await page.evaluate(()=>{window.__copied=[];navigator.clipboard.writeText=async t=>{window.__copied.push(t);};});
 const x=pos=>page.evaluate(p=>Math.round(window.__aitiarch['n.md'].view.coordsAtPos(p).left*10)/10,pos);
 const y=pos=>page.evaluate(p=>{const v=window.__aitiarch['n.md'].view;return Math.round(v.lineBlockAt(p).height*10)/10;},pos);
 // no shift entering/leaving: first text character of each list line and of the code
 R.shift={};
 for(const [label,needle,off] of [['bullet','- plain bullet text',2],['open task','- [ ] open task text',6],['done task','- [x] done task text',6],['code line','const answer',0]]){
  const i=d.indexOf(needle)+off;await put(page,d.length);const a=await x(i),ha=await y(i);await put(page,i);const c=await x(i),hc=await y(i);
  R.shift[label]={dx:Math.round((c-a)*10)/10,dHeight:Math.round((hc-ha)*10)/10};assert.equal(R.shift[label].dx,0,`${label} text moved`);assert.equal(R.shift[label].dHeight,0,`${label} height changed`);
 }
 // click toggles one character; undo restores exact bytes; disk bytes after toggle differ by that one byte only
 await put(page,d.length);
 const box=page.locator('.cm-task-off').first();assert.equal(await page.locator('.cm-task-off').count(),2);
 await box.click();await settle(page);
 const toggled=await doc(page);assert.equal(toggled,d.replace('- [ ] open','- [x] open'),'click did not toggle exactly one character');
 const onDisk=await disk(page,root);assert.equal(onDisk.length,bytes.length);assert.equal(onDisk.toString(),bytes.toString().replace('- [ ] open','- [x] open'));
 await page.keyboard.press('Control+z');assert.equal(await doc(page),d);assert.deepEqual(await disk(page,root),bytes,'toggle+undo changed bytes');R.clickToggleUndoByteExact=true;
 // keyboard toggle on the caret line, and a second toggle back
 await put(page,d.indexOf('done task')+2);await page.keyboard.press('Control+Alt+Enter');await settle(page);assert.equal(await doc(page),d.replace('- [x] done','- [ ] done'));
 await page.keyboard.press('Control+z');assert.equal(await doc(page),d);assert.deepEqual(await disk(page,root),bytes);R.keyToggleUndoByteExact=true;
 // code block: header label, Copy copies exactly the code, fences hidden away and shown inside
 await put(page,d.length);
 R.header=await page.evaluate(()=>[...document.querySelectorAll('.cm-fence-lang')].map(e=>e.textContent));assert.deepEqual(R.header,['JavaScript','Shell']);
 R.fenceAway=await page.evaluate(()=>[...document.querySelectorAll('.cm-fence-open')].map(e=>getComputedStyle(e).color));assert(R.fenceAway.every(c=>/rgba\(0, 0, 0, 0\)|transparent/.test(c)),'fences not hidden away from the block');
 await page.locator('.cm-fence-copy').first().click();R.copied=await page.evaluate(()=>window.__copied.at(-1));assert.equal(R.copied,'const answer = "forty-two"; // note\nfunction go(n) { return n + 1; }');
 assert.equal(await doc(page),d,'Copy changed the document');
 await put(page,d.indexOf('const answer')+3);R.fenceOn=await page.evaluate(()=>getComputedStyle(document.querySelector('.cm-fence-open')).color);assert(!/rgba\(0, 0, 0, 0\)/.test(R.fenceOn));
 // lazy highlighting: the shell pack was requested because the note has an sh fence; the keyword gets its own colour; every token colour passes AA on the code background
 R.shellChunkRequested=await page.evaluate(()=>performance.getEntriesByType('resource').some(r=>/\/assets\/shell-/.test(r.name)));assert(R.shellChunkRequested,'shell pack was not requested lazily');
 await put(page,d.length);await page.waitForTimeout(400);
 R.tokens=await page.evaluate(()=>{const lin=c=>{c/=255;return c<=.03928?c/12.92:((c+.055)/1.055)**2.4};const rgb=s=>(s.match(/[\d.]+/g)||[]).slice(0,3).map(Number);const L=a=>.2126*lin(a[0])+.7152*lin(a[1])+.0722*lin(a[2]);const ratio=(a,b)=>{const p=L(a),q=L(b);return Math.round((Math.max(p,q)+.05)/(Math.min(p,q)+.05)*100)/100};
  const line=[...document.querySelectorAll('.cm-codeblock')].find(l=>l.textContent.includes('const answer'));const bg=rgb(getComputedStyle(line).backgroundColor);const base=getComputedStyle(line).color;
  const spans=[...line.querySelectorAll('span')].filter(s=>getComputedStyle(s).color!==base);const colors=[...new Set(spans.map(s=>getComputedStyle(s).color))];
  const vars={};for(const v of ['keyword','string','number','comment','type','function']){const e=document.createElement('span');e.style.color=`var(--code-${v})`;document.body.append(e);vars[v]=ratio(rgb(getComputedStyle(e).color),bg);e.remove();}
  return{highlightedSpans:spans.length,distinctColours:colors.length,contrastByToken:vars,bg:getComputedStyle(line).backgroundColor};});
 assert(R.tokens.highlightedSpans>0,'no highlighted tokens');for(const [k,v] of Object.entries(R.tokens.contrastByToken))assert(v>=4.5,`code token ${k} contrast ${v}`);
 await page.locator('.editor-col').screenshot({path:path.join(output,`gate-d1-${theme}.png`)});
 await put(page,d.indexOf('open task')+2);await page.locator('.editor-col').screenshot({path:path.join(output,`gate-d1-caret-on-task-${theme}.png`)});
 assert.deepEqual(await disk(page,root),bytes,'D1 interactions changed bytes');
 // Probe (recorded, not asserted): undo straight after a save lands. Typed edit, key toggle and click toggle.
 for(const [label,act] of [['typing',async()=>{await put(page,d.indexOf('Lists')+5);await page.keyboard.type('Z');}],['keyToggle',async()=>{await put(page,d.indexOf('open task')+2);await page.keyboard.press('Control+Alt+Enter');}],['clickToggle',async()=>{await put(page,d.length);await page.locator('.cm-task-off').first().click();}]]){await act();await disk(page,root);await page.keyboard.press('Control+z');await page.waitForTimeout(700);(R.undoAfterSaveProbe??={})[label]=(await doc(page))===d;await put(page,d.length);await disk(page,root);await page.waitForTimeout(300);}
});
// ---- 2c. C: slash menu, driven by real key presses
const slashNote='\uFEFF# Slash gate\r\n\r\nA paragraph.\r\n';
await session('slash',slashNote,async({page,theme,root,bytes})=>{
 const R={};report[`slash-${theme}`]=R;const d=await doc(page);const menu=()=>page.locator('.cm-tooltip-autocomplete');
 const labels=()=>page.locator('.cm-tooltip-autocomplete li').allTextContents();
 await put(page,d.length);await page.keyboard.press('Enter');await page.keyboard.type('/');await menu().waitFor({timeout:3000});
 R.allItems=await labels();assert.equal(R.allItems.length,9);
 await page.keyboard.type('head');R.filtered=await labels();assert.deepEqual(R.filtered.map(s=>s.replace(/#+$/,'')),['Heading 1','Heading 2','Heading 3']);
 await page.locator('.cm-tooltip-autocomplete').screenshot({path:path.join(output,`gate-slash-${theme}.png`)});
 R.selectedContrast=await page.evaluate(()=>{const lin=c=>{c/=255;return c<=.03928?c/12.92:((c+.055)/1.055)**2.4};const rgb=s=>(s.match(/[\d.]+/g)||[]).slice(0,3).map(Number);const L=a=>.2126*lin(a[0])+.7152*lin(a[1])+.0722*lin(a[2]);const li=document.querySelector('.cm-tooltip-autocomplete li[aria-selected]');const cs=getComputedStyle(li);const p=L(rgb(cs.color)),q=L(rgb(cs.backgroundColor));return Math.round((Math.max(p,q)+.05)/(Math.min(p,q)+.05)*100)/100;});assert(R.selectedContrast>=4.5,`selected item contrast ${R.selectedContrast}`);
 await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');await settle(page);
 assert.equal(await doc(page),d+'\n## ','Heading 2 not inserted as plain Markdown');assert.equal(await menu().count(),0,'menu stayed open after choosing');
 await page.keyboard.press('Control+z');assert.equal(await doc(page),d+'\n/head','undo did not return to the typed text');
 await page.keyboard.press('Escape');assert.equal(await menu().count(),0,'Escape did not close the menu');
 // code block puts the caret between the fences
 await put(page,(await doc(page)).length);await page.keyboard.press('Control+z');await page.keyboard.press('Control+z');
 await put(page,(await doc(page)).length);await page.keyboard.type('\n/code');await menu().waitFor();await page.keyboard.press('Enter');await settle(page);
 const afterCode=await doc(page);assert(afterCode.endsWith('```\n\n```'));R.codeCaretLine=await page.evaluate(`(()=>{const v=${V};return v.state.doc.lineAt(v.state.selection.main.head).number-v.state.doc.lines})()`);assert.equal(R.codeCaretLine,-1,'caret not on the blank line between the fences');
 // not triggered mid-line or in a URL
 await page.keyboard.press('Control+z');await page.keyboard.press('Control+z');await put(page,(await doc(page)).length);
 await page.keyboard.type(' see https://example.test/a/b');await page.waitForTimeout(300);R.noMenuMidLine=(await menu().count())===0;assert(R.noMenuMidLine,'menu opened mid-line');
 // back to the original bytes
 for(let k=0;k<12&&(await doc(page))!==d;k++){await page.keyboard.press('Control+z');}
 assert.equal(await doc(page),d,'could not undo back to the original');assert.deepEqual(await disk(page,root),bytes,'slash menu session changed bytes');

 // Fast typing: "/code" then Enter with no pause must insert the block, never a stray newline, and never drop the Enter.
 R.fastEnter=[];
 for(let k=0;k<25;k++){
  await put(page,(await doc(page)).length);await page.keyboard.type('\n/code');await page.keyboard.press('Enter');await settle(page);
  const got=await doc(page);R.fastEnter.push(got===d+'\n```\n\n```');
  await page.evaluate(([t])=>{const v=window.__aitiarch['n.md'].view;v.dispatch({changes:{from:0,to:v.state.doc.length,insert:t}});},[d]);await page.keyboard.press('Escape');
 }
 assert(R.fastEnter.every(Boolean),`fast Enter failed in ${R.fastEnter.filter(x=>!x).length} of 25`);
 for(let k=0;k<10;k++){await put(page,(await doc(page)).length);await page.keyboard.type('\n/todo');await page.keyboard.press('Tab');await settle(page);assert.equal(await doc(page),d+'\n- [ ] ','Tab did not accept');await page.evaluate(([t])=>{const v=window.__aitiarch['n.md'].view;v.dispatch({changes:{from:0,to:v.state.doc.length,insert:t}});},[d]);await page.keyboard.press('Escape');}
 await page.keyboard.press('Escape');assert.equal(await doc(page),d);assert.deepEqual(await disk(page,root),bytes,'fast slash typing changed bytes');
});
// No-match/path queries and Escape must never turn Enter into an implicit block command.
await session('slash-fallback',slashNote,async({page,theme,root,bytes})=>{
 const R={};report[`slash-fallback-${theme}`]=R;const d=await doc(page);
 for(const [label,query,escape] of [['no-match','/zzzzzz',false],['path','/usr/bin',false],['after-Escape','/code',true]]){
  await put(page,d.length);await page.keyboard.type(query);
  if(escape){await page.locator('.cm-tooltip-autocomplete').waitFor();await page.keyboard.press('Escape');}
  await page.keyboard.press('Enter');await settle(page);
  assert.equal(await doc(page),d+query+'\n',`${label}: Enter must insert only a newline`);
  assert.equal(await page.locator('.cm-tooltip-autocomplete').count(),0,`${label}: menu stayed open`);
  R[label]=true;
  for(let n=0;n<6&&(await doc(page))!==d;n++)await page.keyboard.press('Control+z');
  assert.equal(await doc(page),d);assert.deepEqual(await disk(page,root),bytes);
 }
});
await session('toolbar-b',small,async({page,theme,root,bytes})=>{
 const d=await doc(page),from=d.indexOf('Intro'),to=from+15;
 await put(page,from,to);const toolbar=page.getByRole('toolbar',{name:'Format selection'});await toolbar.waitFor();
 assert.equal(await toolbar.locator('.cm-sel-row').count(),1,'variant A must be one row');
 for(const title of ['Bold (Ctrl+B)','Italic (Ctrl+I)','Strikethrough (Ctrl+Shift+X)','Inline code','Link','Text style'])assert.equal(await toolbar.locator(`[title="${title}"]`).count(),1);
 await toolbar.getByTitle('Bold (Ctrl+B)',{exact:true}).click();assert.equal(await doc(page),d.slice(0,from)+'**'+d.slice(from,to)+'**'+d.slice(to));
 await page.keyboard.press('Control+z');assert.equal(await doc(page),d);assert.deepEqual(await disk(page,root),bytes);
 await put(page,from,to);await page.keyboard.press('Alt+F10');assert.equal(await page.evaluate(()=>document.activeElement?.closest('.cm-sel-toolbar')!==null),true,'keyboard cannot enter toolbar');
 await page.keyboard.press('ArrowRight');assert.equal(await page.evaluate(()=>document.activeElement?.textContent),'Ask...');
 await page.keyboard.press('Escape');assert.equal(await page.evaluate(`${V}.hasFocus`),true);
 await toolbar.getByTitle('Link',{exact:true}).click();assert.equal(await doc(page),d.slice(0,from)+'['+d.slice(from,to)+']()'+d.slice(to));await page.keyboard.press('Control+z');assert.deepEqual(await disk(page,root),bytes);
 await put(page,from,to);await toolbar.getByRole('button',{name:'Ask...',exact:true}).click();
 const frozen=await page.locator('.invocation-review blockquote').textContent();
 await page.evaluate(()=>{const v=window.__aitiarch['n.md'].view;v.dispatch({changes:{from:0,insert:'User edit.\n'}});});
 assert.equal(await page.locator('.invocation-review blockquote').textContent(),frozen,'frozen selection changed');assert.equal(frozen,d.slice(from,to));
 await page.getByRole('button',{name:'Cancel preview'}).click();await page.evaluate(()=>window.__aitiarch['n.md'].view.focus());await page.keyboard.press('Control+z');assert.deepEqual(await disk(page,root),bytes);
 await put(page,from,to);await page.locator('.editor-col').screenshot({path:path.join(output,`gate-toolbar-b-${theme}.png`)});
 await put(page,from);assert.equal(await toolbar.count(),0,'empty selection toolbar shown');
 report[`toolbar-b-${theme}`]={oneRow:true,keyboard:true,frozenSelection:true,byteExact:true};
});
await session('callouts','\uFEFFAway\r\n\r\n> [!note] Launch constraint\r\n> Keep it small.\r\n\r\n> [!tip] Test early\r\n> Use fixtures.\r\n\r\n> [!warning] No private data\r\n> Stay local.\r\n\r\nEnd\r\n',async({page,theme,root,bytes})=>{
 const d=await doc(page);await put(page,0);
 const geometry=async p=>page.evaluate(p=>{const v=window.__aitiarch['n.md'].view,r=v.coordsAtPos(p);return [r.left,r.top,v.contentHeight];},p);
 for(const word of ['Launch','Test early','No private']){
  const pos=d.indexOf(word);await put(page,0);const before=await geometry(pos);await put(page,pos);assert.deepEqual(await geometry(pos),before,'callout shifts at caret');
 }
 const start=d.indexOf('> [!note]'),end=d.indexOf('Keep it small.')+14;
 await put(page,start,end);const copied=await page.evaluate(()=>{const v=window.__aitiarch['n.md'].view,dt=new DataTransfer();v.contentDOM.dispatchEvent(new ClipboardEvent('copy',{clipboardData:dt,bubbles:true,cancelable:true}));return dt.getData('text/plain');});assert.equal(copied,d.slice(start,end));
 await put(page,start);const cdp=await page.context().newCDPSession(page);await cdp.send('Input.imeSetComposition',{text:'\u3042',selectionStart:1,selectionEnd:1});await cdp.send('Input.insertText',{text:'\u3042'});await page.keyboard.press('Control+z');assert.equal(await doc(page),d);await page.keyboard.press('Control+y');assert.notEqual(await doc(page),d);await page.keyboard.press('Control+z');assert.deepEqual(await disk(page,root),bytes);
 await put(page,0);await page.locator('.editor-col').screenshot({path:path.join(output,`gate-callouts-${theme}.png`)});
 await page.setViewportSize({width:700,height:1000});await settle(page);await page.locator('.editor-col').screenshot({path:path.join(output,`gate-callouts-narrow-${theme}.png`)});
 report[`callouts-${theme}`]={noShift:true,byteExact:true,copyMarkdown:true,imeUndoRedo:true};
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
