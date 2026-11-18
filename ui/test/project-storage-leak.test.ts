import {execFileSync,spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {link,mkdir,mkdtemp,readFile,readdir,realpath,utimes,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {expect,it} from 'vitest';
import {AnchorCache,textHash} from '../server/anchor-cache.ts';
import {ChatStore} from '../server/chat/store.ts';
import {createApp} from '../server/http.ts';
import {initProject} from '../server/init.ts';
import {InkStore} from '../server/ink-store.ts';
import {InsertionStore} from '../server/insertion-store.ts';
import {LedgerStore} from '../server/ledger-store.ts';
import {privateTempPath} from '../server/private-write-temp.ts';
import {privateLeftovers} from '../server/private-leftovers.ts';
import {SkillDiagramStore} from '../server/skill-diagram-store.ts';
import {Store} from '../server/store.ts';
import {UiStateStore} from '../server/ui-state-store.ts';
import {NoteWatcher} from '../server/watch.ts';
import {ImageStore} from '../server/image-store.ts';
import {captureAnchor} from '../shared/anchors.ts';
import {skillPreviewUrl,SKILL_DIAGRAM_URL} from '../shared/skill-diagram.ts';

const note='Welcome.md';
const markers={
 draft:'draft-'+randomUUID(),ledger:'ledger-'+randomUUID(),cache:'cache-'+randomUUID(),
 chat:'chat-'+randomUUID(),journal:'journal-'+randomUUID(),diagram:'diagram-'+randomUUID(),
};
const imageFixture=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==','base64');
const html=(body:string)=>'<html><body>'+body+'</body></html>';
const assertNoImage=(bytes:Buffer,label:string)=>{
 expect(bytes.includes(imageFixture),label+' contains the staged image').toBe(false);
 expect(bytes.includes(imageFixture.toString('base64')),label+' contains the staged image as base64').toBe(false);
};
const assertPublic=(bytes:Buffer,label:string)=>{
 for(const marker of Object.values(markers))expect(bytes.includes(marker),label+' contains '+marker).toBe(false);
 assertNoImage(bytes,label);
};

async function fixture(managed:boolean){
 const scratch=await mkdtemp(path.join(await realpath(os.tmpdir()),'aitiarch-leak-'));
 const project=path.join(scratch,'project'),config=path.join(scratch,'config'),dist=path.join(scratch,'dist');
 await Promise.all([mkdir(project),mkdir(config),mkdir(dist)]);
 const git=(...args:string[])=>execFileSync('git',args,{cwd:project,windowsHide:true,maxBuffer:4*1024*1024});
 git('init','-q');
 const root=path.join(project,'.aitiarch');
 if(managed)await initProject({project,sharing:'shared',confirmIgnore:true});
 else{
  await mkdir(root);
  await writeFile(path.join(root,'.gitignore'),'/ui-state.json*\n/.cache/\n/chat/\n');
 }
 await writeFile(path.join(root,note),'# Public archive fixture\n\nA synthetic paragraph.\n');
 await writeFile(path.join(dist,'index.html'),'Synthetic UI');
 const store=await Store.open(root),ink=await InkStore.open(root),ledger=new LedgerStore(root);
 return {root,store,ink,ledger,git,config,dist};
}

async function writePrivate(f:Awaited<ReturnType<typeof fixture>>){
 const {root,store,ink,ledger}=f,at=new Date().toISOString();
 await new UiStateStore(root).saveDraft(note,'draft-fixture',markers.draft,null);
 await ledger.append({id:markers.ledger,inkId:'ink-fixture',requestId:'request-fixture',note,at,event:'shown'});
 expect(await new AnchorCache(root).save(note,markers.cache)).toBe(true);
 expect(await new ChatStore(root).append(note,{id:'chat-fixture',role:'assistant',body:markers.chat,at,provider:'claude',model:null,evidence:[],usage:null,insertionBlocked:false})).toBe('private');
 const existing=await store.read(note),insertions=new InsertionStore(ink,store,ledger);
 await insertions.prepareChat(existing,markers.journal,{noteVersion:existing.version,changes:{from:0,to:0,insert:'> [!ai] Prepared fixture\n'},authorship:'ai',insertedBy:'human'});
 const diagrams=new SkillDiagramStore(root),staged=await diagrams.saveHtml(html(markers.diagram));
 const files={
  'ui-state.json':markers.draft,'ledger.json':markers.ledger,
  ['.cache/anchors/'+textHash(note)+'.json']:markers.cache,
  ['chat/'+note+'.chat.json']:markers.chat,
 };
 return {files,staged,diagrams,insertions,existing};
}

it('recovers interrupted atomic writes before checking the shareable tree, handoff, ZIP and HTTP reads',async()=>{
 const f=await fixture(true),{root,git}=f,local=path.join(root,'local');
 const deadPid=spawnSync(process.execPath,['-e',''],{windowsHide:true}).pid;
 expect(deadPid).toBeGreaterThan(0);
 const interrupted=[
  ['ui-state.json',markers.draft],['ledger.json',markers.ledger],
  ['.cache/anchors/'+textHash(note)+'.json',markers.cache],
  ['chat/'+note+'.chat.json',markers.chat],['insertions.json',markers.journal],
 ];
 const abandoned:string[]=[];
 for(const [target,marker] of interrupted){
  const temp=privateTempPath(path.join(local,target),deadPid);
  await mkdir(path.dirname(temp),{recursive:true});
  await writeFile(temp,'{ "partial": "'+marker,{flag:'wx'});
  abandoned.push(temp);
 }
 const live=privateTempPath(path.join(local,'ui-state.json'),process.pid);
 const unknown=path.join(local,`ui-state.json.${randomUUID()}.tmp`);
 const human=privateTempPath(path.join(root,'ui-state.json'),deadPid);
 for(const target of [live,unknown,human])await writeFile(target,'Preserve these bytes.');
 const linked=privateTempPath(path.join(local,'ui-state.json'),deadPid);
 await link(human,linked);
 const {files,staged,diagrams,insertions,existing}=await writePrivate(f);
 const images=new ImageStore(root);
 const image=await images.stage(imageFixture);
 expect((await images.read(image.id)).bytes).toEqual(imageFixture);
 const imageCopy=await images.copyForTransport(imageFixture);
 const imageFiles=[`images/stage-${process.pid}-${image.id}.png`,'images/'+path.basename(imageCopy.file)];
 for(const imageFile of imageFiles)expect(await readFile(path.join(local,imageFile))).toEqual(imageFixture);
 for(const temp of abandoned)await expect(readFile(temp),temp).rejects.toMatchObject({code:'ENOENT'});
 for(const target of [live,unknown,human,linked])expect(await readFile(target,'utf8')).toBe('Preserve these bytes.');
 const ownerlessLocks=['ui-state.json.lock','chat/'+note+'.chat.json.lock'];
 for(const file of ownerlessLocks)await writeFile(path.join(local,file),'',{flag:'wx'});
 expect(await privateLeftovers(path.dirname(root))).toEqual([
  {directory:'local/',count:2},{directory:'local/chat',count:1},
 ]);
 expect(staged.stage).toMatch(/^[a-f0-9]{32}$/);
 const stagedName=staged.stage+'-'+staged.asset;
 const expected={...files,'insertions.json':markers.journal,['skill-diagrams/'+stagedName]:markers.diagram};
 for(const [relative,marker] of Object.entries(expected)){
  expect(await readFile(path.join(local,relative),'utf8'),relative).toContain(marker);
 }
 expect(await readFile(path.join(local,'.gitignore'),'utf8')).toBe('*\n');
 const watcher=new NoteWatcher(f.store),app=createApp({store:f.store,watcher,distDir:f.dist,pipelineConfigDir:f.config,skillRoots:[]});
 try{
  const base='http://127.0.0.1:'+await app.listen(0);
  const cookie=(await fetch(base+'/api/session')).headers.get('set-cookie')!.split(';')[0];
  const get=(url:string)=>fetch(base+url,{headers:{cookie}});
  for(const relative of [...Object.keys(expected),...imageFiles]){
   const privatePath='local/'+relative;
   expect(git('check-ignore','--','.aitiarch/'+privatePath).toString()).toContain(privatePath);
   for(const url of ['/api/file?path='+encodeURIComponent(privatePath),'/'+privatePath]){
    const res=await get(url);
    expect(res.status,url).toBe(404);
    assertPublic(Buffer.from(await res.arrayBuffer()),url);
   }
  }
  for(const relative of [...ownerlessLocks,path.basename(unknown)]){
   const target='local/'+relative;
   expect((await get('/api/file?path='+encodeURIComponent(target))).status).toBe(404);
   expect((await get('/'+target)).status).toBe(404);
  }
  const preview=skillPreviewUrl(staged.asset,staged.stage!);
  expect((await fetch(base+preview)).status).toBe(401);
  expect(await (await get(preview)).text()).toContain(markers.diagram);
  expect((await get(SKILL_DIAGRAM_URL(staged.asset))).status).toBe(404);
  const publishable=await diagrams.saveHtml(html('Explicitly shareable fixture'));
  const anchor=captureAnchor(existing.text,existing.text.indexOf('A synthetic'),existing.text.indexOf('paragraph')+'paragraph'.length);
  const snapshot=await f.ink.read(note),at=new Date().toISOString();
  for(const [id,skillDiagram] of [['publish-fixture',publishable],['discard-fixture',staged]] as const){
   snapshot.document.items.push({id,kind:'answer',body:'A synthetic drawing.',anchor,originalAnchor:anchor,
    attachment:{status:'attached',...anchor.position},skillDiagram,
    generation:{provider:'claude',model:null,requestId:id,action:'ask',status:'complete',createdAt:at,evidence:[],dismissed:false}});
  }
  await f.ink.write(note,snapshot.document,snapshot.version);
  const input={path:note,id:'publish-fixture',noteVersion:existing.version};
  const reviewed=await insertions.preview(input);
  const prepared=await insertions.prepare({...input,preview:reviewed});
  expect((await get(SKILL_DIAGRAM_URL(publishable.asset))).status).toBe(404);
  const {from,to,insert}=reviewed.changes;
  expect((await f.store.write(note,existing.text.slice(0,from)+insert+existing.text.slice(to),existing.version)).ok).toBe(true);
  await insertions.complete(note,prepared.operationId);
  expect((await get(skillPreviewUrl(publishable.asset,publishable.stage!))).status).toBe(404);
  expect(await (await get(SKILL_DIAGRAM_URL(publishable.asset))).text()).toContain('Explicitly shareable fixture');
  const response=await fetch(base+'/api/assistance/event',{method:'PUT',headers:{cookie,origin:base,'x-aitiarch':'1','content-type':'application/json'},
   body:JSON.stringify({path:note,id:'discard-fixture',event:'dismissed'})});
  expect(response.status).toBe(200);
  expect((await get(preview)).status).toBe(404);
  expect((await get(SKILL_DIAGRAM_URL(staged.asset))).status).toBe(404);
  const handoff=await get('/api/handoff');
  expect(handoff.status).toBe(200);
  assertPublic(Buffer.from(await handoff.arrayBuffer()),'handoff preview');
  expect((await fetch(base+'/api/handoff/write',{method:'PUT',headers:{cookie,origin:base,'x-aitiarch':'1','content-type':'application/json'},body:'{}'})).status).toBe(200);
  const chat=await get('/api/chat?path='+encodeURIComponent(note));
  expect(chat.status).toBe(200);
  assertNoImage(Buffer.from(await chat.arrayBuffer()),'authenticated chat history');
  const imageRead=await get('/api/chat/image-stage?id='+image.id);
  expect(imageRead.status).toBe(404);
  assertPublic(Buffer.from(await imageRead.arrayBuffer()),'image stage read');
  assertNoImage(await readFile(path.join(local,'ledger.json')),'ledger');
 }finally{watcher.stop();await app.close();}
 for(const entry of await readdir(root,{recursive:true,withFileTypes:true})){
  if(!entry.isFile()||path.relative(root,entry.parentPath).split(path.sep)[0]==='local')continue;
  assertPublic(await readFile(path.join(entry.parentPath,entry.name)),entry.name);
 }
 // There is no notebook ZIP endpoint. Exercise an actual Git ZIP of what Git
 // would share in this disposable repo. Store entries uncompressed for byte checks.
 const paths=git('ls-files','--others','--exclude-standard','-z','--','.aitiarch').toString().split('\0').filter(Boolean);
 expect(paths).toContain('.aitiarch/'+note);
 expect(paths).toContain('.aitiarch/handoff.md');
 expect(paths.some(file=>file.startsWith('.aitiarch/local/'))).toBe(false);
 git('--literal-pathspecs','add','--',...paths);
 const zip=git('archive','--format=zip','-0',git('write-tree').toString().trim());
 expect(zip.subarray(0,4)).toEqual(Buffer.from([0x50,0x4b,0x03,0x04]));
 expect(zip.includes('Public archive fixture')).toBe(true);
 expect(zip.includes('.aitiarch/local/')).toBe(false);
 assertPublic(zip,'Git ZIP');
 await imageCopy.discard();
 await images.discard(image.id);
},30_000);

it('keeps each private writer on its legacy path for a legacy notebook',async()=>{
 const f=await fixture(false),{files,staged}=await writePrivate(f);
 const expected={...files,'ink/insertions.json':markers.journal,['assets/'+staged.asset]:markers.diagram};
 expect(staged.stage).toBeUndefined();
 for(const [file,marker] of Object.entries(expected))expect(await readFile(path.join(f.root,file),'utf8'),file).toContain(marker);
 expect(await readdir(f.root)).not.toContain('local');
},15_000);

it('recovers an abandoned half-written stage and stale lock while preserving referenced and live stages',async()=>{
 const f=await fixture(true),diagrams=new SkillDiagramStore(f.root),local=path.join(f.root,'local');
 const stageDirectory=path.join(local,'skill-diagrams');
 const stageFile=(ref:{stage?:string;asset:string})=>path.join(stageDirectory,ref.stage+'-'+ref.asset);
 const gone=spawnSync(process.execPath,['-e',''],{windowsHide:true}).pid;
 expect(gone).toBeGreaterThan(0);
 const abandoned=await diagrams.saveHtml(html('Abandoned fixture'));
 const reviewed=await diagrams.saveHtml(html('Pending review fixture'));
 const live=await diagrams.saveHtml(html('Live writer fixture'));
 const pending=await diagrams.saveHtml(html('Pending insertion fixture'));
 await writeFile(stageFile(abandoned),'<html>half written');
 for(const ref of [abandoned,reviewed,pending])await writeFile(stageFile(ref)+'.owner',String(gone)+'\n');
 await writeFile(stageFile(live)+'.owner',String(process.pid)+'\n');
 const original=path.join(stageDirectory,'human-original.svg');
 await writeFile(original,'Human owned');
 const noteView=await f.store.read(note),from=noteView.text.indexOf('A synthetic');
 const anchor=captureAnchor(noteView.text,from,from+'A synthetic paragraph'.length);
 const ink=await f.ink.read(note);
 ink.document.items.push({id:'still-reviewed',kind:'answer',body:'Synthetic review',anchor,originalAnchor:anchor,
  attachment:{status:'attached',...anchor.position},skillDiagram:reviewed,
  generation:{provider:'claude',model:null,requestId:'still-reviewed',action:'ask',status:'complete',createdAt:new Date().toISOString(),evidence:[],dismissed:false}});
 const reviewedItem=ink.document.items[0];
 const pendingItem={...reviewedItem,id:'pending-insertion',skillDiagram:pending,generation:{...reviewedItem.generation!,requestId:'pending-insertion'}};
 ink.document.items.push(pendingItem);
 const written=await f.ink.write(note,ink.document,ink.version);
 const insertions=new InsertionStore(f.ink,f.store,f.ledger),input={path:note,id:pendingItem.id,noteVersion:noteView.version};
 await insertions.prepare({...input,preview:await insertions.preview(input)});
 ink.document.items.pop();
 await f.ink.write(note,ink.document,written);
 const lock=path.join(local,'ledger.json.lock');
 await writeFile(lock,'interrupted write');
 await utimes(lock,new Date(0),new Date(0));
 // Open fresh stores as after restart. A save exercises lazy recovery without touching the note.
 await new SkillDiagramStore(f.root).saveHtml(html('Next use fixture'));
 await new LedgerStore(f.root).append({id:'after-crash',inkId:'ink-fixture',requestId:'request-fixture',note,at:new Date().toISOString(),event:'shown'});
 await expect(readFile(stageFile(abandoned))).rejects.toMatchObject({code:'ENOENT'});
 await expect(readFile(stageFile(abandoned)+'.owner')).rejects.toMatchObject({code:'ENOENT'});
 await expect(readFile(lock)).rejects.toMatchObject({code:'ENOENT'});
 expect(await readFile(path.join(local,'ledger.json'),'utf8')).toContain('after-crash');
 expect(await readFile(original,'utf8')).toBe('Human owned');
 for(const ref of [reviewed,live,pending])expect((await diagrams.readPreview(ref.asset,ref.stage!)).length).toBe(ref.bytes);
 expect((await f.store.read(note)).version).toBe(noteView.version);
},30_000);
