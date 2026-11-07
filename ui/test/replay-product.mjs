// Test-only offline reader. Never creates a provider or writes captures/logs.
import { readFile, realpath, lstat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseAnswerJson } from '../server/providers/answer-json.ts';
import { validateProviderResponse, redact } from '../server/providers/index.ts';
import { textHash } from '../server/anchor-cache.ts';
import { validateProductResult, ProductValidationError } from '../server/product-validation.ts';
const report=(rule,pass)=>console.log(JSON.stringify({rule,pass}));
const repo=await realpath(fileURLToPath(new URL('../../',import.meta.url)));
const inside=(base,target)=>{const rel=path.relative(base,target);return !rel||(!path.isAbsolute(rel)&&rel!=='..'&&!rel.startsWith(`..${path.sep}`));};
async function externalFile(value){
  if(typeof value!=='string'||!path.isAbsolute(value)||inside(repo,path.resolve(value)))throw new Error();
  const canonical=await realpath(value),stat=await lstat(canonical);
  if(inside(repo,canonical)||!stat.isFile()||stat.nlink!==1||stat.size>1048576)throw new Error();
  return canonical;
}
let resultPath,contextPath;
try{
  const args=process.argv.slice(2);
  if(args.length!==4||args[0]!=='--result'||args[2]!=='--context')throw new Error();
  // Validate BOTH destinations before reading either capture.
  resultPath=await externalFile(args[1]);contextPath=await externalFile(args[3]);
}catch{report('replay_path',false);process.exit(1);}
let context;
try{
  context=JSON.parse(await readFile(contextPath,'utf8'));
  if(!context||typeof context.expectedId!=='string'||typeof context.resultId!=='string'||typeof context.note!=='string'||!Array.isArray(context.decisions)
    ||!Object.hasOwn(context,'model')||!Object.hasOwn(context,'provider')
    ||context.decisions.some(d=>!d||typeof d.id!=='string'||typeof d.text!=='string'))throw new Error();
}catch{report('replay_context',false);process.exit(1);}
let decoded;
try{decoded=parseAnswerJson(await readFile(resultPath,'utf8'));}
catch{report('response_format',false);process.exit(1);}
try{
  const response=validateProviderResponse(decoded);report('response_schema',true);
  const checked=validateProductResult({...response,id:context.resultId,provider:context.provider,model:context.model,usage:null},
    context.expectedId,context,redact,textHash);
  for(const rule of checked.passedRules)report(rule,true);
}catch(error){
  if(error instanceof ProductValidationError){for(const rule of error.passedRules)report(rule,true);report(error.record.rule,false);}
  else report('product_processing',false);
  process.exitCode=1;
}
