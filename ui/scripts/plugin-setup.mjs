// Metadata by default; --copy-source is an explicit host-approved source copy.
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

export async function pluginSetup(argv,dependencies={}){
 const out=dependencies.out??console.log,err=dependencies.err??console.error;
 let project,copy=false,yesIgnore=false;
 const run=argv[0]==='run';if(run)argv=argv.slice(1);
 for(let i=0;i<argv.length;i++){
  if(argv[i]==='--copy-source'&&!copy){copy=true;continue;}
  if(argv[i]==='--yes-ignore'&&run&&!yesIgnore){yesIgnore=true;continue;}
  if(argv[i]==='--project'&&project===undefined&&argv[i+1]?.trim()&&!argv[i+1].startsWith('--')){project=argv[++i];continue;}
  err('Usage: node ui/scripts/plugin-setup.mjs [run] [--project <folder>] [--copy-source | --yes-ignore]');return 2;
 }
 if(run&&copy){err('run already performs the source-copy step.');return 2;}
 // Check before importing TypeScript: unsupported Node is a prerequisite, not a
 // reason to transpile/install another runtime or fall through to a loader error.
 const node=dependencies.nodeVersion??process.versions.node;
 if(!/^\d+\.\d+\.\d+$/.test(node)||Number(node.split('.')[0])<24){err('Install Node >=24 before Aitiarch setup.');return 1;}
 try{
  const {inspectPluginSetup}=await import('../server/platform/app-home.ts');
  const pluginRoot=fileURLToPath(new URL('../../',import.meta.url));
  const inspect=()=> (dependencies.inspect??inspectPluginSetup)({pluginRoot,
   project,cwd:dependencies.cwd??process.cwd(),env:dependencies.env??process.env,nodeVersion:node});
  const plan=await inspect();
  if(run){
   const {runPluginPlan}=await import('./plugin-run.mjs');
   const {copyPluginSource}=await import('./plugin-copy.mjs');
   const result=await runPluginPlan(plan,{pluginRoot,inspect,copySource:dependencies.copySource??copyPluginSource,
    runStep:dependencies.runStep,stamp:dependencies.stamp,env:dependencies.env??process.env,yesIgnore});
   out(JSON.stringify(result,null,2));return 0;
  }
  let copied;
  if(copy&&plan.buildRequired){
   const {copyPluginSource}=await import('./plugin-copy.mjs');
   copied=await (dependencies.copySource??copyPluginSource)(pluginRoot,plan.appHome);
  }
  out(JSON.stringify({...plan,...(copied?{copy:copied}:{})},null,2));return 0;
 }catch(e){err(`${e.code??'build_failed'}: ${e.message??'Setup metadata is unavailable.'}`);return 1;}
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)
 process.exitCode=await pluginSetup(process.argv.slice(2));
