import {open,lstat,readdir,realpath} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import type {ContextModule,ContextSource,ContextEntry} from '../../shared/chat.ts';
import {SESSION_LIMITS as L,SESSION_NOTICES as N,type SessionKind,type SessionTurn} from '../../shared/ide-sessions.ts';
import {SESSION_PICKER_NOTICES as P,type SessionDetails} from '../../shared/ide-sessions.ts';
import {redact} from '../providers/index.ts';
const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
const obj=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const fail=():never=>{throw new Error(N.format);};
const limit=():never=>{throw new Error(N.limit);};
const notice=(e:unknown)=>e instanceof Error&&(Object.values(N) as readonly string[]).includes(e.message)?e.message:N.format;
const canonical=(s:string)=>/^[a-z]:[\\/]/i.test(s)?path.win32.normalize(s).replace(/[\\/]+$/,'').toLowerCase():path.resolve(s);
const same=(a:string,b:string)=>canonical(a)===canonical(b);
const CLAUDE_IGNORED=new Set(['session-owner','ai-title','queue-operation','attachment','file-history-snapshot','atis-latch','api-request-shape','api-request-blob','api-request','last-prompt','system','tools-used','file-history-delta','cost-state','mode']);
const CODEX_IGNORED=new Set(['world_state','turn_context','token_usage_record','compacted','inter_agent_communication_metadata']);
const CODEX_EVENTS=new Set(['task_started','thread_settings_applied','item_completed','token_count','task_complete','turn_aborted']);
const CODEX_ITEMS=new Set(['additional_tools','custom_tool_call','custom_tool_call_output','reasoning','function_call','function_call_output','agent_message','web_search_call']);
const CODEX_COMPLETED=new Set(['UserMessage','AgentMessage','FileChange','ContextCompaction','SubAgentActivity','CommandExecution','Reasoning','ImageView']);
function records(raw:string):Record<string,any>[] {
 if(Buffer.byteLength(raw)>L.fileBytes)limit();const lines=raw.split('\n');if(lines.length>L.records+1)limit();
 for(const s of lines)if(Buffer.byteLength(s)>L.lineBytes)limit();
 return lines.filter(s=>s.trim()).map(s=>{let x;try{x=JSON.parse(s);}catch{fail();}if(!obj(x)||typeof x.type!=='string')fail();return x;});
}
/** Only fields selected below are extracted. Tool/thinking/event payloads are never forwarded. */
export function parseSession(kind:SessionKind,raw:string,project:string):SessionTurn[]{
 const result:SessionTurn[]=[];let matched=false,canonicalMessages=false,characters=0;
 const add=(role:SessionTurn['role'],text:string)=>{if(!text.trim())return;characters+=text.length;if(characters>L.characters||result.length>=L.turns)limit();result.push({role,text});};
 for(const r of records(raw)){
  if(kind==='claude-sessions'){
   if(CLAUDE_IGNORED.has(r.type))continue;
   if(!['user','assistant'].includes(r.type)||typeof r.cwd!=='string'||!same(r.cwd,project))fail();matched=true;
   if(r.isSidechain===true||r.isMeta===true)continue;
   if(r.isSidechain!==undefined&&typeof r.isSidechain!=='boolean'||r.isMeta!==undefined&&typeof r.isMeta!=='boolean')fail();
   const m=r.message;if(!obj(m)||m.role!==r.type)fail();
   if(r.type==='user'&&typeof m.content==='string'){add('user',m.content);continue;}
   if(!Array.isArray(m.content))fail();let text='',toolResult=false;
   for(const b of m.content){if(!obj(b)||!['text','thinking','tool_use','tool_result','image','tool_addition'].includes(b.type))fail();if(b.type==='tool_result')toolResult=true;if(b.type==='text'){if(typeof b.text!=='string')fail();text+=b.text;}}
   if(r.type==='user'){if(!toolResult)add('user',text);}
   else {if(!['end_turn','tool_use'].includes(m.stop_reason))fail();if(m.stop_reason==='end_turn')add('assistant',text);}
  }else{
   if(r.type==='session_meta'){if(!obj(r.payload)||typeof r.payload.cwd!=='string'||!same(r.payload.cwd,project))fail();matched=true;continue;}
   if(CODEX_IGNORED.has(r.type))continue;
   if(!matched||!obj(r.payload))fail();const m=r.payload;
   if(r.type==='event_msg'){
    if(!CODEX_EVENTS.has(m.type))fail();
    if(m.type==='item_completed'){
     const item=m.item;if(!obj(item)||!CODEX_COMPLETED.has(item.type))fail();
     if(item.type==='UserMessage'||item.type==='AgentMessage'){
      if(typeof item.id!=='string'||!Array.isArray(item.content))fail();
      if(item.type==='AgentMessage'&&!['commentary','final_answer'].includes(item.phase))fail();
      let text='';for(const b of item.content){if(!obj(b)||!['text','Text','image','Image'].includes(b.type))fail();if(['image','Image'].includes(b.type))continue;if(b.type!==(item.type==='UserMessage'?'text':'Text')||typeof b.text!=='string')fail();text+=b.text;}
      if(item.type==='UserMessage'||item.phase==='final_answer'){canonicalMessages=true;add(item.type==='UserMessage'?'user':'assistant',text);}
     }
    }continue;
   }
   if(r.type!=='response_item')fail();if(CODEX_ITEMS.has(m.type))continue;if(m.type!=='message'||!['user','assistant','developer','system'].includes(m.role))fail();
   if(['developer','system'].includes(m.role))continue;
   if(m.role==='assistant'&&!['commentary','final_answer'].includes(m.phase))fail();
   if(!Array.isArray(m.content))fail();let text='';for(const b of m.content){if(!obj(b)||!['input_text','output_text','input_image'].includes(b.type))fail();if(b.type==='input_image')continue;if(b.type!==(m.role==='user'?'input_text':'output_text')||typeof b.text!=='string')fail();text+=b.text;}
   // Response items also contain injected context and mirrored messages. Never extract them.
  }
 }
 if(!matched||kind==='codex-sessions'&&!canonicalMessages)fail();return result;
}
export function redactSession(text:string):string {
 return redact(text).replace(/\bBearer\s+[A-Za-z0-9._~+\/-]{16,}/gi,'Bearer [SECRET]')
  .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,'[SECRET]')
  .replace(/\b(?:AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,}|glpat-[A-Za-z0-9_-]{16,})\b/g,'[SECRET]')
  .replaceAll('[SECRET]','[redacted: key-like token]').replaceAll('[PRIVATE KEY]','[redacted: private key]');
}
/** Reject links in every ancestor, not merely the leaf. No auth/config/history files are opened. */
async function safePath(file:string){let current=path.parse(path.resolve(file)).root;for(const part of path.resolve(file).slice(current.length).split(path.sep).filter(Boolean)){current=path.join(current,part);const s=await lstat(current);if(s.isSymbolicLink())throw new Error(N.selection);}return lstat(file);}
async function readBounded(file:string,header=false){
 const before=await safePath(file);if(!before.isFile()||before.nlink>1)throw new Error(N.selection);if(!header&&before.size>L.fileBytes)limit();
 const f=await open(file,'r');try{const s=await f.stat();if(s.ino!==before.ino||s.dev!==before.dev)throw new Error(N.changed);if(!header&&s.size>L.fileBytes)limit();const b=Buffer.alloc(header?Math.min(s.size,65536):s.size+1);let n=0;while(n<b.length){const count=(await f.read(b,n,b.length-n,n)).bytesRead;if(!count)break;n+=count;}const after=await f.stat();if(!header&&(n!==s.size||s.size!==after.size||s.mtimeMs!==after.mtimeMs))throw new Error(N.changed);const end=header&&n<s.size?b.lastIndexOf(10,n-1)+1:n;return new TextDecoder('utf-8',{fatal:true}).decode(b.subarray(0,end));}finally{await f.close();}
}
export interface SessionModuleOptions {project:string;roots?:Partial<Record<SessionKind,string>>}
/** The registry holds opaque handles only; no selection is made by default. Sources are ephemeral. */
export function sessionModules(options:SessionModuleOptions):ContextModule[]{
 return (['claude-sessions','codex-sessions'] as const).map(kind=>{
  const root=options.roots?.[kind]??path.join(os.homedir(),kind==='claude-sessions'?'.claude':'.codex',kind==='claude-sessions'?'projects':'sessions');
  const label=kind==='claude-sessions'?'Claude Code sessions':'Codex sessions';const index=new Map<string,{file:string;project:string}>();
  const list=async(listOptions?:{otherProjects?:boolean})=>{
   index.clear();let files=0,dirs=0;const project=await realpath(options.project);
   const entries:ContextEntry[]=[];
   async function walk(dir:string,depth:number):Promise<void>{if(depth>5)return;if(++dirs>L.directories)limit();await safePath(dir);for(const e of await readdir(dir,{withFileTypes:true})){if(e.isSymbolicLink()||kind==='claude-sessions'&&e.name==='subagents')continue;const file=path.join(dir,e.name);if(e.isDirectory())await walk(file,depth+1);else if(e.isFile()&&e.name.endsWith('.jsonl')){if(++files>L.files)limit();
      // Listing reveals only cwd membership, never prompts, names, titles or excerpts.
      const id=digest(kind+'\0'+file);let working:string|undefined,details:SessionDetails={title:'Unavailable session',modifiedAt:new Date(0).toISOString(),bytes:0,messageCount:0,estimatedTokens:0,projectMatch:false,status:'read',notice:P.read};
      try{
       const stat=await safePath(file);details.bytes=stat.size;details.modifiedAt=stat.mtime.toISOString();
       const rows=records(await readBounded(file,true));working=kind==='claude-sessions'?rows.find(r=>['user','assistant'].includes(r.type))?.cwd:rows.find(r=>r.type==='session_meta')?.payload?.cwd;
       if(typeof working!=='string'){if(!listOptions?.otherProjects)continue;throw new Error(N.format);}
       details.projectMatch=same(working,project);if(!details.projectMatch&&!listOptions?.otherProjects)continue;
       const turns=parseSession(kind,await readBounded(file),working),text=sessionText(turns);
       details={...details,title:redactSession(turns.find(t=>t.role==='user')?.text??'No user prompt').replace(/\s+/g,' ').slice(0,160),messageCount:turns.length,estimatedTokens:Buffer.byteLength(text),status:'ready'};delete details.notice;
       index.set(id,{file,project:working});
      }catch(e){const reason=notice(e);details.status=reason===N.limit?'limit':reason===N.format?'format':'read';details.notice=P[details.status];}
      entries.push({id,label:label+' '+(entries.length+1),session:details});
   }}}
   try{await walk(root,0);}catch(e){index.clear();if((e as NodeJS.ErrnoException).code==='ENOENT')return [];throw new Error(notice(e));}
   return entries.sort((a,b)=>b.session!.modifiedAt.localeCompare(a.session!.modifiedAt)||a.id.localeCompare(b.id));
  };
  return {id:kind,label,list,redact:redactSession,estimateTokens:text=>Buffer.byteLength(text),preview:sources=>sources.map(s=>({id:s.id,label:s.label,characters:s.text.length,estimatedTokens:Buffer.byteLength(s.text)})),
   read:async(ids,limits)=>{if(!ids.length)return [];if(ids.length>limits.maxSources||new Set(ids).size!==ids.length)limit();const sources:ContextSource[]=[];
    for(const id of ids){const entry=index.get(id);if(!entry)throw new Error(N.selection);let raw;try{raw=await readBounded(entry.file);}catch(e){throw new Error(notice(e));}
     const turns=parseSession(kind,raw,entry.project);const text=sessionText(turns);
     if(sources.reduce((n,s)=>n+s.text.length,0)+text.length>limits.maxCharacters)limit();sources.push({id:(kind==='claude-sessions'?'C':'X')+(sources.length+1),label,version:digest(text),text,ephemeral:true});
    }return sources;
   }};
 });
}
/** Shared by listing estimates, picker previews and the sender's ContextModule.read. */
export function sessionText(turns:readonly SessionTurn[]):string{return redactSession(turns.map(t=>`${t.role==='user'?'User':'Assistant (final)'}:\n${t.text}`).join('\n\n'));}
