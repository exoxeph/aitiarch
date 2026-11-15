import {readFile,writeFile} from 'node:fs/promises';import {createHash} from 'node:crypto';import {spawnSync} from 'node:child_process';
const after=(text,marker,needle,replacement)=>{const at=text.indexOf(marker);if(at<0)throw Error('Missing section');return text.slice(0,at)+text.slice(at).replace(needle,replacement);};
const mutations=[
 ['conversation-requires-Claude','server/http.ts',s=>after(s,"if(url.pathname.startsWith('/api/conversation/')&&req.method==='PUT')",'if(!h)return','if(false)return')],
 ['investigate-requires-Claude','server/http.ts',s=>after(s,"if((url.pathname.startsWith('/api/harness/sessions/')",'if(!h)return','if(false)return')],
 ['diagram-review-requires-Claude','server/chat/runtime.ts',s=>s.replace("if(!this.harness)throw new ChatError('disabled');","if(false)throw new ChatError('disabled');")],
 ['council-no-tools','server/council.ts',s=>s.replace('tools:[] as string[]',"tools:['Read'] as string[]")],
 ['council-rejects-tool-input','server/council.ts',s=>s.replace("'caps','hash'].includes(k)","'caps','hash','tools','profile'].includes(k)")],
];
const hash=b=>createHash('sha256').update(b).digest('hex');
for(const [name,file,change]of mutations){const original=await readFile(file);try{const next=change(original.toString());if(next===original.toString())throw Error('Missing mutation target: '+name);await writeFile(file,next);const r=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run','test/council-http.test.ts'],{encoding:'utf8',timeout:30000});if(r.status!==1||!r.stdout.includes('failed'))throw Error('Mutation survived or did not reach assertions: '+name);console.log(name+': killed');}finally{await writeFile(file,original);if(hash(await readFile(file))!==hash(original))throw Error('Hash restore failed: '+name);console.log(name+': original hash restored');}}
