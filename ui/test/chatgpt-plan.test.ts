import { createServer } from 'node:http';
import { generateKeyPairSync, randomBytes, sign, createHash } from 'node:crypto';
import { mkdtemp, rm, readFile, readdir, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { createApp } from '../server/http.ts';
import { Store } from '../server/store.ts';
import { NoteWatcher } from '../server/watch.ts';
import { ChatGPTPlan } from '../server/providers/chatgpt-plan.ts';

const faults=vi.hoisted(()=>({partialWrite:false}));
vi.mock('node:fs/promises',async(importOriginal)=>{
  const actual=await importOriginal<typeof import('node:fs/promises')>();
  return {...actual,writeFile:async(...args:Parameters<typeof actual.writeFile>)=>{
    if(faults.partialWrite&&String(args[0]).includes('.write-')){
      await actual.writeFile(args[0],'{',args[2]);throw Object.assign(new Error('Simulated disk failure'),{code:'ENOSPC'});
    }
    return actual.writeFile(...args);
  }};
});

// All credentials and signing keys are generated in RAM by this loopback fake.
// No account, real token, transcript, or recorded model output is a fixture.
const cleanup:(()=>Promise<void>)[]=[];
afterEach(async()=>{vi.restoreAllMocks();faults.partialWrite=false;for(const run of cleanup.splice(0).reverse())await run();});
const request={id:'synthetic',action:'think' as const,question:'',selection:'A synthetic sentence.',note:'A synthetic sentence.',decisions:[],turns:[]};
async function fixture(options:{enabled?:boolean;hourlyCap?:number;timeoutMs?:number}={}){
  const root=await mkdtemp(path.join(os.tmpdir(),'aitiarch-chatgpt-test-'));
  cleanup.push(()=>rm(root,{recursive:true,force:true}));
  const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
  const secret=()=>randomBytes(24).toString('base64url');
  const tokens:string[]=[],requests:{route:string;body:any;headers:any}[]=[];
  let origin='',nonce='',challenge='',refresh='',mode='success',refreshes=0,active=0,maxActive=0;
  const clientId='oaiapp_'+secret(),code=secret();
  const jwt=()=>{
    const header=Buffer.from(JSON.stringify({alg:'RS256',kid:'fake-key'})).toString('base64url');
    const body=Buffer.from(JSON.stringify({iss:origin,aud:clientId,sub:mode==='bad-subject'?'other-subject':'synthetic-subject',nonce,iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600,...(mode==='bad-nonce'?{nonce:'wrong'}:mode==='bad-audience'?{aud:'other'}:mode==='expired-id'?{exp:1}:mode==='bad-issuer'?{iss:'http://invalid.example'}:{})})).toString('base64url');
    const signature=sign('RSA-SHA256',Buffer.from(header+'.'+body),privateKey);if(mode==='bad-signature')signature[0]^=1;
    return header+'.'+body+'.'+signature.toString('base64url');
  };
  const issue=()=>{refresh=secret();const a=secret(),id=jwt();tokens.push(refresh,a,id);return {access_token:a,refresh_token:refresh,id_token:id,token_type:'Bearer',expires_in:3600,scope:mode==='absent-scope'?undefined:mode==='missing-direct-scope'?'openid profile email offline_access resource.invoke':mode==='substring-scope'?'chatgpt.tokens.use.directx':mode==='case-scope'?'CHATGPT.TOKENS.USE.DIRECT':mode==='extra-scope'?'openid\tchatgpt.tokens.use.direct\nextra.scope':'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct'};};
  const server=createServer(async(req,res)=>{
    const u=new URL(req.url!,origin);let raw='';for await(const c of req)raw+=c;
    const body=req.headers['content-type']?.startsWith('application/json')?JSON.parse(raw):Object.fromEntries(new URLSearchParams(raw));
    requests.push({route:u.pathname,body,headers:req.headers});
    const json=(value:unknown,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
    if(u.pathname==='/discovery')return json({issuer:origin,authorization_endpoint:origin+'/authorize',token_endpoint:origin+'/token',jwks_uri:origin+'/jwks',revocation_endpoint:origin+'/revoke'});
    if(u.pathname==='/jwks')return json({keys:[{...publicKey.export({format:'jwk'}),kid:'fake-key',alg:'RS256',use:'sig'}]});
    if(u.pathname==='/authorize'){
      nonce=u.searchParams.get('nonce')!;challenge=u.searchParams.get('code_challenge')!;
      const callback=new URL(u.searchParams.get('redirect_uri')!);callback.searchParams.set('code',code);callback.searchParams.set('state',mode==='bad-state'?'wrong':u.searchParams.get('state')!);callback.searchParams.set('client_id',clientId);
      callback.searchParams.set('scope','chatgpt.tokens.use.direct'); // Must never substitute for the token response grant.
      if(mode==='missing-client')callback.searchParams.delete('client_id');
      if(mode==='different-client')callback.searchParams.set('client_id','other-client');
      if(mode==='oauth-error')callback.searchParams.set('error','access_denied');
      res.writeHead(302,{Location:callback.href});return res.end();
    }
    if(u.pathname==='/token'){
      if(mode==='invalid-grant')return json({error:'invalid_grant'},400);
      if(body.grant_type==='authorization_code'){
        if(mode==='slow-code')await new Promise(r=>setTimeout(r,100));
        if(body.code!==code||body.client_id!==clientId||createHash('sha256').update(body.code_verifier).digest('base64url')!==challenge)return json({},400);
      }else{
        refreshes++;active++;maxActive=Math.max(maxActive,active);await new Promise(r=>setTimeout(r,30));active--;
        if(body.refresh_token!==refresh||body.scope!==undefined)return json({error:'invalid_grant'},400);
      }
      return json(issue());
    }
    if(u.pathname==='/revoke'){if(mode==='revoke-failure')return json({},503);expect(body.token).toBe(refresh);expect(body.token_type_hint).toBe('refresh_token');return res.writeHead(200).end();}
    if(u.pathname==='/models')return json({models:[{slug:'synthetic-model',display_name:'Synthetic',visibility:'list'}]});
    if(u.pathname==='/responses'){
      if(mode==='json-with-200')return json({error:{message:tokens[0]}},200);
      if(mode==='unsafe-content-type')return res.writeHead(200,{'Content-Type':'application/json; note="synthetic"'}).end(JSON.stringify({error:{message:tokens[0]}}));
      if(mode==='hang'){req.on('close',()=>res.destroy());return;}
      if(mode.startsWith('error:')){const [_,status,error]=mode.split(':');if(status==='503')res.setHeader('Retry-After',mode.split(':')[3]??'0');return json({error:{code:error,message:tokens[0]}},Number(status));}
      res.writeHead(200,mode==='absent-stream'?{'Set-Cookie':'private_cookie_sentinel=not_for_storage'}:{'Content-Type':'text/event-stream'});
      let sequence=0;const event=(value:any)=>res.write('data: '+JSON.stringify({...value,sequence_number:sequence++})+'\n\n');
      if(mode.startsWith('stream-error:')){event({type:'response.failed',response:{status:'failed',error:{code:mode.slice(13),message:tokens[0]}}});return res.end();}
      if(mode==='unknown')event({type:'response.unreviewed',text:tokens[0]});
      const answer=JSON.stringify({answer:'Synthetic answer.',claims:[{sourceId:'N1',quote:mode==='quote-mismatch'?'Absent.':request.selection,...(mode==='extra-claim'?{other:true}:{})}]});
      if(mode!=='empty')event({type:'response.output_text.delta',output_index:0,content_index:0,item_id:'synthetic-item',delta:answer});
      if(mode==='unknown-field')event({type:'response.output_text.delta',output_index:0,content_index:0,item_id:'synthetic-item',delta:'',secret:'bad'});
      if(mode!=='incomplete')event({type:'response.completed',response:{status:'completed',model:'synthetic-model',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:mode==='empty'?'':answer}]}],usage:{input_tokens:20,input_tokens_details:{cached_tokens:4},output_tokens:10,output_tokens_details:{reasoning_tokens:3}}}});
      return res.end();
    }
    json({},404);
  });
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+(server.address() as any).port;
  cleanup.push(async()=>{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));});
  const config={enabled:true,configDirectory:root,testOrigin:origin,hourlyCap:10,timeoutMs:1500,...options};
  const provider=new ChatGPTPlan(config);cleanup.push(()=>provider.close());
  const login=async()=>{
    const attempt=await provider.beginSignIn();
    const auth=await fetch(attempt.url,{redirect:'manual'});await fetch(auth.headers.get('location')!);
    await attempt.completed;await provider.listModels();provider.setModel('synthetic-model');
  };
  return {root,provider,config,login,requests,tokens,clientId,setMode:(v:string)=>{mode=v;},counts:()=>({refreshes,maxActive})};
}
it('disabled by default and startup/availability make no network requests',async()=>{
  const f=await fixture({enabled:false});await expect(f.provider.checkAvailability()).resolves.toMatchObject({available:false});expect(f.requests).toEqual([]);
  await expect(f.provider.beginSignIn()).rejects.toMatchObject({code:'unsupported_cli'});expect(f.requests).toEqual([]);
});
it('accepts headerless SSE, records absent, and never stores or forwards response cookies',async()=>{
  const f=await fixture();await f.login();f.setMode('absent-stream');
  await expect(f.provider.invoke(request)).resolves.toMatchObject({answer:'Synthetic answer.'});
  await expect(f.provider.invoke(request)).resolves.toMatchObject({answer:'Synthetic answer.'});
  const calls=f.requests.filter(r=>r.route==='/responses');expect(calls).toHaveLength(2);
  for(const call of calls){expect(call.headers.cookie).toBeUndefined();expect(call.headers['set-cookie']).toBeUndefined();}
  const usage=await readFile(path.join(f.root,'usage.jsonl'),'utf8');
  expect(usage.trim().split('\n').map(line=>JSON.parse(line).contentType)).toEqual(['absent','absent']);
  for(const file of await readdir(f.root)){
    const saved=await readFile(path.join(f.root,file),'utf8');
    expect(saved).not.toContain('private_cookie_sentinel');expect(saved).not.toContain('not_for_storage');
  }
});
it('sign-in rejects a missing direct-use scope before saving any credential tokens',async()=>{
  const f=await fixture();f.setMode('missing-direct-scope');
  const attempt=await f.provider.beginSignIn();
  const auth=await fetch(attempt.url,{redirect:'manual'});
  const failurePage=await fetch(auth.headers.get('location')!);
  const failureText=await failurePage.text();expect(failureText).toContain('You can close this tab.');
  for(const token of f.tokens)expect(failureText.includes(token)).toBe(false);
  let errorCode='none';
  try{await attempt.completed;}catch(error){errorCode=(error as {errorCode:string}).errorCode;}
  // Failure output contains booleans only, never even a fake credential value.
  const tokensSaved=(await readdir(f.root)).includes('credentials.json');
  expect({errorCode,tokensSaved}).toEqual({errorCode:'scope_not_granted',tokensSaved:false});
  expect(await f.provider.status()).toMatchObject({connected:false});
  expect(f.requests.filter(r=>r.route==='/revoke')).toHaveLength(1);
});

