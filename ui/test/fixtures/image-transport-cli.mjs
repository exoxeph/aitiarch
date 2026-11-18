// Fake image transport. Never forwards stdin or invokes a provider.
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {createInterface} from 'node:readline';
const [provider,...args]=process.argv.slice(2);
if(provider==='catalog'){
 if(args.includes('--version')){console.log('codex-cli 0.170.0');process.exit(0);}
 if(args[0]!=='app-server')process.exit(91);
 for await(const line of createInterface({input:process.stdin})){
  const {id,method}=JSON.parse(line);
  const respond=result=>console.log(JSON.stringify({id,result}));
  if(method==='initialize')respond({userAgent:'fake',platformFamily:'windows',platformOs:'windows'});
  else if(method==='model/list'){
   const data=Object.entries({vision:['text','image'],'text-only':['text'],unknown:undefined}).map(([model,inputModalities])=>
    ({id:model,model,displayName:model,hidden:false,isDefault:false,supportedReasoningEfforts:[],inputModalities}));
   respond({data,nextCursor:null});
  }else if(method!=='initialized')process.exit(92);
 }
 process.exit(0);
}
const record=args[0]==='record'?args[1]:null;
const argv=record?args.slice(2):args;
if(record&&argv.includes('--version')){
 console.log(provider==='claude'?'2.1.205 (Claude Code)':'codex-cli 0.167.0');
 process.exit(0);
}
if(record&&argv.includes('--help')){
 const help=provider==='claude'?[
  '--print Print response and exit','--tools Use "" to disable all tools','--no-session-persistence Disable session persistence',
  '--safe-mode All customizations, hooks and MCP disabled','--strict-mcp-config Only use MCP servers from --mcp-config',
  '--mcp-config JSON files or strings','--settings Settings JSON file or a JSON string','--setting-sources Setting sources to load',
  '--disable-slash-commands Disable all skills','--output-format json, stream-json','--verbose Verbose',
  '--include-hook-events Include all hook lifecycle events in the output stream','--include-partial-messages Partial stream',
  '--max-turns Maximum number of turns','--input-format stream-json',
 ]:['--json','--ephemeral','--ignore-user-config','--ignore-rules','--disable','--sandbox','--skip-git-repo-check','--color','--config','-m, --model <MODEL>','-i, --image <FILE>'];
 console.log(help.join('\n'));
 process.exit(0);
}
if(readdirSync(process.cwd()).length)process.exit(90);
const input=readFileSync(0,'utf8');
const image=argv.includes('--image')?argv[argv.indexOf('--image')+1]:undefined;
const data={argv,cwd:process.cwd(),body:provider==='claude'?JSON.parse(input):input,...(image?{image,contents:readFileSync(image).toString('base64')}:{})};
if(!record){console.log(JSON.stringify(data));process.exit(0);}
writeFileSync(record,JSON.stringify(data));
const result='Synthetic image answer.\n<claims>{"none":"no_context_used"}</claims>';
if(provider==='claude'){
 console.log(JSON.stringify({type:'system',subtype:'init',tools:[],mcp_servers:[],plugins:[]}));
 console.log(JSON.stringify({type:'result',subtype:'success',result,usage:{input_tokens:30,output_tokens:5},total_cost_usd:0.001}));
}else{
 console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:result}}));
 console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:30,output_tokens:5}}));
}
