// One turn of a Claude Code CLI chat session that the app owns. The first turn starts the session with the app's id (--session-id); later
// turns resume it (--resume), so the CLI keeps the conversation. Each turn sends the app's instruction and the pasted notes through a file
// that lives outside the session's working folder and is removed after the turn, and the question on stdin. Nothing else goes to the CLI.
//
// A turn for a note that shows diagrams may open their pictures: the working folder then holds ONLY the app's validated PNG copies (d1.png ...), the CLI has the Read tool and nothing else,
// and every event is read by DiagramTurnWatcher before the chat stream sees it. A turn without diagrams has no tools and an empty folder, as it always had.
import {mkdir,mkdtemp,readdir,realpath,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {validSessionId} from '../../shared/harness.ts';
import {ClaudeChatStream} from '../providers/chat-stream.ts';
import {ProviderError} from '../providers/index.ts';
import {killTree,metadataOutput,spawnChatSession} from '../providers/launcher.ts';
import {FenceStop} from './diagram-fence.ts';
import {sweepOwnCopies,syncDiagramFolder,verifyDiagramFolder,type FolderCopy,type WantedCopy} from './diagram-folder.ts';
import {DiagramTurnWatcher} from './diagram-watch.ts';
import {activeTurnDirs} from './sweep.ts';

export interface SessionRunnerConfig {command:string;prefixArgs?:string[];
 /** The project's harness folder (outside the repo). The session working folder and per-turn files live under it. */
 dir:string;model?:string;timeoutMs?:number}
/** A turn that may open diagrams: the pictures to copy into the folder (already checked by the picture store, checked again) and the dollar cap for the turn. */
export interface TurnDiagrams {copies:WantedCopy[];budgetUsd:number}
export interface ChatTurn {id:string;resume:boolean;addendum:string;question:string;diagrams?:TurnDiagrams;signal?:AbortSignal;onTextDelta:(text:string)=>void;
 /** Called once the CLI has started (or resumed) the session, so a failed first turn still marks the id as taken. */
 onStarted?:()=>void;
 /** A Read of one of the copies was accepted (it is about to run). */
 onDiagramRead?:(copy:FolderCopy)=>void;
 /** The Read's result came back: whether it worked. */
 onDiagramReadResult?:(copy:FolderCopy,ok:boolean)=>void}
export interface TurnResult {answer:string;usage:{inputTokens:number;outputTokens:number;cachedTokens?:number}|null;unknownEvents:string[];
 /** What the CLI said the turn cost, in dollars. Null when it did not say. */
 costUsd:number|null;
 /** Every Read of a copy that the watcher accepted, in order (a diagram read twice is listed twice). */
 reads:FolderCopy[]}
const env=():NodeJS.ProcessEnv=>{const out:NodeJS.ProcessEnv={};for(const [k,v] of Object.entries(process.env))if(/^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|HOME|USERPROFILE|APPDATA|LOCALAPPDATA)$/i.test(k))out[k]=v;out.CLAUDE_CODE_DISABLE_AUTO_MEMORY='1';return out;};
const n=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:null;
/** input = new input plus cache writes; cached = cache reads; output. Null when the CLI did not report them. */
export function sessionUsage(u:Record<string,unknown>|null):TurnResult['usage']{
 if(!u)return null;const input=n(u.input_tokens),write=n(u.cache_creation_input_tokens)??0,read=n(u.cache_read_input_tokens),output=n(u.output_tokens);
 return input===null||output===null?null:{inputTokens:input+write,outputTokens:output,...(read===null?{}:{cachedTokens:read})};
}

