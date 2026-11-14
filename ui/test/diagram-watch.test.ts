import path from 'node:path';
import {describe,expect,it} from 'vitest';
import {FenceStop} from '../server/harness/diagram-fence.ts';
import {DiagramTurnWatcher} from '../server/harness/diagram-watch.ts';
import type {FolderCopy} from '../server/harness/diagram-folder.ts';
import {DIAGRAM_MAX_TOOL_EVENTS} from '../shared/diagram-fence.ts';
import {pathInside} from '../server/harness/investigate.ts';

// The event policy of a conversation turn that may open diagrams. A Read of a copy in the turn's folder is allowed and shown; any other tool, hook or permission event, any path that is not one of
// the copies, a 13th tool event, or the CLI's own cost cap stops the turn with a named cause. Nothing here starts a CLI: the events are the shapes the real CLI 2.1.205 prints (stream-json with partial messages).
const cwd=path.join(process.platform==='win32'?'C:\\Users\\tester\\AppData\\Local\\Temp':'/tmp','aitiarch-turn','chat-cwd');
const copy=(n:number):FolderCopy=>({n,file:`d${n}.png`,asset:'diagram-'+String(n).repeat(64),bytes:1000+n,hash:String(n).repeat(64)});
const copies=[copy(1),copy(2)];
const init=(o:Record<string,unknown>={})=>({type:'system',subtype:'init',cwd,session_id:'s',tools:['Read'],mcp_servers:[],plugins:[],permissionMode:'dontAsk',...o});
const assistantTool=(id:string,name:string,input:unknown)=>({type:'assistant',message:{id:'msg_'+id,role:'assistant',content:[{type:'tool_use',id,name,input,caller:{type:'direct'}}]}});
const resultOk=(id:string,extra:Record<string,unknown>={})=>({type:'user',message:{role:'user',content:[{tool_use_id:id,type:'tool_result',content:[{type:'image',source:{type:'base64',data:'AAAA',media_type:'image/png'}}]}]},tool_use_result:{type:'image',file:{base64:'AAAA'}},...extra});
const resultError=(id:string,text:string)=>({type:'user',message:{role:'user',content:[{type:'tool_result',content:text,is_error:true,tool_use_id:id}]}});
const text=(t:string)=>[{type:'stream_event',event:{type:'content_block_start',index:0,content_block:{type:'text',text:''}}},{type:'stream_event',event:{type:'content_block_delta',index:0,delta:{type:'text_delta',text:t}}},{type:'stream_event',event:{type:'content_block_stop',index:0}}];
const streamedTool=(id:string,name:string,json:string,index=1)=>[
 {type:'stream_event',event:{type:'content_block_start',index,content_block:{type:'tool_use',id,name,input:{}}}},
 ...json.match(/[\s\S]{1,12}/g)!.map(p=>({type:'stream_event',event:{type:'content_block_delta',index,delta:{type:'input_json_delta',partial_json:p}}})),
 {type:'stream_event',event:{type:'content_block_stop',index}},{type:'stream_event',event:{type:'message_delta',delta:{stop_reason:'tool_use'}}},{type:'stream_event',event:{type:'message_stop'}}];
const done=(extra:Record<string,unknown>={})=>({type:'result',subtype:'success',is_error:false,result:'ok',total_cost_usd:0.0321,usage:{input_tokens:1,output_tokens:2},permission_denials:[],...extra});

function run(events:unknown[],options:{max?:number}={}){
 const forwarded:any[]=[],reads:FolderCopy[]=[],results:[FolderCopy,boolean][]=[];let tools=0;
 const w=new DiagramTurnWatcher({cwd,copies,...(options.max?{maxTools:options.max}:{}),forward:e=>forwarded.push(e),onRead:c=>reads.push(c),onReadResult:(c,ok)=>results.push([c,ok]),onTool:()=>{tools++;}});
 let stopped:FenceStop|Error|null=null;
 try{for(const e of events)w.push(Buffer.from(JSON.stringify(e)+'\n'));w.finish();}catch(e){stopped=e as Error;}
 return {w,forwarded,reads,results,stopped,tools:()=>tools};
}
const cause=(r:{stopped:Error|null})=>r.stopped instanceof FenceStop?r.stopped.fence:r.stopped?'other:'+r.stopped.message:null;
const read=(file:string,id='t1')=>[init(),assistantTool(id,'Read',{file_path:file})];