for(const [mode,errorCode] of [
  ['substring-scope','scope_not_granted'],['case-scope','scope_not_granted'],['absent-scope','scope_not_granted'],
  ['bad-signature','id_token_invalid'],['bad-nonce','nonce_mismatch'],['bad-audience','id_token_invalid'],
  ['expired-id','id_token_invalid'],['bad-issuer','id_token_invalid'],['missing-client','client_id_missing'],
  ['oauth-error','oauth_error'],['bad-state','state_mismatch'],
] as const)it(`saves nothing and stays disconnected on ${mode}`,async()=>{
  const f=await fixture();f.setMode(mode);const attempt=await f.provider.beginSignIn();
  expect(await readdir(f.root)).toEqual([]);
  const auth=await fetch(attempt.url,{redirect:'manual'});await fetch(auth.headers.get('location')!);
  await expect(attempt.completed).rejects.toMatchObject({errorCode,tokensSaved:false});
  if(errorCode==='scope_not_granted'){
    await expect(attempt.completed).rejects.toMatchObject({message:"ChatGPT plan use isn't enabled for this app"});
    expect(f.requests.filter(r=>r.route==='/revoke')).toHaveLength(1);
    expect(f.requests.findIndex(r=>r.route==='/jwks')<f.requests.findIndex(r=>r.route==='/revoke')).toBe(true);
  }
  if(['state_mismatch','oauth_error','client_id_missing'].includes(errorCode))expect(f.requests.some(r=>r.route==='/token')).toBe(false);
  expect((await readdir(f.root)).includes('credentials.json')).toBe(false);
  expect(await f.provider.status()).toMatchObject({connected:false});
  expect(await f.provider.checkAvailability()).toMatchObject({available:false});
  expect(await readdir(f.root)).toEqual([]);
});
it('accepts extra scopes and whitespace only with the exact required grant',async()=>{
  const f=await fixture();f.setMode('extra-scope');await f.login();expect(await f.provider.status()).toMatchObject({connected:true});
});
for(const [mode,errorCode]of [['bad-subject','subject_mismatch'],['different-client','client_id_mismatch']] as const)it(`reauthorization rejects ${mode} without retaining credentials`,async()=>{
  const f=await fixture();await f.login();f.setMode(mode);await expect(f.login()).rejects.toMatchObject({errorCode,tokensSaved:false});
  expect((await readdir(f.root)).includes('credentials.json')).toBe(false);expect(await f.provider.status()).toMatchObject({connected:false});
});
it('partial persistence failure removes the temporary file and never connects',async()=>{
  const f=await fixture();faults.partialWrite=true;
  await expect(f.login()).rejects.toMatchObject({errorCode:'credential_persist_failed',tokensSaved:false});
  expect(await readdir(f.root)).toEqual([]);expect(await f.provider.status()).toMatchObject({connected:false});
});
it('preflight uses a bound loopback callback, fresh OAuth secrets, and hints only on registration',async()=>{
  const f=await fixture();const first=await f.provider.beginSignIn(),a=new URL(first.url),callback=new URL(a.searchParams.get('redirect_uri')!);
  expect({host:callback.hostname,path:callback.pathname,port:Number(callback.port)>0,hint:a.searchParams.get('agent_name_hint')}).toEqual({host:'127.0.0.1',path:'/auth/callback',port:true,hint:'Aitiarch'});
  expect(await readdir(f.root)).toEqual([]);
  const auth=await fetch(first.url,{redirect:'manual'});const callbackPage=await fetch(auth.headers.get('location')!);await first.completed;
  expect(await callbackPage.text()).toContain('You can close this tab.');
  const exchange=f.requests.find(r=>r.route==='/token')!;expect(exchange.body.redirect_uri===callback.href).toBe(true);
  const second=await f.provider.beginSignIn(),b=new URL(second.url);
  expect(b.searchParams.has('agent_name_hint')).toBe(false);
  for(const key of ['state','nonce','code_challenge'])expect(a.searchParams.get(key)!==b.searchParams.get(key)).toBe(true);
  expect(a.searchParams.get('ext_agent_host_id')===b.searchParams.get('ext_agent_host_id')).toBe(true);
  await f.provider.close();await expect(second.completed).rejects.toMatchObject({code:'cancelled'});
});
it('rejects a callback after the five-minute window with no save and query-free timeout metadata',async()=>{
  const f=await fixture(),nativeTimeout=globalThis.setTimeout;let deadline!:()=>void,handle!:NodeJS.Timeout;
  vi.spyOn(globalThis,'setTimeout').mockImplementation(((callback:(...args:any[])=>void,ms?:number,...args:any[])=>{
    if(ms===300000){deadline=()=>callback(...args);handle=nativeTimeout(()=>{},ms);return handle;}
    return nativeTimeout(callback,ms,...args);
  }) as typeof setTimeout);
  const attempt=await f.provider.beginSignIn();
  const openedAt=Date.now();
  attempt.markBrowserOpened();
  const auth=await fetch(attempt.url,{redirect:'manual'}),callback=auth.headers.get('location')!,url=new URL(callback);
  await fetch(url.origin+'/favicon.ico?private=do-not-record-this');
  vi.spyOn(Date,'now').mockReturnValue(openedAt+300000);clearTimeout(handle);deadline();
  let failure:any;try{await attempt.completed;}catch(e){failure=e;}
  vi.restoreAllMocks();
  const lateCallbackReached=await fetch(callback).then(()=>true,()=>false);
  expect(lateCallbackReached).toBe(false);
  expect(failure).toMatchObject({errorCode:'sign_in_timeout',tokensSaved:false,signInDiagnostics:{listenerStarted:true,port:Number(url.port),requestCount:1,paths:{'/favicon.ico':1},secondsFromBrowserOpen:300}});
  expect(JSON.stringify(failure.signInDiagnostics)).not.toContain('do-not-record-this');
  expect(await readdir(f.root)).toEqual([]);
  expect(await f.provider.status()).toMatchObject({connected:false});
  expect(f.requests.some(r=>r.route==='/token')).toBe(false);
});
it('does full PKCE dynamic registration, stable host identity and strict inference',async()=>{
  const f=await fixture();await f.login();
  const result=await f.provider.invoke(request);expect(result).toMatchObject({provider:'chatgpt-plan',answer:'Synthetic answer.'});
  const sent=f.requests.find(r=>r.route==='/responses')!;
  expect(sent.body).toMatchObject({store:false,stream:true,model:'synthetic-model'});expect(sent.body).not.toHaveProperty('tools');expect(sent.body.instructions).toContain('"quote"');
  const persisted=JSON.parse(await readFile(path.join(f.root,'credentials.json'),'utf8'));
  expect(persisted.client_id).toBe(f.clientId);expect(persisted.ext_agent_host_id).toMatch(/^urn:uuid:/);
  const metrics=await readFile(path.join(f.root,'usage.jsonl'),'utf8');expect(JSON.parse(metrics)).toMatchObject({input:20,cached:4,output:10,reasoning:3});
  for(const token of f.tokens)expect(metrics.includes(token)).toBe(false);
});
it('serializes refresh rotation across two instances and retains one host',async()=>{
  const f=await fixture();await f.login();
  const second=new ChatGPTPlan(f.config);cleanup.push(()=>second.close());
  await Promise.all([f.provider.refresh(),second.refresh()]);expect(f.counts()).toEqual({refreshes:2,maxActive:1});
  const before=JSON.parse(await readFile(path.join(f.root,'credentials.json'),'utf8'));
  await f.provider.signOut();const after=JSON.parse(await readFile(path.join(f.root,'credentials.json'),'utf8'));
  expect(after.client_id).toBe(before.client_id);expect(after.ext_agent_host_id).toBe(before.ext_agent_host_id);
  for(const key of ['access_token','refresh_token','id_token'])expect(after).not.toHaveProperty(key);
  expect(f.requests.filter(r=>r.route==='/revoke')).toHaveLength(1);
});
for(const [status,code]of [[429,'subscription_sharing_usage_limit_exceeded'],[403,'subscription_sharing_user_not_eligible'],[503,'subscription_sharing_usage_unavailable'],[400,'subscription_sharing_unsupported_capability'],[401,'subscription_sharing_invalid_user'],[403,'subscription_sharing_route_not_supported'],[403,'chatpass_v2_scope_not_authorized'],[403,'chatpass_v2_invalid_authorization_context'],[503,'subscription_sharing_user_unavailable']] as const){
  it(`maps ${code} without leaking response text`,async()=>{
    const f=await fixture();await f.login();f.setMode(`error:${status}:${code}`);
    await expect(f.provider.invoke(request)).rejects.toMatchObject({code:'provider_error'});
    expect(f.requests.filter(r=>r.route==='/responses')).toHaveLength(status===503?3:1);
    const logs=await readFile(path.join(f.root,'failures.jsonl'),'utf8');for(const token of f.tokens)expect(logs.includes(token)).toBe(false);
  });
}
for(const mode of ['incomplete','empty','quote-mismatch','unknown','unknown-field','extra-claim','hang'])it(`fails closed on ${mode}`,async()=>{
  const f=await fixture();await f.login();f.setMode(mode);
  await expect(f.provider.invoke(request,{timeoutMs:400})).rejects.toMatchObject({code:mode==='hang'?'timeout':'invalid_response'});
});