export class ClaudeSessionRunner {
 private cfg:SessionRunnerConfig;
 /** The working folder is shared by every conversation (the CLI files its transcripts by it), and a turn that opens diagrams fills it with its copies: one turn at a time. */
 private line:Promise<void>=Promise.resolve();
 constructor(cfg:SessionRunnerConfig){this.cfg=cfg;}
 /** The fixed, empty working folder for chat sessions. The CLI files its transcripts by working folder, so it must stay the same to resume. */
 async chatCwd(){const d=path.join(this.cfg.dir,'chat-cwd');await mkdir(d,{recursive:true});return realpath(d);}
 private versionCache?:{at:number;version:string|null};
 /** The CLI's version (`claude --version`), for the ledger and for Settings: the diagram fence was verified on one version. Asked at most once in ten minutes. Null when it cannot be read. */
 async version():Promise<string|null>{
  if(this.versionCache&&Date.now()-this.versionCache.at<600000)return this.versionCache.version;
  let version:string|null=null;
  try{const out=await metadataOutput({provider:'claude',command:this.cfg.command,prefixArgs:this.cfg.prefixArgs},['--version'],await this.chatCwd(),env());version=/^\s*(\d{1,4}(?:\.\d{1,4}){1,3}[0-9A-Za-z.+-]{0,30})/.exec(out)?.[1]??null;}catch{version=null;}
  this.versionCache={at:Date.now(),version};return version;
 }
 /** Waits for the turns before this one; a turn cancelled while it waits never starts and gives its place on. */
 private async exclusive<T>(signal:AbortSignal|undefined,run:()=>Promise<T>):Promise<T>{
  let release!:()=>void;const mine=new Promise<void>(r=>{release=r;}),before=this.line;this.line=before.then(()=>mine);
  try{
   await new Promise<void>((resolve,reject)=>{
    const gone=()=>reject(new ProviderError('cancelled'));
    if(signal?.aborted)return gone();signal?.addEventListener('abort',gone,{once:true});
    before.then(()=>{signal?.removeEventListener('abort',gone);resolve();});
   });
   return await run();
  }finally{release();}
 }
 chatTurn(t:ChatTurn):Promise<TurnResult>{
  if(!validSessionId(t.id)||typeof t.question!=='string'||!t.question.trim()||typeof t.addendum!=='string'||!t.addendum)return Promise.reject(new ProviderError('provider_error'));
  if(t.signal?.aborted)return Promise.reject(new ProviderError('cancelled'));
  return this.exclusive(t.signal,()=>this.turn(t));
 }
 private async turn(t:ChatTurn):Promise<TurnResult>{
  const cwd=await this.chatCwd();let copies:FolderCopy[]=[];
  const turnDir=await mkdtemp(path.join(this.cfg.dir,'turn-')),file=path.join(turnDir,'system.md');activeTurnDirs.add(path.resolve(turnDir));
  try{
   if(t.diagrams)copies=await syncDiagramFolder(cwd,t.diagrams.copies);
   else{await sweepOwnCopies(cwd);if((await readdir(cwd)).length)throw new ProviderError('invalid_response','The session folder is not empty.');}
   await writeFile(file,t.addendum,{mode:0o600});
   const stream=new ClaudeChatStream(t.onTextDelta,t.onStarted);let watcher=null as DiagramTurnWatcher|null;
   await new Promise<void>((resolve,reject)=>{
    const child=spawnChatSession({provider:'claude',command:this.cfg.command,prefixArgs:this.cfg.prefixArgs},{id:t.id,resume:t.resume,addendumFile:file,...(t.diagrams?{diagrams:{budgetUsd:t.diagrams.budgetUsd,files:copies.map(c=>c.file)}}:{}),...(this.cfg.model?{model:this.cfg.model}:{})},{cwd,env:env(),detached:process.platform!=='win32'},cwd);
    let failure:ProviderError|undefined,killing:Promise<void>=Promise.resolve(),bytes=0,checks:Promise<void>=Promise.resolve();const stderr:Buffer[]=[];
    const stopWith=(e:ProviderError)=>{if(failure)return;failure=e;if(child.pid)killing=killTree(child.pid);};
    const stop=(code:'timeout'|'cancelled'|'output_limit'|'invalid_response',detail?:string)=>{const e=new ProviderError(code);if(detail)e.reason={kind:'unparseable',detail};stopWith(e);};
    /** Anything that goes wrong while reading the stream: a named fence, a limit, or a stream that is not valid. */
    const broke=(e:unknown)=>{
     if(e instanceof ProviderError)return stopWith(e);
     const own=e instanceof Error&&e.message.startsWith('Invalid chat stream: ');stop('invalid_response',own?(e as Error).message.slice(21):'the output was not valid JSON lines');
    };
    if(copies.length)watcher=new DiagramTurnWatcher({cwd,copies,forward:e=>stream.feed(e),onRead:c=>t.onDiagramRead?.(c),onReadResult:(c,ok)=>t.onDiagramReadResult?.(c,ok),
     onTool:()=>{checks=checks.then(()=>verifyDiagramFolder(cwd,copies)).catch(broke);}}); // every tool event: is the folder still exactly what the app made?
    const timer=setTimeout(()=>stop('timeout'),this.cfg.timeoutMs??180000),abort=()=>stop('cancelled');
    t.signal?.addEventListener('abort',abort,{once:true});
    child.stdout.on('data',(b:Buffer)=>{
     if(failure)return;
     if(watcher){try{watcher.push(b);}catch(e){broke(e);}return;}
     bytes+=b.length;if(bytes>262144)return stop('output_limit');
     try{stream.push(b);}catch(e){broke(e);}
    });
    child.stderr.on('data',(b:Buffer)=>{if(stderr.reduce((s,x)=>s+x.length,0)<16384)stderr.push(b);});
    child.stdin.on('error',()=>{});
    child.on('error',(e:NodeJS.ErrnoException)=>{failure??=new ProviderError(e.code==='ENOENT'?'missing_cli':'provider_error');});
    child.once('close',async code=>{
     clearTimeout(timer);t.signal?.removeEventListener('abort',abort);await killing;await checks;
     if(failure instanceof FenceStop&&failure.costUsd===undefined&&watcher?.cost!=null)failure.costUsd=watcher.cost;
     if(failure)return reject(failure);
     if(code!==0){const text=Buffer.concat(stderr).toString('utf8'),login=/not logged in|login required|please (?:log|sign) in/i.test(text);const x=new ProviderError(login?'not_logged_in':'provider_error');x.reason=login?{kind:'login'}:{kind:'exited',exitCode:code??undefined};return reject(x);}
     try{watcher?.finish();stream.finish();resolve();}catch(e){
      if(e instanceof ProviderError)return reject(e);
      const x=new ProviderError('invalid_response');x.reason={kind:'unparseable',detail:'the reply ended before it was complete'};reject(x);
     }
    });
    child.stdin.end(t.question);
   });
   if(copies.length)await verifyDiagramFolder(cwd,copies); // nothing was added, changed, removed or linked during the turn
   else if((await readdir(cwd)).length)throw new ProviderError('invalid_response','The session wrote into its working folder.');
   return {answer:stream.finalText,usage:sessionUsage(stream.usage),unknownEvents:stream.unknown,costUsd:stream.cost??watcher?.cost??null,reads:[...(watcher?.reads??[])]};
  }finally{await rm(turnDir,{recursive:true,force:true});activeTurnDirs.delete(path.resolve(turnDir));await sweepOwnCopies(cwd).catch(()=>{});}
 }
}
