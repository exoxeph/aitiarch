import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const wrapper=fileURLToPath(new URL('../ui/scripts/aitiarch.mjs',import.meta.url));
const providers=['claude','codex','kiro'];
const roles=['normal-chat','invoked','thread-reply','council','investigate-read','skill-diagram'];
const codes=['found','not_found','invalid_override','metadata_compatible','profile_unverified','metadata_timeout','setup_unavailable'];
const pick=(value,allowed,fallback)=>allowed.includes(value)?value:fallback;
const version=value=>typeof value==='string'?value.match(/^\d{1,5}\.\d{1,5}\.\d{1,5}(?=$|[-+])/)?.[0]??null:null;
const number=value=>Number.isFinite(value)&&value>=0?Math.round(value):null;

// Project only known fields. Never write CLI paths, free-form messages, model IDs, stdout or stderr.
export function shareableDoctor(report){
 const rows=(value,field,allowed)=>Array.isArray(value)?allowed.flatMap(id=>{
  const row=value.find(item=>item?.[field]===id);
  return row?[row]:[];
 }):[];
 return {
  prerequisites:rows(report.checks,'id',['node','build','config']).map(({id,ok})=>({id,ok:ok===true})),
  providers:rows(report.providers,'id',providers).map(row=>({
   id:row.id,status:pick(row.code,codes,'metadata_failed'),version:version(row.version),
   effortFlag:typeof row.effort==='boolean'?row.effort:null,
   roles:roles.filter(role=>Array.isArray(row.roles)&&row.roles.includes(role)),
  })),
  models:rows(report.modelChecks,'id',providers).map(({id,result,count,timing})=>({
   id,result:result==='OK'?'ok':id==='kiro'?'unavailable':'unverified',count:number(count),
   spawnMs:number(timing?.spawnMs),initializeMs:number(timing?.initializeMs),listMs:number(timing?.listMs),
   stderr:pick(timing?.stderr,['empty','sign-in mentioned','redacted'],'unreported'),
  })),
 };
}

function run(models,cwd){
 const args=[wrapper,'doctor',...(models?['--models']:[]),'--json'];
 const child=spawnSync(process.execPath,args,{
  cwd,env:{...process.env,AITIARCH_CONFIG_DIR:cwd},shell:false,encoding:'utf8',
  timeout:360000,maxBuffer:1024*1024,stdio:['ignore','pipe','pipe'],
 });
 const status={exitCode:child.status};
 if(child.error)return {...status,error:child.error.code==='ETIMEDOUT'?'timed_out':'doctor_failed'};
 try{return {...status,...shareableDoctor(JSON.parse(child.stdout))};}
 catch{return {...status,error:'doctor_output_unavailable'};}
}

if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 const destination=path.resolve(process.argv[2]??'aitiarch-mac-report.json');
 const cwd=mkdtempSync(path.join(os.tmpdir(),'aitiarch-mac-doctor-'));
 const doctor=run(false,cwd),models=run(true,cwd);
 try{
  writeFileSync(destination,JSON.stringify({platform:process.platform,arch:process.arch,node:process.versions.node,doctor,models},null,2)+'\n',{flag:'wx',mode:0o600});
  console.log('Diagnostic report written. Review the JSON before sharing it.');
 }catch{
  console.error('Could not write the report. Choose a new output filename in a writable folder.');
  process.exitCode=1;
 }
 if(doctor.exitCode!==0||models.exitCode!==0||doctor.error||models.error)process.exitCode=1;
}
