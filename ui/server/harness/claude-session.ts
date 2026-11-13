// One turn of a Claude Code CLI chat session that the app owns. The first turn starts the session with the app's id (--session-id); later
// turns resume it (--resume), so the CLI keeps the conversation. Each turn sends the app's instruction and the pasted notes through a file
// that lives outside the session's working folder and is removed after the turn, and the question on stdin. Nothing else goes to the CLI.
import {mkdir,mkdtemp,readdir,realpath,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {validSessionId} from '../../shared/harness.ts';
import {ClaudeChatStream} from '../providers/chat-stream.ts';
import {ProviderError} from '../providers/index.ts';
import {killTree,spawnChatSession} from '../providers/launcher.ts';
import {activeTurnDirs} from './sweep.ts';

export interface SessionRunnerConfig {command:string;prefixArgs?:string[];
 /** The project's harness folder (outside the repo). The session working folder and per-turn files live under it. */
 dir:string;model?:string;timeoutMs?:number}
export interface ChatTurn {id:string;resume:boolean;addendum:string;question:string;signal?:AbortSignal;onTextDelta:(text:string)=>void;
 /** Called once the CLI has started (or resumed) the session, so a failed first turn still marks the id as taken. */
 onStarted?:()=>void}
export interface TurnResult {answer:string;usage:{inputTokens:number;outputTokens:number;cachedTokens?:number}|null;unknownEvents:string[]}
const env=():NodeJS.ProcessEnv=>{const out:NodeJS.ProcessEnv={};for(const [k,v] of Object.entries(process.env))if(/^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|HOME|USERPROFILE|APPDATA|LOCALAPPDATA)$/i.test(k))out[k]=v;out.CLAUDE_CODE_DISABLE_AUTO_MEMORY='1';return out;};
const n=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:null;
/** input = new input plus cache writes; cached = cache reads; output. Null when the CLI did not report them. */
export function sessionUsage(u:Record<string,unknown>|null):TurnResult['usage']{
 if(!u)return null;const input=n(u.input_tokens),write=n(u.cache_creation_input_tokens)??0,read=n(u.cache_read_input_tokens),output=n(u.output_tokens);
 return input===null||output===null?null:{inputTokens:input+write,outputTokens:output,...(read===null?{}:{cachedTokens:read})};
}

export class ClaudeSessionRunner {
 private cfg:SessionRunnerConfig;
 constructor(cfg:SessionRunnerConfig){this.cfg=cfg;}
 /** The fixed, empty working folder for chat sessions. The CLI files its transcripts by working folder, so it must stay the same to resume. */
 async chatCwd(){const d=path.join(this.cfg.dir,'chat-cwd');await mkdir(d,{recursive:true});return realpath(d);}
 async chatTurn(t:ChatTurn):Promise<TurnResult>{
  if(!validSessionId(t.id)||typeof t.question!=='string'||!t.question.trim()||typeof t.addendum!=='string'||!t.addendum)throw new ProviderError('provider_error');
  if(t.signal?.aborted)throw new ProviderError('cancelled');
  const cwd=await this.chatCwd();if((await readdir(cwd)).length)throw new ProviderError('invalid_response','The session folder is not empty.');
  const turnDir=await mkdtemp(path.join(this.cfg.dir,'turn-')),file=path.join(turnDir,'system.md');activeTurnDirs.add(path.resolve(turnDir));
  try{
   await writeFile(file,t.addendum,{mode:0o600});
   const stream=new ClaudeChatStream(t.onTextDelta,t.onStarted);
   await new Promise<void>((resolve,reject)=>{
    const child=spawnChatSession({provider:'claude',command:this.cfg.command,prefixArgs:this.cfg.prefixArgs},{id:t.id,resume:t.resume,addendumFile:file,...(this.cfg.model?{model:this.cfg.model}:{})},{cwd,env:env(),detached:process.platform!=='win32'},cwd);
    let failure:ProviderError|undefined,killing:Promise<void>=Promise.resolve(),bytes=0;const stderr:Buffer[]=[];
    const stop=(code:'timeout'|'cancelled'|'output_limit'|'invalid_response',detail?:string)=>{if(failure)return;failure=new ProviderError(code);if(detail)failure.reason={kind:'unparseable',detail};if(child.pid)killing=killTree(child.pid);};
    const timer=setTimeout(()=>stop('timeout'),this.cfg.timeoutMs??180000),abort=()=>stop('cancelled');
    t.signal?.addEventListener('abort',abort,{once:true});
    child.stdout.on('data',(b:Buffer)=>{bytes+=b.length;if(bytes>262144)return stop('output_limit');
     try{stream.push(b);}catch(e){const own=e instanceof Error&&e.message.startsWith('Invalid chat stream: ');stop('invalid_response',own?(e as Error).message.slice(21):'the output was not valid JSON lines');}});
    child.stderr.on('data',(b:Buffer)=>{if(stderr.reduce((s,x)=>s+x.length,0)<16384)stderr.push(b);});
    child.stdin.on('error',()=>{});
    child.on('error',(e:NodeJS.ErrnoException)=>{failure??=new ProviderError(e.code==='ENOENT'?'missing_cli':'provider_error');});
    child.once('close',async code=>{
     clearTimeout(timer);t.signal?.removeEventListener('abort',abort);await killing;
     if(failure)return reject(failure);
     if(code!==0){const text=Buffer.concat(stderr).toString('utf8'),login=/not logged in|login required|please (?:log|sign) in/i.test(text);const x=new ProviderError(login?'not_logged_in':'provider_error');x.reason=login?{kind:'login'}:{kind:'exited',exitCode:code??undefined};return reject(x);}
     try{stream.finish();resolve();}catch{const x=new ProviderError('invalid_response');x.reason={kind:'unparseable',detail:'the reply ended before it was complete'};reject(x);}
    });
    child.stdin.end(t.question);
   });
   if((await readdir(cwd)).length)throw new ProviderError('invalid_response','The session wrote into its working folder.');
   return {answer:stream.finalText,usage:sessionUsage(stream.usage),unknownEvents:stream.unknown};
  }finally{await rm(turnDir,{recursive:true,force:true});activeTurnDirs.delete(path.resolve(turnDir));}
 }
}
