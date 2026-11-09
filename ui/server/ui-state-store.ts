import {lstat,readFile,open,rename,unlink,writeFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {randomUUID,createHash} from 'node:crypto';import path from 'node:path';
import {normalizeRel,isNotePath} from './paths.ts';
import {exactKeys,validAt,validId} from '../shared/threads.ts';
const exec=promisify(execFile);
export interface ThreadDraft {note:string;inkId:string;text:string;updatedAt:string;revision:string}
export interface SavedUiState {v:1;tabs:string[];active:string|null;treeCollapsed?:boolean;theme?:'system'|'light'|'dark';confirmAdd?:boolean;typingHelp?:boolean;doubleSpacePeriod?:boolean;threadDrafts?:Record<string,ThreadDraft>}
const key=(note:string,id:string)=>createHash('sha256').update(note+'\0'+id).digest('hex');
export class UiStateStore {
 private root:string;private file:string;
 private tail:Promise<unknown>=Promise.resolve();
 constructor(root:string){this.root=root;this.file=path.join(root,'ui-state.json');}
 async draftStatus(){let enabled=false;try{await this.ignored(this.file+'.ignore-probe.tmp');enabled=true;}catch{}return {enabled,ignoreLine:'/ui-state.json*',ignoreFile:path.join(this.root,'.gitignore')};}
 /** Only the authenticated, explicit setup button calls this. No implicit edits. */
 async enableDrafts(){
  if((await this.draftStatus()).enabled)return this.draftStatus();
  const file=path.join(this.root,'.gitignore'),lock=await open(file+'.aitiarch.lock','wx',0o600),temp=file+'.'+randomUUID()+'.tmp';
  const read=async()=>{try{const s=await lstat(file);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.size>1024*1024)throw new Error('Unsafe ignore file.');return await readFile(file);}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return Buffer.alloc(0);throw e;}};
  try{const previous=await read(),text=new TextDecoder('utf-8',{fatal:true}).decode(previous),eol=text.includes('\r\n')?'\r\n':'\n';
   await writeFile(temp,Buffer.concat([previous,Buffer.from((text&&!text.endsWith('\n')?eol:'')+'/ui-state.json*'+eol)]),{flag:'wx',mode:0o600});
   if(!(await read()).equals(previous))throw new Error('Ignore file changed.');await rename(temp,file);
   const status=await this.draftStatus();if(!status.enabled)throw new Error('Ignore coverage could not be verified. Drafts remain in memory.');return status;
  }finally{await unlink(temp).catch(()=>{});await lock.close();await unlink(file+'.aitiarch.lock');}
 }
 private async safe(){try{const s=await lstat(this.file);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.size>2*1024*1024)throw new Error('Unsafe UI state.');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}}
 async read():Promise<SavedUiState>{await this.safe();let d:any;try{d=JSON.parse(await readFile(this.file,'utf8'));}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return {v:1,tabs:[],active:null};throw e;}
  if(!d||typeof d!=='object'||Array.isArray(d))throw new Error('Invalid UI state.');
  const tabs:string[]=[];for(const t of Array.isArray(d.tabs)?d.tabs.slice(0,50):[]){try{const n=normalizeRel(t);if(isNotePath(n)&&!tabs.includes(n))tabs.push(n);}catch{}}
  const state:SavedUiState={v:1,tabs,active:tabs.includes(d.active)?d.active:null};
  if(typeof d.treeCollapsed==='boolean')state.treeCollapsed=d.treeCollapsed;
  if(['system','light','dark'].includes(d.theme))state.theme=d.theme;
  if(typeof d.confirmAdd==='boolean')state.confirmAdd=d.confirmAdd;
  if(typeof d.typingHelp==='boolean')state.typingHelp=d.typingHelp;
  if(typeof d.doubleSpacePeriod==='boolean')state.doubleSpacePeriod=d.doubleSpacePeriod;
  if(d.threadDrafts!==undefined){if(!d.threadDrafts||typeof d.threadDrafts!=='object'||Array.isArray(d.threadDrafts)||Object.keys(d.threadDrafts).length>1000)throw new Error('Invalid thread drafts.');
   for(const [k,v] of Object.entries(d.threadDrafts) as [string,ThreadDraft][]){if(!exactKeys(v,['note','inkId','text','updatedAt','revision'])||!validId(v.inkId)||!validId(v.revision)||!validAt(v.updatedAt)||typeof v.text!=='string'||v.text.length>100000||normalizeRel(v.note)!==v.note||!isNotePath(v.note)||k!==key(v.note,v.inkId))throw new Error('Invalid thread draft.');}
   state.threadDrafts=d.threadDrafts;
  }return state;
 }
 private async ignored(temporary:string){try{await exec('git',['check-ignore','-q','--',this.file],{cwd:this.root,windowsHide:true,timeout:3000});await exec('git',['check-ignore','-q','--',temporary],{cwd:this.root,windowsHide:true,timeout:3000});}catch{throw new Error('Draft persistence disabled: ui-state.json must be git-ignored. Add /ui-state.json* explicitly (covers atomic temporary files too).');}}
 private mutate<T>(fn:(s:SavedUiState)=>T,requireIgnored=false):Promise<T>{
  const job=this.tail.catch(()=>{}).then(()=>this.mutateLocked(fn,requireIgnored));this.tail=job;return job;
 }
 private async mutateLocked<T>(fn:(s:SavedUiState)=>T,requireIgnored=false){
  await this.safe();const lock=await open(this.file+'.lock','wx',0o600),temp=this.file+'.'+randomUUID()+'.tmp';
  try{const s=await this.read();if(requireIgnored||s.treeCollapsed!==undefined||s.theme!==undefined||s.confirmAdd!==undefined||s.typingHelp!==undefined||s.doubleSpacePeriod!==undefined||Object.keys(s.threadDrafts??{}).length)await this.ignored(temp);const result=fn(s),data=JSON.stringify(s,null,2)+'\n';if(Buffer.byteLength(data)>2*1024*1024)throw new Error('UI state too large.');
   const f=await open(temp,'wx',0o600);try{await f.writeFile(data);await f.sync();}finally{await f.close();}await this.safe();await rename(temp,this.file);return result;
  }finally{await unlink(temp).catch(()=>{});await lock.close();await unlink(this.file+'.lock');}
 }
 async updateTabs(tabs:Pick<SavedUiState,'v'|'tabs'|'active'|'treeCollapsed'|'theme'|'confirmAdd'|'typingHelp'|'doubleSpacePeriod'>){
  for(const name of ['typingHelp','doubleSpacePeriod'] as const)if(tabs[name]!==undefined&&typeof tabs[name]!=='boolean')throw new Error('Invalid typing preference.');
  if(tabs.confirmAdd!==undefined&&typeof tabs.confirmAdd!=='boolean')throw new Error('Invalid confirm-before-adding preference.');
  if(tabs.treeCollapsed!==undefined&&typeof tabs.treeCollapsed!=='boolean')throw new Error('Invalid tree preference.');
  if(tabs.theme!==undefined&&!['system','light','dark'].includes(tabs.theme))throw new Error('Invalid theme preference.');
  return this.mutate(s=>{s.tabs=tabs.tabs;s.active=tabs.active;if(tabs.treeCollapsed!==undefined)s.treeCollapsed=tabs.treeCollapsed;if(tabs.theme!==undefined)s.theme=tabs.theme;if(tabs.confirmAdd!==undefined)s.confirmAdd=tabs.confirmAdd;
   for(const name of ['typingHelp','doubleSpacePeriod'] as const)if(tabs[name]!==undefined)s[name]=tabs[name];
   return {v:1 as const,tabs:s.tabs,active:s.active,...(s.treeCollapsed!==undefined?{treeCollapsed:s.treeCollapsed}:{}),...(s.theme!==undefined?{theme:s.theme}:{}),...(s.confirmAdd!==undefined?{confirmAdd:s.confirmAdd}:{}),...(s.typingHelp!==undefined?{typingHelp:s.typingHelp}:{}),...(s.doubleSpacePeriod!==undefined?{doubleSpacePeriod:s.doubleSpacePeriod}:{})};},tabs.treeCollapsed!==undefined||tabs.theme!==undefined||tabs.confirmAdd!==undefined||tabs.typingHelp!==undefined||tabs.doubleSpacePeriod!==undefined);
 }
 async draft(note:string,id:string){return (await this.read()).threadDrafts?.[key(note,id)]??null;}
 async saveDraft(note:string,id:string,text:string,revision:string|null){if(normalizeRel(note)!==note||!isNotePath(note)||!validId(id)||typeof text!=='string'||text.length>100000)throw new Error('Invalid human draft.');
  return this.mutate(s=>{const drafts=s.threadDrafts??={},k=key(note,id);if((drafts[k]?.revision??null)!==revision)throw new Error('Draft version conflict.');const d={note,inkId:id,text,updatedAt:new Date().toISOString(),revision:randomUUID()};drafts[k]=d;s.threadDrafts=drafts;return d;},true);
 }
 async removeDraft(note:string,id:string){return this.mutate(s=>{if(s.threadDrafts)delete s.threadDrafts[key(note,id)];},true);}
}