it('persists the first stream rejection as names and types only',async()=>{
  const f=await fixture();await f.login();f.setMode('unknown-field');
  await expect(f.provider.invoke(request,{retry503:false})).rejects.toMatchObject({code:'invalid_response'});
  const log=await readFile(path.join(f.root,'failures.jsonl'),'utf8');
  expect(JSON.parse(log).streamRejection).toEqual({condition:'unexpected_field',event:'response.output_text.delta',field:'secret',fieldType:'string'});
  for(const value of [...f.tokens,request.note,'bad'])expect(log).not.toContain(value);
});
for(const [mode,value] of [['json-with-200','application/json'],['unsafe-content-type','unknown']])it(`persists safe HTTP header diagnostics without error-body text: ${mode}`,async()=>{
  const f=await fixture();await f.login();f.setMode(mode);
  await expect(f.provider.invoke(request,{retry503:false})).rejects.toMatchObject({code:'invalid_response'});
  const log=await readFile(path.join(f.root,'failures.jsonl'),'utf8');
  expect(JSON.parse(log).streamRejection).toEqual({condition:'content_type',observedContentType:value});
  for(const token of f.tokens)expect(log).not.toContain(token);
  expect(f.requests.filter(r=>r.route==='/responses')).toHaveLength(1);
});
it('refuses credentials in the repository or a notebook root before network',async()=>{
  const repo=new ChatGPTPlan({enabled:true,configDirectory:path.resolve('test','forbidden-chatgpt')});
  await expect(repo.checkAvailability()).resolves.toMatchObject({available:false});
  const root=await mkdtemp(path.join(os.tmpdir(),'aitiarch-chatgpt-test-'));cleanup.push(()=>rm(root,{recursive:true,force:true}));
  const nested=path.join(root,'.aitiarch','tokens');await mkdir(nested,{recursive:true});
  await expect(new ChatGPTPlan({enabled:true,configDirectory:nested}).checkAvailability()).resolves.toMatchObject({available:false});
  expect(await readdir(nested)).toEqual([]);
});
it('enforces the hourly cap without an automatic request',async()=>{
  const f=await fixture({hourlyCap:1});await f.login();await f.provider.invoke(request);
  await expect(f.provider.invoke({...request,id:'second'})).rejects.toMatchObject({code:'provider_error'});
  expect(f.requests.filter(r=>r.route==='/responses')).toHaveLength(1);
});