describe('a Read of a diagram copy',()=>{
 it('is allowed and counted, whether it arrives streamed in pieces or as the whole assistant message, and neither tool event reaches the chat stream',()=>{
  const file=path.join(cwd,'d1.png'),r=run([init(),...text('Let me look. '),...streamedTool('t1','Read',JSON.stringify({file_path:file})),assistantTool('t1','Read',{file_path:file}),resultOk('t1'),...text('It has two boxes.'),done()]);
  expect(cause(r)).toBeNull();expect(r.reads).toEqual([copies[0]]);expect(r.results).toEqual([[copies[0],true]]);expect(r.w.toolEvents).toBe(1);expect(r.w.cost).toBe(0.0321);
  const seen=JSON.stringify(r.forwarded);expect(seen).not.toMatch(/tool_use|tool_result|input_json|image/);expect(r.forwarded.find(e=>e.subtype==='init').tools).toEqual([]); // the chat stream sees a session without tools
  expect(r.forwarded.filter(e=>e.type==='stream_event'&&e.event.delta?.text).map(e=>e.event.delta.text)).toEqual(['Let me look. ','It has two boxes.']);
 });
 it('is allowed in the spellings that name the same file inside the folder, and each spelling is one read',()=>{
  const spellings=[path.join(cwd,'d1.png'),'d1.png','./d1.png','.\\d1.png',cwd.replace(/\\/g,'/')+'/d1.png',path.join(cwd,'.','d1.png'),path.join(cwd,'d2.png')];
  for(const [i,p] of spellings.entries()){const r=run([...read(p),done()]);expect(cause(r),p).toBeNull();expect(r.reads[0].n,p).toBe(i===spellings.length-1?2:1);}
 });
 it('may be repeated for the same diagram, each a tool event, and the cap counts distinct events',()=>{
  const file=path.join(cwd,'d1.png');
  const ok=run([init(),...Array.from({length:DIAGRAM_MAX_TOOL_EVENTS},(_,i)=>assistantTool('t'+i,'Read',{file_path:file})),done()]);expect(cause(ok)).toBeNull();expect(ok.w.toolEvents).toBe(DIAGRAM_MAX_TOOL_EVENTS);
  const again=run([init(),assistantTool('t1','Read',{file_path:file}),assistantTool('t1','Read',{file_path:file}),done()]);expect(again.w.toolEvents).toBe(1);expect(again.reads).toHaveLength(1); // the same call seen twice (streamed, then whole) is one
  const over=run([init(),...Array.from({length:DIAGRAM_MAX_TOOL_EVENTS+1},(_,i)=>assistantTool('t'+i,'Read',{file_path:file})),done()]);expect(cause(over)).toBe('tool_limit');expect(over.reads).toHaveLength(DIAGRAM_MAX_TOOL_EVENTS);
 });
 it('lets a result that is a whole 500 KB picture through (it is not counted as reply text), and still caps reply text',()=>{
  const big={type:'user',message:{role:'user',content:[{type:'tool_result',tool_use_id:'t1',content:[{type:'image',source:{type:'base64',media_type:'image/png',data:'A'.repeat(700000)}}]}]},tool_use_result:{file:{base64:'A'.repeat(700000)}}};
  const ok=run([...read(path.join(cwd,'d1.png')),big,done()]);expect(cause(ok)).toBeNull();
  const flood=run([init(),...Array.from({length:30},()=>text('x'.repeat(10000))).flat(),done()]);expect(flood.stopped).not.toBeInstanceOf(FenceStop);expect((flood.stopped as {code?:string}).code).toBe('output_limit');
 });
 it('reads that fail without a permission denial (the file is gone) are shown as failed and the turn goes on',()=>{
  const r=run([...read(path.join(cwd,'d1.png')),resultError('t1','File does not exist.'),done()]);expect(cause(r)).toBeNull();expect(r.results).toEqual([[copies[0],false]]);
 });
});

