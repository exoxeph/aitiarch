import {InvestigatorError,type InvestigatorRunner,type RunInput,type RunResult} from '../../shared/investigator.ts';
import {metadataOutput,spawnInvestigator,killTree} from '../providers/launcher.ts';import {investigatorArguments} from '../providers/claude-arguments.ts';import {assessCapabilities} from '../providers/capabilities.ts';
import {InvestigatorStream} from './stream.ts';import {minimalEnvironment} from './lookups.ts';
export interface InvestigatorCliOptions {command:string;prefixArgs?:string[];fixture?:boolean}
export function nonPromptingSupported(help:string){const lines=help.split(/\r?\n/),start=lines.findIndex(l=>/^\s*--permission-mode\s/.test(l));if(start<0)return false;let block=lines[start];for(let n=start+1;n<lines.length&&!/^\s*(?:-[a-zA-Z],\s*)?--[\w-]+(?:\s|$)/.test(lines[n]);n++)block+=' '+lines[n];return /\bdontAsk\b/.test(block);}
export class InvestigatorCli implements InvestigatorRunner {
 private options:InvestigatorCliOptions;private verified=false;constructor(options:InvestigatorCliOptions){if(options.fixture&&options.command!==process.execPath||options.prefixArgs?.length&&(!options.fixture||options.command!==process.execPath))throw new InvestigatorError('blocked');this.options=options;}
 async run(input:RunInput):Promise<RunResult>{
  const config={provider:'claude' as const,command:this.options.command,prefixArgs:this.options.prefixArgs},env=minimalEnvironment();
  if(!this.verified){if(!this.options.fixture){const version=await metadataOutput(config,['--version'],input.cwd,env),help=await metadataOutput(config,['--help'],input.cwd,env);const status=assessCapabilities({provider:'claude',contract:'claude-canary-2.1.205'},version,help);if(!status.available||!status.textStreaming||!nonPromptingSupported(help))throw new InvestigatorError('blocked');}this.verified=true;}
  if(input.signal.aborted)throw new InvestigatorError('cancelled');
  return new Promise((resolve,reject)=>{
   let failure:InvestigatorError|null=null,kill:Promise<void>=Promise.resolve(),stderrBytes=0;const stream=new InvestigatorStream(input.emit);
   const child=spawnInvestigator(config,investigatorArguments(),{cwd:input.cwd,env,detached:process.platform!=='win32'},input.cwd);
   const stop=(code:'cancelled'|'timeout'|'format_changed'|'budget'|'blocked')=>{if(failure)return;failure=new InvestigatorError(code);if(child.pid)kill=killTree(child.pid);};
   const cancel=()=>stop('cancelled');input.signal.addEventListener('abort',cancel,{once:true});if(input.signal.aborted)cancel();
   const timer=setTimeout(()=>stop('timeout'),input.timeoutMs);
   child.stdout.on('data',(b:Buffer)=>{try{stream.push(b);}catch(e){stop(e instanceof InvestigatorError&&e.code==='budget'?'budget':e instanceof InvestigatorError&&e.code==='blocked'?'blocked':'format_changed');}});
   child.stderr.on('data',(b:Buffer)=>{stderrBytes+=b.length;if(stderrBytes>64000)stop('budget');});child.stdin.on('error',()=>{});
   child.on('error',()=>{failure??=new InvestigatorError('provider_failed');});
   child.on('close',async code=>{clearTimeout(timer);input.signal.removeEventListener('abort',cancel);await kill;
    if(failure)return reject(failure);if(code!==0)return reject(new InvestigatorError('provider_failed'));
    try{const result=stream.finish();if(result.turns>input.turns||Math.max(result.tokens??0,Buffer.byteLength(JSON.stringify(input.input))+Buffer.byteLength(result.text))>input.maxTokens)throw new InvestigatorError('budget');resolve(result);}catch(e){reject(e instanceof InvestigatorError?e:new InvestigatorError('format_changed'));}
   });child.stdin.end(JSON.stringify(input.input));
  });
 }
}
