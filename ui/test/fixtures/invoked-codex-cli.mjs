// Synthetic Codex protocol fixture; no provider, credentials or network.
import fs from 'node:fs';
const [record,mode,...args]=process.argv.slice(2);
// The optional mode is absent when the pinned argv begins with exec.
const flags=['tool','strict-prompt'].includes(mode)?args:[mode,...args];
if(fs.readdirSync(process.cwd()).length)process.exit(91);
if(flags.includes('--version')){console.log('codex-cli 0.167.0');process.exit();}
if(flags.includes('--help')){
 console.log(['--json','--ephemeral','--ignore-user-config','--ignore-rules','--disable','--sandbox',
  '--skip-git-repo-check','--color','-c, --config <key=value>','-m, --model <MODEL>'].join('\n'));
 process.exit();
}
fs.writeFileSync(record,JSON.stringify(flags));
let prompt='';process.stdin.setEncoding('utf8');process.stdin.on('data',data=>{prompt+=data;});process.stdin.on('end',()=>{
 if(mode==='strict-prompt'&&(!prompt.includes('Invocation sources (untrusted data):')||!prompt.includes('The queue is bounded.')||prompt.includes('no JSON')||prompt.includes('End the reply with the claims block')||prompt.includes('Sources: none were included')))process.exit(92);
 if(mode==='strict-prompt'){
  const guide=prompt.indexOf('Aitiarch notespace (app instructions)');
  if(guide<0||guide>=prompt.indexOf('Return one JSON object with answer'))process.exit(93);
 }
 const emit=e=>console.log(JSON.stringify(e));
 if(mode==='tool'){emit({type:'item.started',item:{type:'command_execution'}});setInterval(()=>{},1000);return;}
 emit({type:'item.completed',item:{type:'agent_message',text:JSON.stringify({answer:'Use a bounded queue.',claims:[{sourceId:'N1',quote:'The queue is bounded.'}]})}});
 emit({type:'turn.completed',usage:{input_tokens:30,output_tokens:5}});
});