for(const mode of ['bad-nonce','bad-audience','bad-issuer','expired-id'])it(`rejects ${mode} before saving credentials`,async()=>{
  const f=await fixture();f.setMode(mode);await expect(f.login()).rejects.toMatchObject({code:'not_logged_in'});
  expect((await readdir(f.root)).includes('credentials.json')).toBe(false);
});
it('rejects callback state mismatch without exchanging the code',async()=>{
  const f=await fixture();f.setMode('bad-state');const attempt=await f.provider.beginSignIn();
  const redirect=await fetch(attempt.url,{redirect:'manual'});expect((await fetch(redirect.headers.get('location')!)).status).toBe(400);
  expect(f.requests.some(r=>r.route==='/token')).toBe(false);
});
it('clears local credentials even when revocation cannot be confirmed',async()=>{
  const f=await fixture();await f.login();f.setMode('revoke-failure');expect(await f.provider.signOut()).toMatchObject({revoked:false});
  const d=JSON.parse(await readFile(path.join(f.root,'credentials.json'),'utf8'));expect(d.refresh_token).toBeUndefined();
});
it('terminal refresh errors clear credentials without reusing the code',async()=>{
  const f=await fixture();await f.login();f.setMode('invalid-grant');await expect(f.provider.refresh()).rejects.toMatchObject({code:'not_logged_in'});
  const d=JSON.parse(await readFile(path.join(f.root,'credentials.json'),'utf8'));expect(d.refresh_token).toBeUndefined();expect(d.client_id).toBe(f.clientId);
});
it('cancellation fails closed and logs contain no request or authentication material',async()=>{
  const f=await fixture();await f.login();f.setMode('hang');const controller=new AbortController();
  const work=f.provider.invoke(request,{signal:controller.signal});setTimeout(()=>controller.abort(),40);await expect(work).rejects.toMatchObject({code:'cancelled'});
  const log=await readFile(path.join(f.root,'failures.jsonl'),'utf8');for(const secret of [...f.tokens,request.note,'Authorization','Bearer'])expect(log.includes(secret)).toBe(false);
});

