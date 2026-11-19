import assert from 'node:assert/strict';
import {it} from 'node:test';
import {shareableDoctor} from './mac-doctor.mjs';

it('projects doctor data without copying paths, tokens or CLI-controlled prose',()=>{
 const secret='synthetic-token-123456789';
 const report=shareableDoctor({
  checks:[{id:'node',ok:true,reason:secret}],
  providers:[{id:'codex',path:'/Users/synthetic/.local/bin/codex',code:secret,version:'0.167.0-'+secret,reason:secret,roles:['council',secret]}],
  modelChecks:[{id:'codex',result:secret,count:8,timing:{spawnMs:1.5,listMs:35,stderr:secret}}],
 });
 assert.deepEqual(report,{
  prerequisites:[{id:'node',ok:true}],
  providers:[{id:'codex',status:'metadata_failed',version:'0.167.0',effortFlag:null,roles:['council']}],
  models:[{id:'codex',result:'unverified',count:8,spawnMs:2,initializeMs:null,listMs:35,stderr:'unreported'}],
 });
 assert.doesNotMatch(JSON.stringify(report),/synthetic|\/Users\//);
});