describe('a turn is stopped, with the cause, for',()=>{
 const outside=[
  ['an absolute path outside the folder',path.resolve(cwd,'..','..','outside','secret.txt')],['the parent folder, relative',`..${path.sep}x.png`],['the parent folder, relative with a copy name','..\\d1.png'],
  ['a sibling folder that shares the prefix',cwd+'-evil'+path.sep+'d1.png'],['a copy in a sub-folder (a junction-like path)',path.join(cwd,'link','d1.png')],['a junction-like relative path','link\\d1.png'],
  ['an extended path','\\\\?\\'+path.join(cwd,'d1.png')],['a UNC path','\\\\localhost\\C$\\Users\\tester\\d1.png'],['a device path','\\\\.\\C:\\d1.png'],['a home path','~/d1.png'],['a variable','%TEMP%\\d1.png'],['a shell variable','$HOME/d1.png'],
  ['a stream suffix',path.join(cwd,'d1.png')+':secret'],['a drive-relative path','C:d1.png'],['a diagram that was not copied',path.join(cwd,'d3.png')],['a name that only looks like a copy',path.join(cwd,'d1.png.txt')],
  ['the folder itself',cwd],['a trailing dot',path.join(cwd,'d1.png.')],['an empty path',''],['a path through ..',path.join(cwd,'..','chat-cwd','d1.png')+'\\..\\..\\x'],
 ] as const;
 for(const [label,p] of outside)it(`${label} (outside_path)`,()=>{
  const streamed=run([init(),...streamedTool('t1','Read',JSON.stringify({file_path:p}))]);expect(cause(streamed),label).toBe('outside_path');expect(streamed.reads,'a refused path is never counted as a read').toEqual([]); // refused when the streamed call ends, before the whole message
  const whole=run([...read(p),done()]);expect(cause(whole),label).toBe('outside_path');expect(whole.reads).toEqual([]);
 });
 it('a Read with no path, or a path that is not text (outside_path)',()=>{
  for(const input of [{},{file_path:7},{file_path:null},{file_path:['d1.png']}])expect(cause(run([init(),assistantTool('t1','Read',input)])),JSON.stringify(input)).toBe('outside_path');
 });
 it('a tool that is not Read, streamed or whole, whatever its input (tool_refused)',()=>{
  for(const name of ['Bash','Write','Edit','Grep','Glob','WebFetch','Task','NotebookEdit','read','Read ']){
   expect(cause(run([init(),assistantTool('t1',name,{file_path:path.join(cwd,'d1.png')})])),name).toBe('tool_refused');
   expect(cause(run([init(),...streamedTool('t1',name,'{}')])),name).toBe('tool_refused');
  }
 });
 it('a Read with options a picture never needs (tool_refused)',()=>{
  for(const input of [{file_path:path.join(cwd,'d1.png'),command:'x'},{file_path:path.join(cwd,'d1.png'),offset:'a'},{file_path:path.join(cwd,'d1.png'),limit:{}}])expect(cause(run([init(),assistantTool('t1','Read',input)]))).toBe('tool_refused');
  expect(cause(run([init(),...streamedTool('t1','Read','{"file_path": broken')]))).toBe('tool_refused');
 });
 it('a hook event, a permission denial in the result, or a denied Read (isolation)',()=>{
  expect(cause(run([init(),{type:'system',subtype:'hook_started',hook_name:'x'}]))).toBe('isolation');expect(cause(run([init(),{type:'hook_response'}]))).toBe('isolation');
  expect(cause(run([init(),done({permission_denials:[{tool_name:'Read',tool_input:{}}]})]))).toBe('isolation');
  expect(cause(run([...read(path.join(cwd,'d1.png')),resultError('t1',"Permission to use Read has been denied because Claude Code is running in don't ask mode."),done()]))).toBe('isolation');
  expect(cause(run([...read(path.join(cwd,'d1.png')),resultOk('unknown-id'),done()]))).toBe('isolation'); // a result for a call that was never seen
  expect(cause(run([assistantTool('t1','Read',{file_path:path.join(cwd,'d1.png')})]))).toBe('isolation'); // a tool event before the session started
 });
 it('a session that did not start as required (isolation)',()=>{
  for(const o of [{tools:['Read','Grep']},{tools:[]},{tools:['Bash']},{mcp_servers:[{name:'x'}]},{plugins:[{name:'x'}]},{permissionMode:'default'},{permissionMode:undefined}])expect(cause(run([init(o)])),JSON.stringify(o)).toBe('isolation');
  expect(cause(run([init(),init()]))).toBe('isolation');
 });
 it('the CLI\'s own cost cap, with what it had spent (budget)',()=>{
  const r=run([...read(path.join(cwd,'d1.png')),resultOk('t1'),{type:'result',subtype:'error_max_budget_usd',is_error:true,result:'',total_cost_usd:0.51,permission_denials:[]}]);
  expect(cause(r)).toBe('budget');expect((r.stopped as FenceStop).costUsd).toBe(0.51);
 });
 it('every accepted tool event asks for the folder to be checked',()=>{
  const r=run([init(),assistantTool('t1','Read',{file_path:path.join(cwd,'d1.png')}),assistantTool('t2','Read',{file_path:path.join(cwd,'d2.png')}),done()]);expect(r.tools()).toBe(2);
 });
});

