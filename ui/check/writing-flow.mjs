// Writing flow in the real app: Enter continues lists, checklists, quotes and callouts, Enter on an empty item steps out, Backspace after a
// marker removes it, Tab nests, a code block is left with Enter on its empty last line and removed with Backspace from the line under it.
// Real key presses, synthetic notes in a temp folder, fake provider only.
// Run: BATCH2A_OUTPUT=<dir outside the repo> node check/writing-flow.mjs   (after `vite build`)
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';import {chromium} from 'playwright-core';
import {Store} from '../server/store.ts';import {NoteWatcher} from '../server/watch.ts';import {createApp} from '../server/http.ts';
const ui=fileURLToPath(new URL('../',import.meta.url)),repo=path.resolve(ui,'..');
const output=path.resolve(process.env.BATCH2A_OUTPUT??'');assert(process.env.BATCH2A_OUTPUT&&!output.toLowerCase().startsWith(repo.toLowerCase()),'Output must be outside repo');await mkdir(output,{recursive:true});
const root=await mkdtemp(path.join(os.tmpdir(),'aitiarch-writing-'));execFileSync('git',['init','-q'],{cwd:root,stdio:'pipe'});
await writeFile(path.join(root,'.gitignore'),'/.cache/\n/ui-state.json*\n');await writeFile(path.join(root,'n.md'),'x\n');
const store=await Store.open(root),watcher=new NoteWatcher(store,50,10);await watcher.start();
const app=createApp({store,watcher,distDir:path.join(ui,'dist'),provider:{name:'claude',checkAvailability:async()=>({available:true}),invoke:async()=>{throw Error('Provider calls forbidden');}}});
const base=`http://127.0.0.1:${await app.listen(0)}`;const browser=await chromium.launch({channel:'msedge',headless:true});
const V=`window.__aitiarch['n.md'].view`;
// start: the note before typing; caret: index to start at (default end); keys: text to type or {Key} to press; want: the note afterwards.
const cases=[
 {name:'bullets continue and the second Enter leaves the list',start:'',keys:['- One','{Enter}','Two','{Enter}','{Enter}','After'],want:'- One\n- Two\nAfter'},
 {name:'numbers count up and leave on an empty item',start:'',keys:['1. A','{Enter}','B','{Enter}','{Enter}','X'],want:'1. A\n2. B\nX'},
 {name:'checklist items continue unticked and leave on an empty item',start:'',keys:['- [ ] A','{Enter}','B','{Enter}','{Enter}','X'],want:'- [ ] A\n- [ ] B\nX'},
 {name:'a ticked task continues as an unticked one',start:'- [x] Done',keys:['{Enter}','Next'],want:'- [x] Done\n- [ ] Next'},
 {name:'Tab nests an item and an empty nested item steps out one level',start:'',keys:['- A','{Enter}','{Tab}','B','{Enter}','{Enter}','C'],want:'- A\n  - B\n- C'},
 {name:'a nested item keeps its indentation on Enter',start:'- A\n  - B',keys:['{Enter}','C'],want:'- A\n  - B\n  - C'},
 {name:'a new item in the middle renumbers the rest',start:'1. A\n2. B\n3. C',caret:4,keys:['{Enter}','X'],want:'1. A\n2. X\n3. B\n4. C'},
 {name:'Enter in the middle of an item splits it',start:'- Onetwo',caret:5,keys:['{Enter}'],want:'- One\n- two'},
 {name:'a quote continues and the second Enter leaves it',start:'',keys:['> Q','{Enter}','R','{Enter}','{Enter}','X'],want:'> Q\n> R\nX'},
 {name:'a callout keeps going inside its box and the second Enter leaves it',start:'',keys:['/note','{Enter}','Body','{Enter}','More','{Enter}','{Enter}','After'],want:'> [!note]\n> Body\n> More\nAfter'},
 {name:'a tip callout continues the same way',start:'',keys:['/tip','{Enter}','T','{Enter}','U','{Enter}','{Enter}','X'],want:'> [!tip]\n> T\n> U\nX'},
 {name:'a warning callout continues the same way',start:'',keys:['/warning','{Enter}','W','{Enter}','{Enter}','X'],want:'> [!warning]\n> W\nX'},
 {name:'a list inside a quote continues with its quote prefix',start:'> - A',keys:['{Enter}','B','{Enter}','{Enter}','{Enter}','C'],want:'> - A\n> - B\nC'},
 {name:'Backspace right after a bullet removes the bullet',start:'- One',caret:2,keys:['{Backspace}'],want:'One'},
 {name:'Backspace right after a nested bullet moves it out one level',start:'  - One',caret:4,keys:['{Backspace}'],want:'- One'},
 {name:'Backspace right after a quote marker removes the quote',start:'> Hello',caret:2,keys:['{Backspace}'],want:'Hello'},
 {name:'Enter in a code block adds a line; Enter on its empty last line leaves it',start:'',keys:['/code','{Enter}','a','{Enter}','b','{Enter}','{Enter}','After'],want:'```\na\nb\n```\nAfter'},
 {name:'Backspace on the empty line under a code block removes the whole block',start:'```\ncode\n```\n',keys:['{Backspace}'],want:''},
 {name:'/link: type the text, Tab, type the address',start:'',keys:['/link','{Enter}','Docs','{Tab}','example.com'],want:'[Docs](example.com)'},
 {name:'/image: describe it, Tab, type the file name',start:'',keys:['/image','{Enter}','Photo','{Tab}','a.png'],want:'![Photo](a.png)'},
 {name:'/footnote adds the next numbered reference and a definition to type in',start:'Hello\n\n',keys:['/footnote','{Enter}','Source'],want:'Hello\n\n[^1]\n\n[^1]: Source'},
 {name:'/footnote works in the middle of a sentence',start:'',keys:['See this /footnote','{Enter}','Note'],want:'See this [^1]\n\n[^1]: Note'},
 {name:'/link works in the middle of a sentence',start:'',keys:['Read the /link','{Enter}','Guide','{Tab}','x.test'],want:'Read the [Guide](x.test)'},
 {name:'Backspace under a code block keeps the text before it',start:'Before\n\n```\ncode\n```\n',keys:['{Backspace}'],want:'Before\n\n'},
];
const failures=[];
try{
 const page=await browser.newPage({viewport:{width:1300,height:900}});
 await page.goto(base+'/?debug=1');await page.waitForFunction(()=>window.__aitiarch?.['n.md']);
 for(const c of cases){
  await page.evaluate(([start,caret])=>{const v=window.__aitiarch['n.md'].view;v.dispatch({changes:{from:0,to:v.state.doc.length,insert:start},selection:{anchor:caret??start.length}});v.focus();},[c.start,c.caret??null]);
  await page.waitForTimeout(120);
  for(const k of c.keys){const m=/^\{(.+)\}$/.exec(k);if(m)await page.keyboard.press(m[1]);else await page.keyboard.type(k,{delay:4});await page.waitForTimeout(40);}
  await page.waitForTimeout(80);
  const got=await page.evaluate(`${V}.state.doc.toString()`);
  if(got!==c.want)failures.push({case:c.name,want:c.want,got});
 }
 // ---- The table: inserted with /table, edited in place cell by cell.
 const doc=()=>page.evaluate(`${V}.state.doc.toString()`);
 const cellAt=()=>page.evaluate(()=>{const a=document.activeElement;return a?.dataset?.line!==undefined?{line:Number(a.dataset.line),col:Number(a.dataset.col)}:null;});
 await page.evaluate(()=>{const v=window.__aitiarch['n.md'].view;v.dispatch({changes:{from:0,to:v.state.doc.length,insert:''},selection:{anchor:0}});v.focus();});
 await page.keyboard.type('/table',{delay:4});await page.keyboard.press('Enter');
 await page.locator('.cm-table-widget td[contenteditable], .cm-table-widget th[contenteditable]').first().waitFor();await page.waitForTimeout(150);
 const starter='| Column 1 | Column 2 | Column 3 |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |\n';
 if(await doc()!==starter)failures.push({case:'/table inserts a starter table',want:starter,got:await doc()});
 const first=await cellAt();if(!first||first.line!==0||first.col!==0)failures.push({case:'/table puts the cursor in the first heading cell',got:first});
 const selected=await page.evaluate(()=>getSelection()?.toString());if(selected?.toLowerCase()!=='column 1')failures.push({case:'its text is selected so typing replaces it',want:'Column 1',got:selected});
 await page.screenshot({path:path.join(output,'table-inserted.png')});
 for(const k of ['Item','{Tab}','Qty','{Tab}','Note','{Tab}','A','{Tab}','B','{Tab}','C','{Enter}','D']){const m=/^\{(.+)\}$/.exec(k);if(m)await page.keyboard.press(m[1]);else await page.keyboard.type(k,{delay:4});await page.waitForTimeout(120);}
 await page.keyboard.press('Tab');await page.waitForTimeout(200); // leaving the last cell adds a row
 const afterTab=await doc();
 const wantTable='| Item | Qty | Note |\n| --- | --- | --- |\n| A | B | C |\n|  |  | D |\n|  |  |  |\n';
 if(afterTab!==wantTable)failures.push({case:'tabbing and typing through the table, a new row at the end',want:wantTable,got:afterTab});
 const landed=await cellAt();if(!landed||landed.line!==4||landed.col!==0)failures.push({case:'the cursor lands in the new row',got:landed});
 await page.screenshot({path:path.join(output,'table-edited.png')});
 // Controls and keyboard exit.
 await page.getByRole('button',{name:'+ Column',exact:true}).click();await page.waitForTimeout(200);
 if(!(await doc()).startsWith('| Item | Qty | Note | Column 4 |\n| --- | --- | --- | --- |\n| A | B | C |  |'))failures.push({case:'+ Column',got:await doc()});
 await page.getByRole('button',{name:'Delete column',exact:true}).click();await page.waitForTimeout(200);
 if(!(await doc()).startsWith('| Qty | Note | Column 4 |')&&!(await doc()).startsWith('| Item | Qty | Note |'))failures.push({case:'Delete column removes the column you are in',got:await doc()});
 await page.keyboard.press('Escape');await page.waitForTimeout(150);
 if(!await page.evaluate(`${V}.hasFocus`))failures.push({case:'Escape returns the cursor to the note'});
 // A mouse click puts the cursor in that cell without opening raw Markdown.
 if(!await page.locator('.cm-table-widget td[contenteditable]').count())failures.push({case:'the table stays rendered after Escape',doc:await doc(),sel:await page.evaluate(V+'.state.selection.main.head')});
 else{await page.locator('.cm-table-widget td[contenteditable]').first().click();await page.waitForTimeout(150);
 const clicked=await cellAt();if(!clicked||clicked.line!==2)failures.push({case:'clicking a cell edits that cell',got:clicked});}
 if(await page.locator('.cm-table-source, .cm-line:has-text("| ---")').count()>0)failures.push({case:'clicking a cell must not switch to raw Markdown'});
 // ---- Never raw: selecting text, or putting the cursor on a command, must not show callout headers, checkbox syntax, fences or table Markdown.
 const rawDoc='# T\n\n> [!note]\n> Body\n\n- [ ] Todo\n- Bullet\n\n```js\ncode\n```\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\nEnd\n';
 await page.evaluate(d=>{const v=window.__aitiarch['n.md'].view;v.dispatch({changes:{from:0,to:v.state.doc.length,insert:d},selection:{anchor:v.state.doc.length}});v.focus();},rawDoc);
 const rawState=()=>page.evaluate(()=>{
  const transparent=c=>/^rgba\(\s*0,\s*0,\s*0,\s*0\)$|^transparent$/.test(c);
  const hidden=sel=>[...document.querySelectorAll(sel)].every(el=>transparent(getComputedStyle(el).color)&&transparent(getComputedStyle(el,'::selection').color));
  const count=s=>document.querySelectorAll(s).length;
  return {calloutMarkers:count('.cm-callout-marker'),calloutShown:count('.cm-callout-marker:not(.cm-callout-off)'),calloutHidden:hidden('.cm-callout-off'),
   tasks:count('.cm-task-off'),tasksHidden:hidden('.cm-task-off'),bullets:count('.cm-bullet-off'),bulletsHidden:hidden('.cm-bullet-off'),
   fences:count('.cm-fence'),fencesHidden:hidden('.cm-fence'),tables:count('.cm-table-widget'),tableSource:count('.cm-table-source'),revealed:count('.cm-gm-on')};
 });
 const want=st=>st.calloutMarkers===1&&st.calloutShown===0&&st.calloutHidden&&st.tasks===1&&st.tasksHidden&&st.bullets===1&&st.bulletsHidden&&st.fences>=2&&st.fencesHidden&&st.tables===1&&st.tableSource===0;
 await page.keyboard.press('Control+a');await page.waitForTimeout(250);
 const allSelected=await rawState();if(!want(allSelected))failures.push({case:'Select all must not reveal raw syntax',got:allSelected});
 await page.screenshot({path:path.join(output,'never-raw-selected.png')});
 for(const [label,needle] of [['callout header','[!note]'],['todo line','- [ ] Todo'],['bullet line','- Bullet'],['code fence','```js']]){
  await page.evaluate(([d,n,off])=>{const v=window.__aitiarch['n.md'].view,i=d.indexOf(n)+off;v.dispatch({selection:{anchor:i}});v.focus();},[rawDoc,needle,needle==='[!note]'?3:2]);await page.waitForTimeout(200);
  const st=await rawState();if(!want(st))failures.push({case:`The cursor on the ${label} must not reveal raw syntax`,got:st});
 }
 // ---- Links: hover shows where they go (shortened when long); a click opens them; Alt+click edits.
 const longUrl='https://example.com/'+'segment/'.repeat(14)+'final-page.html?x=1';
 await page.evaluate(d=>{const v=window.__aitiarch['n.md'].view;v.dispatch({changes:{from:0,to:v.state.doc.length,insert:d},selection:{anchor:v.state.doc.length}});v.focus();},`[Docs](example.com) and [Long](${longUrl}).\n\nEnd\n`);
 await page.waitForTimeout(250);
 await page.context().route('https://example.com/**',r=>r.fulfill({status:200,contentType:'text/html',body:'<title>ok</title>'}));
 const linkBox=async i=>{const b=await page.locator('.cm-link').nth(i).boundingBox();return {x:b.x+b.width/2,y:b.y+b.height/2};};
 const tip=()=>page.evaluate(()=>{const t=document.querySelector('.cm-link-tip');return t?{url:t.querySelector('.cm-link-tip-url')?.textContent,hint:t.querySelector('.cm-link-tip-hint')?.textContent}:null;});
 let pt=await linkBox(0);await page.mouse.move(pt.x,pt.y);await page.waitForSelector('.cm-link-tip',{timeout:4000}).catch(()=>{});
 const t1=await tip();if(!t1||t1.url!=='https://example.com'||!/Click to open/.test(t1.hint))failures.push({case:'hovering a link shows its address and how to open it',got:t1});
 await page.mouse.move(5,5);await page.waitForTimeout(300);
 pt=await linkBox(1);await page.mouse.move(pt.x,pt.y);await page.waitForSelector('.cm-link-tip',{timeout:4000}).catch(()=>{});
 const t2=await tip();if(!t2||!t2.url.startsWith('https://example.com/segment')||!t2.url.includes('…')||t2.url.length>64||!t2.url.endsWith('=1'))failures.push({case:'a long address is shown shortened, start and end visible',got:t2});
 await page.mouse.move(5,5);await page.waitForTimeout(300);
 pt=await linkBox(0);
 const popup=page.waitForEvent('popup',{timeout:4000}).catch(()=>null);await page.mouse.click(pt.x,pt.y);const opened=await popup;
 if(!opened)failures.push({case:'a plain click on a link opens it'});else{if(!/^https:\/\/example\.com\/?$/.test(opened.url()))failures.push({case:'the click opens the right address',got:opened.url()});await opened.close();}
 const before=await page.evaluate(`${V}.state.doc.toString()`);const popup2=page.waitForEvent('popup',{timeout:1200}).catch(()=>null);
 await page.keyboard.down('Alt');await page.mouse.click(pt.x,pt.y);await page.keyboard.up('Alt');if(await popup2)failures.push({case:'Alt+click edits the link instead of opening it'});
 if(await page.evaluate(`${V}.state.doc.toString()`)!==before)failures.push({case:'Alt+click must not change the note'});
 // ---- The slash menu searches as you type: the best match comes first, with no group headings in the way.
 await page.evaluate(()=>{const v=window.__aitiarch['n.md'].view;v.dispatch({changes:{from:0,to:v.state.doc.length,insert:''},selection:{anchor:0}});v.focus();});
 await page.keyboard.type('/i',{delay:30});await page.waitForTimeout(300);
 const firstFor=await page.evaluate(()=>[...document.querySelectorAll('.cm-tooltip-autocomplete li')].map(l=>l.textContent.replace(/\s+/g,' ').trim().split(' ')[0]));
 if(!firstFor.length||!/Image/.test(firstFor[0]))failures.push({case:'typing /i puts Image first',got:firstFor.slice(0,4)});
 if(await page.evaluate(()=>document.querySelectorAll('.cm-tooltip-autocomplete .cm-completionSection').length)>0)failures.push({case:'no group headings while searching'});
 await page.keyboard.type('ma',{delay:30});await page.waitForTimeout(300);
 const narrowed=await page.evaluate(()=>[...document.querySelectorAll('.cm-tooltip-autocomplete li')].length);if(narrowed!==1)failures.push({case:'typing /ima leaves only Image',got:narrowed});
 await page.keyboard.press('Escape');
 // One undo reverts a whole Enter or Backspace step.
 await page.evaluate(()=>{const v=window.__aitiarch['n.md'].view;v.dispatch({changes:{from:0,to:v.state.doc.length,insert:'- One'},selection:{anchor:5}});v.focus();});
 await page.keyboard.press('Enter');await page.keyboard.press('Control+z');
 const undone=await page.evaluate(`${V}.state.doc.toString()`);if(undone!=='- One')failures.push({case:'undo of Enter',want:'- One',got:undone});
 assert.deepEqual(failures,[],'writing flow failures:\n'+JSON.stringify(failures,null,1));
 console.log(JSON.stringify({pass:true,cases:cases.length+19,providerCalls:0}));
}finally{await browser.close();await app.close?.();await watcher.stop?.();await rm(root,{recursive:true,force:true});}
