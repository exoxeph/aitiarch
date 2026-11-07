// Independent failure observer. It never accepts a provider answer or changes parsing rules.
import { lstat, mkdir, open, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectClaudeCanary } from './claude-canary.ts';
import { parseAnswerJson } from './answer-json.ts';
import { inspectThinkingTokens } from './thinking-status.ts';
const types = new Set(['system','assistant','user','result','rate_limit_event','stream_event','tool_progress','auth_status','tool_use_summary','permission_denied','prompt_suggestion']);
const subtypes = new Set(['init','success','error_during_execution','error_max_turns','error_max_budget_usd','error_max_structured_output_retries',
  'hook_started','hook_progress','hook_response','status','compact_boundary','api_retry','task_started','task_progress','task_notification','task_updated',
  'local_command_output','notification','informational','session_state_changed','commands_changed','files_persisted','background_tasks_changed']);
const counters = new Set(['input_tokens','output_tokens','cache_read_input_tokens','cache_creation_input_tokens','cache_read_tokens','cache_write_tokens',
  'inputTokens','outputTokens','cacheReadInputTokens','cacheCreationInputTokens','reasoning_tokens','thinking_tokens','text_tokens','cached_tokens','web_search_requests','web_fetch_requests']);
type ParseIssue = { stage: 'event'|'result'; kind: 'empty'|'unexpected_end'|'syntax'; position: number|null; line: number };
interface ResultShape {
  nonEmpty:boolean; startsWithFence:boolean; validJson:boolean; answerPresent:boolean; claimsPresent:boolean;
  characterLength:number; parseErrorPosition:number; parseErrorKind:number; wrappedObjectJson:boolean; answerCharacterLength:number;
}
function resultShape(value:unknown):ResultShape {
  const text=typeof value==='string'?value:'';
  const result:ResultShape={nonEmpty:!!text.trim(),startsWithFence:text.trimStart().startsWith('```'),validJson:false,
    answerPresent:false,claimsPresent:false,characterLength:text.length,parseErrorPosition:-1,parseErrorKind:0,wrappedObjectJson:false,answerCharacterLength:-1};
  if(typeof value!=='string')return result;
  try{const decoded=parseAnswerJson(text) as {answer?:unknown}|null;if(typeof decoded?.answer==='string')result.answerCharacterLength=decoded.answer.length;}catch{}
  try {
    const parsed=JSON.parse(text);result.validJson=true;
    if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed)){
      result.answerPresent=Object.hasOwn(parsed,'answer');result.claimsPresent=Object.hasOwn(parsed,'claims');
    }
  } catch(error) {
    const message=error instanceof Error?error.message:'',offset=/position (\d+)/i.exec(message);
    const end=/unexpected end|unterminated|end of json/i.test(message);
    result.parseErrorKind=!text.trim()?1:end?2:3;
    result.parseErrorPosition=!text.trim()?0:end?text.length:offset?Number(offset[1]):-1;
    // Observation only: this probe never supplies an answer to the product parser.
    const from=text.indexOf('{'),to=text.lastIndexOf('}');
    if(from>=0&&to>from&&(text.slice(0,from).trim()||text.slice(to+1).trim())){
      try {const wrapped=JSON.parse(text.slice(from,to+1));result.wrappedObjectJson=!!wrapped&&typeof wrapped==='object'&&!Array.isArray(wrapped);}catch{}
    }
  }
  return result;
}
export interface FailureMetadata {
  exitCode: number|null; signal: string|null; stderrCategory: 'none'|'authentication'|'timeout'|'rate_limit'|'other';
  stdoutBytes: number; events: {type:string;subtype:string|null;count:number}[];
  parseError: ParseIssue|null; finalResultPresent: boolean; wallMs:number;
  usage: {source:'event'|'message'|'model'|'thinking_status';counters:Record<string,number>}[];
  thinkingStatusFields:{fields:string[];rejectedFields:string[]}[];
  resultShape:ResultShape;
  systemSubtypeCounts:Record<string,number>;
  outputTokenSplit:{thinking:number;text:number};
  isolation:{passed:boolean;fileCount:number;tools:number;mcpServers:number;plugins:number;hookEvents:number;toolAttempts:number;unknownEvents:number};
}
export interface FailureLog { write(record: FailureMetadata): Promise<void> }
interface Observation { exitCode:number|null;signal:string|null;stderr:string;stdout:string;stdoutBytes:number;wallMs:number;stream:boolean;fileCount?:number }
export function failureMetadata(input: Observation): FailureMetadata {
  const out: FailureMetadata = {exitCode:input.exitCode,signal:input.signal,stdoutBytes:input.stdoutBytes,wallMs:Math.round(input.wallMs),
    stderrCategory: !input.stderr ? 'none' : /not logged in|unauthori[sz]ed|authentication|login required|please (?:log|sign) in/i.test(input.stderr) ? 'authentication'
      : /timed? ?out|timeout/i.test(input.stderr) ? 'timeout' : /rate.?limit|too many requests/i.test(input.stderr) ? 'rate_limit' : 'other',
    events:[],parseError:null,finalResultPresent:false,usage:[],thinkingStatusFields:[],resultShape:resultShape(undefined),systemSubtypeCounts:Object.create(null),outputTokenSplit:{thinking:-1,text:-1},
    isolation:{passed:false,fileCount:input.fileCount??-1,tools:-1,mcpServers:-1,plugins:-1,hookEvents:0,toolAttempts:0,unknownEvents:0}};
  const parse = (text: string,stage: ParseIssue['stage'],line:number): any => {
    try{return stage==='result'?parseAnswerJson(text):JSON.parse(text);}catch(error){
      const message=error instanceof Error?error.message:'';
      const offset=/position (\d+)/i.exec(message);
      // Never retain exception text: V8 may quote the offending private content.
      out.parseError ??= {stage,kind:!text.trim()?'empty':/unexpected end|unterminated|end of json/i.test(message)?'unexpected_end':'syntax',
        position:!text.trim()?0:/unexpected end|unterminated|end of json/i.test(message)?text.length:offset?Number(offset[1]):null,line};
      return null;
    }
  };
  const numeric = (value:any,source:'event'|'message'|'model') => {
    if(!value||typeof value!=='object')return;
    const clean:Record<string,number>={};let unknown=0;
    const visit=(obj:any)=>{for(const[k,v]of Object.entries(obj)){
      if(counters.has(k)&&typeof v==='number'&&Number.isFinite(v)&&v>=0)clean[k]=v;
      else if(typeof v==='number'&&Number.isFinite(v))clean[`unknown_${++unknown}`]=v;
      else if(v&&typeof v==='object')visit(v);
    }};
    visit(value);if(Object.keys(clean).length)out.usage.push({source,counters:clean});
  };
  const lines=input.stream?input.stdout.trim().split(/\r?\n/):[input.stdout],events:Record<string,any>[]=[];
  let invalidEvent=false;
  lines.forEach((line,index)=>{
    const event=parse(line,'event',index+1);if(!event||typeof event!=='object'){invalidEvent=true;return;}
    events.push(event);
    const type=types.has(event.type)?event.type:'unknown';
    const subtype=event.type==='system'
      ?typeof event.subtype==='string'&&/^[a-z][a-z0-9_]{0,39}$/.exec(event.subtype)?.[0]===event.subtype?event.subtype:'unknown'
      :event.subtype==null?null:subtypes.has(event.subtype)?event.subtype:'unknown';
    if(event.type==='system')out.systemSubtypeCounts[subtype]=(out.systemSubtypeCounts[subtype]??0)+1;
    const last=out.events.at(-1);if(last&&last.type===type&&last.subtype===subtype)last.count++;else out.events.push({type,subtype,count:1});
    if(event.type==='system'&&event.subtype==='thinking_tokens'){
      const checked=inspectThinkingTokens(event);
      out.thinkingStatusFields.push({fields:checked.fields,rejectedFields:checked.rejectedFields});
      if(checked.valid&&Object.keys(checked.tokenCounts).length)out.usage.push({source:'thinking_status',counters:checked.tokenCounts});
      return; // Do not inspect any other values or nested usage in a status event.
    }
    numeric(event.usage,'event');numeric(event.message?.usage,'message');numeric(event.event?.usage,'event');numeric(event.event?.message?.usage,'message');
    if(event.modelUsage&&typeof event.modelUsage==='object')for(const value of Object.values(event.modelUsage))numeric(value,'model');
    if(event.type==='result'){
      out.finalResultPresent=true;out.resultShape=resultShape(event.result);
      const numericToken=(...values:unknown[])=>values.find(v=>typeof v==='number'&&Number.isFinite(v)&&v>=0) as number|undefined;
      out.outputTokenSplit={thinking:numericToken(event.usage?.output_tokens_details?.thinking_tokens,event.usage?.output_tokens_details?.reasoning_tokens,event.usage?.thinking_tokens,event.usage?.reasoning_tokens)??-1,
        text:numericToken(event.usage?.output_tokens_details?.text_tokens,event.usage?.text_tokens)??-1};
    }
    if((event.type==='result'||!input.stream)&&typeof event.result==='string')parse(event.result,'result',index+1);
  });
  if(input.stream){
    const checked=inspectClaudeCanary(events,[]);
    out.isolation={passed:checked.passed&&input.fileCount===0&&!invalidEvent,fileCount:input.fileCount??-1,
      tools:checked.registries.tools??-1,mcpServers:checked.registries.mcpServers??-1,plugins:checked.registries.plugins??-1,
      hookEvents:checked.hookEvents,toolAttempts:checked.toolAttempts,unknownEvents:checked.unknownEvents};
  }
  return out;
}
const repository = fileURLToPath(new URL('../../../', import.meta.url));
const queues = new Map<string,Promise<void>>();
const inside=(base:string,target:string)=>{const rel=path.relative(base,target);return !rel||(rel!=='..'&&!rel.startsWith(`..${path.sep}`)&&!path.isAbsolute(rel));};
export function privateFailureLog(directory = path.join(os.homedir(),...(process.platform==='win32'?['AppData','Local']:['.config']),'Aitiarch','metrics')): FailureLog {
  const dir=path.resolve(directory),file=path.join(dir,'provider-failures.jsonl');
  const confined=(target:string)=>{if(inside(repository,target)||target.split(/[\\/]/).some(p=>p.toLowerCase()==='.aitiarch'))throw new Error('Private failure metrics cannot be written in the repository or a notebook root.');};
  return {write(record){
    const run=(queues.get(file)??Promise.resolve()).catch(()=>{}).then(async()=>{
      confined(dir);
      // Check the nearest existing ancestor before mkdir follows any directory link.
      for(let parent=dir;;parent=path.dirname(parent)){
        try{confined(await realpath(parent));break;}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
      }
      await mkdir(dir,{recursive:true,mode:0o700});confined(await realpath(dir));
      try{const s=await lstat(file);if(s.isSymbolicLink()||!s.isFile()||s.nlink!==1)throw new Error('Unsafe private metrics file.');confined(await realpath(file));}
      catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
      const handle=await open(file,constants.O_CREAT|constants.O_APPEND|constants.O_WRONLY|(constants.O_NOFOLLOW??0),0o600);
      try{const s=await handle.stat();if(!s.isFile()||s.nlink!==1)throw new Error('Unsafe private metrics file.');await handle.writeFile(JSON.stringify(record)+'\n');await handle.sync();}
      finally{await handle.close();}
    });
    queues.set(file,run);void run.finally(()=>{if(queues.get(file)===run)queues.delete(file);}).catch(()=>{});return run;
  }};
}