describe('a turn with nothing unusual',()=>{
 it('forwards every event it does not own, unchanged, and reads its text and cost',()=>{
  const events=[init(),{type:'rate_limit_event',rate_limit_info:{status:'allowed'}},...text('Hello.'),{type:'stream_event',event:{type:'message_delta',delta:{stop_reason:'end_turn'}}},done()];
  const r=run(events);expect(cause(r)).toBeNull();expect(r.forwarded).toHaveLength(events.length);expect(r.forwarded.slice(1,-1)).toEqual(events.slice(1,-1));expect(r.w.toolEvents).toBe(0);expect(r.reads).toEqual([]);
 });
 it('refuses a stop reason of tool_use when no tool was seen (the chat stream stops it)',()=>{
  const r=run([init(),{type:'stream_event',event:{type:'message_delta',delta:{stop_reason:'tool_use'}}}]);expect(r.forwarded.some(e=>e.event?.delta?.stop_reason==='tool_use')).toBe(true);
 });
 it('reports a line that is not JSON as an invalid stream',()=>{
  const w=new DiagramTurnWatcher({cwd,copies,forward:()=>{},onRead:()=>{}});expect(()=>w.push(Buffer.from('not json\n'))).toThrow(/Invalid chat stream/);
 });
});

describe('the one rule of "inside the folder" (shared with Investigate)',()=>{
 it('accepts a file of the folder, in the spellings that name it',()=>{
  for(const p of ['d1.png','./d1.png',path.join(cwd,'d1.png'),path.join(cwd,'sub','x.png')])expect(pathInside(cwd,p),p).toBe(true);
 });
 it('refuses each way out on its own, also when it would otherwise resolve inside',()=>{
  for(const p of ['~/d1.png','~','%TEMP%\\d1.png','$HOME/d1.png','a$b.png','a%b.png','\\\\?\\'+path.join(cwd,'d1.png'),'\\\\.\\C:\\d1.png','\\\\localhost\\C$\\d1.png','//server/share/d1.png','C:d1.png','d1.png:secret',path.join(cwd,'d1.png')+':x','','..','..\\d1.png','../d1.png',path.resolve(cwd,'..'),cwd+'-evil\\d1.png',path.parse(cwd).root])
   expect(pathInside(cwd,p),JSON.stringify(p)).toBe(false);
 });
});