it('connects through protected local routes and saves v2 ink/ledger without changing fixture Markdown',async()=>{
  const f=await fixture(),notes=path.join(f.root,'notes');await mkdir(notes);const file=path.join(notes,'fixture.md');
  const bytes=Buffer.from('\uFEFF'+request.note+'\r\n');const {writeFile}=await import('node:fs/promises');await writeFile(file,bytes);
  const store=await Store.open(notes),watcher=new NoteWatcher(store);
  const provider=new ChatGPTPlan({...f.config,notebookRoot:notes});cleanup.push(()=>provider.close());
  const app=createApp({store,watcher,distDir:path.join(f.root,'absent'),provider,plan:provider});const port=await app.listen(0);cleanup.push(()=>app.close());
  const origin='http://127.0.0.1:'+port,session=await fetch(origin+'/api/session'),cookie=session.headers.get('set-cookie')!.split(';')[0];
  const get=async(route:string)=>(await fetch(origin+route,{headers:{Cookie:cookie}})).json();
  const put=async(route:string,body:unknown={})=>fetch(origin+route,{method:'PUT',headers:{Cookie:cookie,Origin:origin,'X-Aitiarch':'1','Content-Type':'application/json'},body:JSON.stringify(body)});
  expect((await fetch(origin+'/api/chatgpt-plan/sign-in',{method:'PUT'})).status).toBe(401);
  const start=await (await put('/api/chatgpt-plan/sign-in')).json(),redirect=await fetch(start.url,{redirect:'manual'});await fetch(redirect.headers.get('location')!);
  expect(await get('/api/chatgpt-plan')).toMatchObject({connected:true,welcome:true,hourlyCap:10});
  await put('/api/chatgpt-plan/acknowledge');expect(await get('/api/chatgpt-plan')).toMatchObject({welcome:false});
  const models=await (await put('/api/chatgpt-plan/models')).json();expect(models).toHaveLength(1);
  await put('/api/chatgpt-plan/settings',{model:models[0].slug,hourlyCap:2});
  expect(await get('/api/assistance')).toMatchObject({available:true,provider:'chatgpt-plan'});
  const invocation={id:'http-fixture',path:'fixture.md',action:'think',question:'',text:request.note+'\n',from:0,to:request.note.length};
  expect((await put('/api/assistance/invoke',invocation)).status).toBe(202);
  for(let i=0;i<100;i++){if((await get('/api/assistance/status?id=http-fixture')).status==='complete')break;await new Promise(r=>setTimeout(r,10));}
  const ink=await get('/api/ink?path=fixture.md');expect(ink.document.items[0].generation).toMatchObject({provider:'chatgpt-plan',status:'complete'});
  await put('/api/assistance/event',{path:'fixture.md',id:'http-fixture',event:'shown'});
  expect(JSON.parse(await readFile(path.join(notes,'ledger.json'),'utf8')).events).toHaveLength(1);
  expect(await readFile(file)).toEqual(bytes);
  const persisted=JSON.stringify(ink)+await readFile(path.join(notes,'ledger.json'),'utf8');for(const token of f.tokens)expect(persisted.includes(token)).toBe(false);
  for(const field of ['takeaway','failedReason','failed-reason','why'])expect(persisted).not.toContain('"'+field+'"');
});

