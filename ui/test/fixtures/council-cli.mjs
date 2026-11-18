// Synthetic protocol data only. Never invokes a provider.
import readline from 'node:readline';import fs from 'node:fs';import path from 'node:path';
const mode=process.argv[2];const args=process.argv.slice(3);const out=e=>console.log(JSON.stringify(e));
if(mode==='alpha'&&args.includes('--version')){console.log('codex-cli 0.169.0-alpha.11.1');process.exit();}
const record=args[0]&&path.isAbsolute(args[0])?args.shift():null;
if(record&&(args.includes('--version')||args.includes('--help')))fs.appendFileSync(record,JSON.stringify(args)+'\n');
if(fs.readdirSync(process.cwd()).length)process.exit(91);
if(args.includes('--version')){console.log(mode.startsWith('kiro')||['permission','no-inventory','refusal','replay'].includes(mode)?`kiro-cli ${mode==='kiro-newer'?'3.4.0':'3.3.0'}`:`codex-cli ${mode==='codex-newer'?'0.168.0':'0.167.0'}`);process.exit();}
if(args.includes('--help')){if(['metadata-hang','help-hang'].includes(mode)){setInterval(()=>{},1000);}else{console.log((args.includes('acp')?['--agent-engine','--agent']:['--json','--ephemeral','--ignore-user-config','--ignore-rules','--sandbox read-only','--skip-git-repo-check','--color','--cd','--config','--disable']).join('\n'));process.exit();}}
if(!args.includes('acp')){
 if(mode==='runtime-error'){process.stdin.resume();process.stdin.on('end',()=>{out({type:'item.completed',item:{type:'error',message:'Code Mode is unavailable because code-mode host is disabled.'}});out({type:'turn.completed',usage:{input_tokens:20000,output_tokens:1}});});}else
 process.stdin.resume();process.stdin.on('end',()=>{if(mode==='hang')setInterval(()=>{},1000);else if(['codex','codex-newer'].includes(mode)){out({type:'item.completed',item:{type:'agent_message',text:'June.'}});out({type:'turn.completed',usage:{input_tokens:10,output_tokens:2}});}else{out({type:'item.started',item:{type:mode}});setInterval(()=>{},1000);}});
}else{
 const rl=readline.createInterface({input:process.stdin});let requestId;
 rl.on('line',line=>{const e=JSON.parse(line);if(!e.method){if(requestId===e.id){if(e.result?.outcome?.optionId!=='reject_once')process.exit(92);process.exit(0);}return;}
 const reply=r=>out({jsonrpc:'2.0',id:e.id,result:r});
 if(e.method==='initialize')reply({protocolVersion:mode==='kiro-wrong-protocol'?2:1,agentInfo:{name:'kiro-cli',version:mode==='kiro-newer'?'3.4.0':'3.3.0'},agentCapabilities:{loadSession:true}});
 else if(e.method==='session/new'||e.method==='session/load'){
  if(e.params.mcpServers.length||e.params.cwd!==process.cwd())process.exit(93);
  if(mode==='replay'){out({method:'_kiro.dev/metadata',params:{data:{stopReason:'CONTENT_FILTERED',refusal:{category:'SYNTHETIC'}}}});out({method:'session/update',params:{update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'old replay'}}}});}
  const shape=JSON.parse(fs.readFileSync(new URL('./kiro-v2-handshake.json',import.meta.url),'utf8'));
  if(mode==='no-inventory')shape.inventory.params.tools=undefined;
  if(mode==='kiro-tools')shape.inventory.params.tools=[{name:'read'}];
  if(mode==='kiro-mcp')shape.inventory.params.mcpServers=[{name:'synthetic'}];
  if(mode==='kiro-agent')shape.session.modes.availableModes=[];
  if(mode==='kiro-unreadable')shape.inventory.params=null;
  if(mode==='kiro-after'){reply(shape.session);out(shape.inventory);}else{out(shape.inventory);reply(shape.session);}
 }else if(e.method==='session/prompt'){
  if(mode==='no-inventory')process.exit(94);
  if(mode==='permission'){requestId=100;out({jsonrpc:'2.0',id:requestId,method:'session/request_permission',params:{options:[{optionId:'allow_once',kind:'allow_once'},{optionId:'reject_once',kind:'reject_once'}]}});return;}
  if(mode==='refusal')out({method:'_kiro.dev/metadata',params:{data:{stopReason:'CONTENT_FILTERED',refusal:{category:'CYBER'}}}});
  out({method:'session/update',params:{update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'June.'}}}});
  out({method:'_kiro.dev/metadata',params:{meteringUsage:[{unit:'credit',value:0.02}]}});
  out({method:'_kiro.dev/metadata',params:{meteringUsage:[{unit:'credit',value:0.02}]}});reply({stopReason:'end_turn'});
 }
 });
}
