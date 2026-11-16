// Real-browser check: the Pipeline Studio canvas (slice 4a). Synthetic temp notes, a temp settings folder, fake adapters and a fake provider; no live provider is called.
// Needs BATCH2A_OUTPUT (a folder outside the repo) for screenshots. Run from the ui folder after a build.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright-core';
import {Store} from '../server/store.ts';
import {NoteWatcher} from '../server/watch.ts';
import {createApp} from '../server/http.ts';
import {ProviderError} from '../server/providers/index.ts';
import {SessionIndex} from '../server/harness/session-index.ts';
import {locked} from '../shared/pipeline-config.ts';
import {PIPELINE_NODES,edgesOf,nodeById} from '../shared/pipeline-nodes.ts';
const output=path.resolve(process.env.BATCH2A_OUTPUT??'');assert(process.env.BATCH2A_OUTPUT&&!output.toLowerCase().startsWith(path.resolve('..').toLowerCase()),'BATCH2A_OUTPUT must be a folder outside the repo');await mkdir(output,{recursive:true});
const base=await mkdtemp(path.join(os.tmpdir(),'aitiarch-pipeline-studio-')),notes=path.join(base,'notes'),settings=path.join(base,'settings'),configFile=path.join(settings,'pipeline-config.json');await mkdir(notes);
await writeFile(path.join(notes,'plan.md'),'# Synthetic plan\n\nLaunch in June.\n');
const index=await SessionIndex.open(path.join(base,'harness'));
const adapters=['codex','kiro','claude'].map(id=>({id,label:id==='codex'?'Codex':id==='kiro'?'Kiro':'Claude',safetyLabel:id==='codex'?'contained':id==='kiro'?'host-gated':'fenced',async *startTurn(){throw new Error('A live provider call is forbidden in this check.');}}));
const provider={name:'claude',async checkAvailability(){return {available:true};},async invoke(){throw new ProviderError('timeout');}};
const store=await Store.open(notes),watcher=new NoteWatcher(store);await watcher.start();
const app=createApp({store,watcher,distDir:path.resolve('dist'),provider,pipelineConfigDir:settings,council:{index,adapters,availabilityChecks:adapters.map(a=>({...a,check:async()=>({available:true,reason:null})}))},harness:{command:process.execPath,prefixArgs:[path.resolve('test/fixtures/harness-cli.mjs')],dir:index.dir}});
const saved=async()=>JSON.parse(await readFile(configFile,'utf8')).overrides;
let browser;
try{
 const url='http://127.0.0.1:'+await app.listen(0);browser=await chromium.launch({channel:'msedge',headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:900}});page.setDefaultTimeout(12000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const boot=async()=>{await page.goto(url+'/?debug=1');await page.waitForSelector('.cm-editor');};
 const studio=page.locator('section.studio[role=dialog]'),node=id=>studio.locator(`.studio-node[data-node="${id}"]`);
 const openStudio=async()=>{await page.getByRole('button',{name:'Pipeline Studio',exact:true}).click();await studio.waitFor();await node('ledger').waitFor();};
 const card=title=>studio.getByRole('region',{name:`Details: ${title}`});
 await boot();await openStudio();
 // 1. Every node comes from the data module, and the ids line up with the config's locked rules.
 const shown=await studio.locator('.studio-node').evaluateAll(els=>els.map(e=>e.getAttribute('data-node')));
 assert.deepEqual([...shown].sort(),PIPELINE_NODES.map(n=>n.id).sort(),'the canvas shows exactly the nodes of the data module');
 for(const rule of locked)assert(shown.includes(rule.id),`the locked rule ${rule.id} is a node`);
 assert((await studio.locator('.studio-edges path').count())>=30,'edges show the flow');
 await page.screenshot({path:path.join(output,'studio-canvas.png')});
 // 1b. Polish: groups read as groups, editable and locked differ at a glance, the Council is stitched from three labelled limbs, the main path stands out, the Ledger trunk is faint.
 assert.deepEqual(await studio.locator('.studio-region-label').allInnerTexts(),['YOUR REQUEST','GUARDS','ANSWER','CHECKS ON THE REPLY','INVESTIGATE','COUNCIL','RECORDS'].map(s=>s),'one labelled lane per group, in order');
 for(const n of PIPELINE_NODES){const kind=node(n.id).locator('.studio-kind');assert.equal((await kind.innerText()).trim(),n.kind==='editable'?'Editable':'Locked',`${n.id} says what it is in words`);
  assert.equal(await node(n.id).locator('.studio-dot').count(),n.kind==='editable'?1:0,`${n.id}: the editable mark is only on editable nodes`);
  assert.equal(await node(n.id).evaluate(e=>getComputedStyle(e).borderTopStyle),n.kind==='locked'?'dashed':'solid',`${n.id}: locked is dashed, editable is solid`);}
 for(const [id,label] of [['council-claude','fenced'],['council-codex','contained'],['council-kiro','host-gated']])assert.equal((await node(id).locator('.council-badge').innerText()).trim(),label,`${id} carries its safety badge`);
 assert.equal(await studio.locator('g[data-stitch]').count(),3,'three stitched joins into the Council');assert.deepEqual(await studio.locator('g[data-stitch]').evaluateAll(g=>g.map(e=>e.getAttribute('data-limb')).sort()),['council-claude','council-codex','council-kiro']);
 assert.equal(await studio.locator('.studio-node[data-main]').count(),7,'the seven nodes of the main path are set apart');
 assert.equal(await studio.locator('.studio-edges path[data-trunk]').count(),edgesOf().filter(e=>e.to==='ledger').length,'every edge into the Ledger is part of the trunk');
 assert(await studio.locator('.studio-edges path[data-trunk]').first().evaluate(e=>parseFloat(getComputedStyle(e).strokeWidth))<=2.2,'edges are thin and calm until you point at a node');
 assert.equal(await studio.locator('.studio-edges path[data-edge]:not([data-active]):not([data-dim])').count(),await studio.locator('.studio-edges path[data-edge]').count(),'nothing is lit or dimmed before you hover');
 // 1a. Layout: spread out, readable at the default fit, edges clear of unrelated nodes, and dashed means locked only.
 const measure=async()=>page.evaluate(({nodes,margin})=>{
  const k=document.querySelector('.studio-node').getBoundingClientRect().width/document.querySelector('.studio-node').offsetWidth;
  const titles=[...document.querySelectorAll('.studio-node-title')].map(e=>parseFloat(getComputedStyle(e).fontSize)*k),meta=[...document.querySelectorAll('.studio-kind')].map(e=>parseFloat(getComputedStyle(e).fontSize)*k);
  const rects=Object.fromEntries([...document.querySelectorAll('.studio-node')].map(e=>[e.dataset.node,e.getBoundingClientRect()])),lanes=[...document.querySelectorAll('.studio-region')].map(e=>({g:e.dataset.group,r:e.getBoundingClientRect()}));
  const gap=(a,b)=>Math.max(a.left-b.right,b.left-a.right,a.top-b.bottom,b.top-a.bottom);
  const problems=[],ids=Object.keys(rects);
  for(const a of ids)for(const b of ids)if(a<b&&gap(rects[a],rects[b])<20*k)problems.push(`nodes ${a} / ${b} are too close`);
  for(const x of lanes)for(const y of lanes)if(x.g<y.g&&gap(x.r,y.r)<36*k)problems.push(`lanes ${x.g} / ${y.g} touch`);
  for(const n of nodes){const r=rects[n.id],own=lanes.find(l=>l.g===n.group).r;
   if(r.left-own.left<14*k||own.right-r.right<14*k||r.top-own.top<14*k||own.bottom-r.bottom<14*k)problems.push(`${n.id} sits against its lane border`);
   for(const l of lanes)if(l.g!==n.group&&gap(r,l.r)<20*k)problems.push(`${n.id} is next to the ${l.g} lane`);
   if(Math.abs(r.height/k-n.h)>1.5)problems.push(`${n.id} grew past its box (${Math.round(r.height/k)})`);}
  // Every drawn edge, sampled along its length, stays out of the nodes it is not part of.
  const world=Object.fromEntries(nodes.map(n=>[n.id,{x:n.x,y:n.y}]));
  for(const p of document.querySelectorAll('.studio-edges path[data-edge]')){const [from,to]=p.dataset.edge.split('>'),len=p.getTotalLength();
   for(let t=0;t<=len;t+=4){const q=p.getPointAtLength(t);for(const n of nodes){if(n.id===from||n.id===to)continue;const w=world[n.id];if(q.x>w.x-4&&q.x<w.x+184+4&&q.y>w.y-4&&q.y<w.y+n.h+4){problems.push(`edge ${p.dataset.edge} runs through ${n.id}`);break;}}}}
  return {k,minTitle:Math.min(...titles),minMeta:Math.min(...meta),problems:[...new Set(problems)]};
 },{nodes:PIPELINE_NODES.map(n=>({id:n.id,group:n.group,x:n.x,y:n.y,h:n.id==='ledger'?136:88})),margin:0});
 const m1440=await measure();assert.deepEqual(m1440.problems,[],'the 1440 layout is spread out and clear: '+JSON.stringify(m1440.problems));
 assert(m1440.minTitle>=12,`node text is at least 12px at the default fit at 1440 (smallest title ${m1440.minTitle.toFixed(1)}px, tags ${m1440.minMeta.toFixed(1)}px, zoom ${m1440.k.toFixed(2)})`);
 await page.screenshot({path:path.join(output,'layout-1440.png')});
 await page.setViewportSize({width:1920,height:1080});await studio.getByRole('button',{name:'Reset layout'}).click();await page.waitForTimeout(250);
 const m1920=await measure();assert.deepEqual(m1920.problems,[],'the 1920 layout is spread out and clear: '+JSON.stringify(m1920.problems));assert(m1920.minTitle>=12,`node text is at least 12px at 1920 (${m1920.minTitle.toFixed(1)}px)`);
 await page.screenshot({path:path.join(output,'layout-1920.png')});
 await page.setViewportSize({width:1440,height:900});await studio.getByRole('button',{name:'Reset layout'}).click();await page.waitForTimeout(250);
 for(const id of ['council-claude','council-codex','council-kiro']){const s=await node(id).evaluate(e=>{const c=getComputedStyle(e);return {outline:c.outlineStyle,border:c.borderTopStyle};});assert.deepEqual(s,{outline:'none',border:'solid'},`${id} has no dashed treatment: dashed always means locked`);}
 for(const e of await studio.locator('.studio-edges path[data-edge]').evaluateAll(ps=>ps.map(p=>p.getAttribute('d'))))assert(!/C/.test(e.replace(/[QA]/g,'')),'no free curves: only straight runs, rounded elbows and hops');
 assert.equal(await studio.locator('.studio-edges path[data-edge][marker-end]').count(),await studio.locator('.studio-edges path[data-edge]').count(),'every edge ends in an arrowhead');
 // 1c. Hovering a node lights its edges upstream and downstream, and quiets the nodes that are not on its path.
 await node('permission_gate').hover();
 const gateLit=await studio.locator('.studio-edges path[data-active]').evaluateAll(p=>p.map(e=>e.getAttribute('data-edge')));
 for(const e of ['redaction>permission_gate','permission_gate>request-queue','token-budget>normal-answerer','request-intake>redaction','claim-check>chat-store'])assert(gateLit.includes(e),`hovering the gate lights ${e}: ${gateLit}`);
 await page.waitForTimeout(300); // the dimming eases in over 140 ms
 assert(await studio.locator('.studio-edges path[data-active]').first().evaluate(e=>parseFloat(getComputedStyle(e).strokeWidth))>=3,'the lit path is bold');
 assert(await studio.locator('.studio-edges path[data-dim]').first().evaluate(e=>+getComputedStyle(e).strokeOpacity)<.3,'the edges off the path step back');
 assert.equal(await node('exclusion_lists').getAttribute('data-dim'),'true','a node off the path is quieted');assert.equal(await node('redaction').getAttribute('data-dim'),null,'a node on the path is not');
 await page.screenshot({path:path.join(output,'studio-polish-hover-gate.png')});
 await node('ledger').hover();const ledgerLit=await studio.locator('.studio-edges path[data-trunk][data-active]').count();assert.equal(ledgerLit,await studio.locator('.studio-edges path[data-trunk]').count(),'hovering the Ledger brightens its whole trunk');
 await page.screenshot({path:path.join(output,'studio-polish-hover-ledger.png')});
 await node('council').hover();assert.equal(await studio.locator('g[data-stitch][data-active]').count(),3,'hovering the Council lights all three stitches');
 await studio.locator('.studio-region[data-group=council]').screenshot({path:path.join(output,'studio-polish-council.png')});
 await page.mouse.move(700,860);await page.waitForTimeout(150);assert.equal(await studio.locator('.studio-edges path[data-active]').count(),0,'with nothing hovered no edge is lit');
 await page.screenshot({path:path.join(output,'studio-polish-canvas.png')});
 // 2. Hover and keyboard focus show the detailed card, top to bottom.
 await node('normal-answerer').hover();const c=card('Normal chat answerer');await c.waitFor();
 const text=(await c.innerText()).toLowerCase(),order=['what it does','what it receives','what it sends on','safety label','editable fields'].map(s=>text.indexOf(s)).concat(text.lastIndexOf('editable here'));
 assert(order.every(i=>i>=0)&&order.every((v,i)=>i===0||v>order[i-1]),'the card reads top to bottom: '+JSON.stringify(order));
 assert.match(await c.locator('[data-card=safety]').innerText(),/Claude\s+fenced/);
 await page.screenshot({path:path.join(output,'studio-hover.png')});
 await node('permission_gate').focus();const gate=card('Permission gate');await gate.waitFor();
 assert.equal((await gate.locator('[data-card=lock]').innerText()).trim(),locked.find(l=>l.id==='permission_gate').description,'a locked node gives the config’s own reason');
 await node('council-codex').focus();assert.match(await card('Council: Codex').locator('[data-card=safety]').innerText(),/contained/);
 // 3. A locked node shows a padlock, the reason and no editable fields.
 await node('permission_gate').click();const ed=studio.getByRole('region',{name:'Edit Permission gate'});await ed.waitFor();
 assert.equal(await ed.locator('[data-locked=true]').count(),1);assert.equal(await ed.locator('.studio-lock').count(),1,'a padlock');assert.equal(await ed.locator('input,select,textarea').count(),0,'no editable fields');
 assert.equal(await ed.getByRole('button',{name:'Save'}).count(),0,'nothing to save');await page.screenshot({path:path.join(output,'studio-locked.png')});
 await ed.getByRole('button',{name:'Close editor'}).click();await ed.waitFor({state:'detached'});
 // 4. Dragging moves a node and the place is remembered; Reset layout puts everything back.
 const dflt=nodeById('token-budget'),b=await node('token-budget').boundingBox();
 await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2+60,b.y+b.height/2+40,{steps:8});await page.mouse.up();
 const moved=JSON.parse(await page.evaluate(()=>localStorage.getItem('aitiarch.pipeline.layout')));assert(moved['token-budget']&&Math.abs(moved['token-budget'].x-(dflt.x+60/(b.width/184)))<=3&&Math.abs(moved['token-budget'].y-(dflt.y+40/(b.width/184)))<=3,'the new place is stored: '+JSON.stringify(moved));
 assert.equal(await studio.locator('[data-editor]').count(),0,'a drag is not a click');
 await boot();await openStudio();assert.equal(await node('token-budget').evaluate(e=>e.style.left),moved['token-budget'].x+'px','the place survives a reload');
 await studio.getByRole('button',{name:'Reset layout'}).click();assert.equal(await node('token-budget').evaluate(e=>e.style.left),dflt.x+'px');assert.equal(await page.evaluate(()=>localStorage.getItem('aitiarch.pipeline.layout')),null,'the stored layout is cleared');
 await studio.getByRole('button',{name:'Zoom in'}).click();await studio.getByRole('button',{name:'Zoom out'}).click();
 // 5. A blocked reply links to the node that blocked it.
 await studio.getByRole('button',{name:'Close Pipeline Studio'}).click();await studio.waitFor({state:'detached'});
 await page.getByRole('button',{name:/^Chat/}).first().click();const panel=page.locator('#chat-panel');await panel.waitFor();
 await panel.getByRole('textbox',{name:'Message Aitiarch AI'}).fill('When is launch?');await panel.getByRole('textbox',{name:'Message Aitiarch AI'}).press('Enter');
 const review=panel.getByRole('region',{name:'What will be sent'});await review.waitFor();await review.getByRole('button',{name:'Send',exact:true}).click();
 const err=panel.locator('.chat-error');await err.waitFor();await err.locator('summary',{hasText:'Why?'}).click();
 const link=err.getByRole('button',{name:'Show on pipeline'});await link.waitFor();const target=await link.getAttribute('data-why-link');assert(nodeById(target),'the link names a real node: '+target);
 await link.click();await studio.waitFor();const lit=studio.locator('.studio-node[data-highlight]');await lit.waitFor();assert.equal(await lit.count(),1);assert.equal(await lit.getAttribute('data-node'),target,'the blocked step is highlighted');
 assert.match(await studio.locator('[data-banner=show-on-pipeline]').innerText(),new RegExp(nodeById(target).label));await page.screenshot({path:path.join(output,'studio-show-on-pipeline.png')});
 await page.keyboard.press('Escape');await studio.waitFor({state:'detached'});await page.getByRole('button',{name:'Close chat'}).click();
 // 6. The answerer saves through the server and is still there after a reload.
 await openStudio();await node('normal-answerer').click();const ans=studio.getByRole('region',{name:'Edit Normal chat answerer'});await ans.waitFor();
 assert.match(await ans.innerText(),/Available/);const pick=ans.getByLabel('Normal chat is answered by');assert.equal(await pick.inputValue(),'claude');
 await pick.selectOption('codex');await ans.getByRole('button',{name:'Save'}).click();await ans.getByText('Saved.').waitFor();assert.deepEqual(await saved(),{normalAnswerer:'codex'});await page.screenshot({path:path.join(output,'studio-editor.png')});
 await boot();await openStudio();await node('normal-answerer').click();assert.equal(await studio.getByLabel('Normal chat is answered by').inputValue(),'codex','the answerer is still Codex after a reload');
 // 7. A numeric limit edits per node, keeps the other saved settings, and resets only its own node.
 await node('token-budget').click();const tb=studio.getByRole('region',{name:'Edit Token budget'});await tb.waitFor();
 await tb.locator('[data-field="chat.rollingRequestCap"]').fill('7');await tb.getByRole('button',{name:'Save'}).click();await tb.getByText('Saved.').waitFor();assert.deepEqual(await saved(),{normalAnswerer:'codex',chat:{rollingRequestCap:7}});
 // 8. A value the server refuses shows the server's own sentence and changes nothing.
 await tb.locator('[data-field="chat.tokenBudget"]').fill('99999999');await tb.getByRole('button',{name:'Save'}).click();const bad=tb.locator('[data-notice=studio-error]');await bad.waitFor();
 assert.equal((await bad.innerText()).trim(),'This value is out of range or not allowed.');assert.deepEqual(await saved(),{normalAnswerer:'codex',chat:{rollingRequestCap:7}},'a refused save changes nothing on disk');
 await tb.getByRole('button',{name:'Reset this node'}).click();await tb.getByText('This node is back to its defaults.').waitFor();assert.deepEqual(await saved(),{normalAnswerer:'codex'},'only this node was reset');
 await page.keyboard.press('Escape');await page.keyboard.press('Escape');await studio.waitFor({state:'detached'});
 // 9. Settings keeps its plain form, with a link to the Studio.
 await page.getByRole('button',{name:'Notes menu',exact:true}).click();await page.getByRole('button',{name:'AI settings'}).click();const dialog=page.getByRole('dialog',{name:'AI settings'});await dialog.getByRole('tab',{name:'Pipeline'}).click();
 assert.equal(await dialog.getByLabel('Normal chat is answered by').inputValue(),'codex','the plain form still works');await dialog.getByRole('button',{name:'Open Pipeline Studio'}).click();await studio.waitFor();assert.equal(await dialog.count(),0,'Settings closed');
 // 10. At phone width the canvas gives way to a readable list of the same nodes.
 await page.setViewportSize({width:360,height:740});await studio.locator('[data-list=true]').waitFor();
 assert.equal(await studio.locator('.studio-row').count(),PIPELINE_NODES.length,'every node is in the list');assert.equal(await studio.locator('.studio-node').count(),0);
 assert.equal(await studio.evaluate(e=>e.scrollWidth<=e.clientWidth+1),true,'no sideways scroll at 360px');
 const row=studio.locator('[data-node="council-codex"] .studio-row');await row.scrollIntoViewIfNeeded();await row.click();const open=studio.locator('[data-node="council-codex"]');await open.getByRole('region',{name:'Details: Council: Codex'}).waitFor();assert.equal(await open.locator('input[data-field="council.caps.codex.amount"]').count(),1);
 assert.equal(await studio.evaluate(e=>e.scrollWidth<=e.clientWidth+1),true,'an opened row still fits at 360px');await page.screenshot({path:path.join(output,'studio-list-360.png')});
 assert.deepEqual(errors,[]);console.log(JSON.stringify({pass:true,nodes:shown.length,screenshots:output}));
}finally{await browser?.close();await app.close();watcher.stop();console.log('Cleanup target:',base);await rm(base,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