it('honors a long Retry-After by stopping rather than retrying early',async()=>{
  const f=await fixture();await f.login();f.setMode('error:503:subscription_sharing_usage_unavailable:30');
  await expect(f.provider.invoke(request)).rejects.toMatchObject({code:'provider_error'});expect(f.requests.filter(r=>r.route==='/responses')).toHaveLength(1);
});
for(const code of ['subscription_sharing_usage_limit_exceeded','subscription_sharing_user_not_eligible','subscription_sharing_usage_unavailable'])it(`maps streamed ${code} without logging its message or retrying`,async()=>{
  const f=await fixture();await f.login();f.setMode('stream-error:'+code);
  await expect(f.provider.invoke(request)).rejects.toMatchObject({code:'provider_error'});
  const log=await readFile(path.join(f.root,'failures.jsonl'),'utf8');expect(JSON.parse(log).code).toBe(code);for(const token of f.tokens)expect(log).not.toContain(token);
  expect(f.requests.filter(r=>r.route==='/responses')).toHaveLength(1);
});

it('cannot resurrect tokens when sign-out interrupts an in-flight sign-in',async()=>{
  const f=await fixture();f.setMode('slow-code');const attempt=await f.provider.beginSignIn();
  const redirect=await fetch(attempt.url,{redirect:'manual'});const callback=fetch(redirect.headers.get('location')!).catch(()=>null);
  for(let i=0;i<100&&!f.requests.some(r=>r.route==='/token');i++)await new Promise(r=>setTimeout(r,5));
  await f.provider.signOut();await expect(attempt.completed).rejects.toMatchObject({code:'cancelled'});await callback;await new Promise(r=>setTimeout(r,200));
  expect((await readdir(f.root)).includes('credentials.json')).toBe(false);
});

it('can enforce exactly one HTTP attempt for a separately approved live check',async()=>{
  const f=await fixture();await f.login();f.setMode('error:503:subscription_sharing_usage_unavailable');
  await expect(f.provider.invoke(request,{retry503:false})).rejects.toMatchObject({code:'provider_error'});expect(f.requests.filter(r=>r.route==='/responses')).toHaveLength(1);
});
