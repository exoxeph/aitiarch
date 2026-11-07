import { createServer, type Server } from 'node:http';
import { createHash, randomBytes, randomUUID, createPublicKey, verify } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { Availability } from './capabilities.ts';
import { PlanVault } from './plan-vault.ts';
import { ProviderError, prepareRequest, validateProviderResponse, redact, type Provider, type Request, type InvokeOptions, type Result } from './index.ts';
import { validateProductResult, ProductValidationError } from '../product-validation.ts';
import { textHash } from '../anchor-cache.ts';

export const planScopes='openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const issuer='https://auth.openai.com',resource='https://api.openai.com/v1';
type SignInCode='state_mismatch'|'oauth_error'|'client_id_missing'|'client_id_mismatch'|'code_missing'|'token_exchange_failed'|'id_token_invalid'|'nonce_mismatch'|'subject_mismatch'|'scope_not_granted'|'credential_persist_failed'|'sign_in_timeout'|'cancelled';
interface SignInDiagnostics {listenerStarted:boolean;port:number|null;requestCount:number;paths:Record<string,number>;secondsFromBrowserOpen:number|null}
export class PlanSignInError extends ProviderError {
  readonly tokensSaved=false;
  readonly errorCode:SignInCode;
  constructor(errorCode:SignInCode){super(errorCode==='cancelled'?'cancelled':errorCode==='sign_in_timeout'?'timeout':'not_logged_in',errorCode==='scope_not_granted'?"ChatGPT plan use isn't enabled for this app":errorCode==='sign_in_timeout'?'ChatGPT sign-in timed out. No credentials were saved.':'ChatGPT sign-in could not be verified.');this.errorCode=errorCode;}
}
const hasDirectGrant=(scopes:unknown)=>Array.isArray(scopes)&&scopes.some(s=>s==='chatgpt.tokens.use.direct');
export interface PlanConfig { enabled?:boolean; configDirectory?:string; notebookRoot?:string; hourlyCap?:number; timeoutMs?:number; testOrigin?:string }
const safeName=(name:unknown)=>typeof name==='string'&&/^[a-z][a-z0-9_.]{0,79}$/.test(name)?name:'unknown';
const errors:Record<string,string>={
  subscription_sharing_usage_limit_exceeded:'ChatGPT plan usage limit reached. Review ChatGPT Settings → Usage. No retry was made.',
  subscription_sharing_user_not_eligible:'ChatGPT plan use is unavailable for this account, workspace or policy.',
  subscription_sharing_usage_unavailable:'ChatGPT usage availability could not be checked. Try later.',
  subscription_sharing_unsupported_capability:'This request uses a capability unsupported by ChatGPT plan use.',
  subscription_sharing_invalid_user:'ChatGPT account permission could not be validated. Check the connection.',
  subscription_sharing_route_not_supported:'This ChatGPT plan route is unsupported.',
  chatpass_v2_scope_not_authorized:'This ChatGPT permission grant does not authorize the request.',
  chatpass_v2_invalid_authorization_context:'This ChatGPT authorization context is invalid.',
  subscription_sharing_user_unavailable:'ChatGPT account or workspace information is temporarily unavailable.',
};
export class ChatGPTPlan implements Provider {
  readonly name='chatgpt-plan' as const;
  readonly vault:PlanVault;
  private config:PlanConfig;
  private authOrigin:string;
  private metadata:any;
  private listener?:Server;
  private cancelSignIn?:()=>void;
  private selectedModel:string|null=null;
  private models:string[]=[];
  private paused=false;
  private active=new Set<AbortController>();
  private authEpoch=0;
  private signInPending=false;
  private signInRejected=false;
  private pendingHost='urn:uuid:'+randomUUID();
  constructor(config:PlanConfig={}){
    this.config={...config};this.vault=new PlanVault(config.configDirectory,config.notebookRoot);
    if(config.testOrigin){const u=new URL(config.testOrigin);if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||u.origin!==config.testOrigin)throw new Error('Fake transport must be an explicit loopback origin.');}
    this.authOrigin=config.testOrigin??issuer;
  }
  private ensureEnabled(){if(!this.config.enabled)throw new ProviderError('unsupported_cli','ChatGPT plan provider is disabled. Enable it explicitly in server configuration.');}
  async checkAvailability():Promise<Availability>{
    try{this.ensureEnabled();await this.vault.check();const data=await this.vault.peek();
      if(this.signInPending||this.signInRejected||!data.access_token||!hasDirectGrant(data.scopes))return {available:false as const,code:'not_logged_in' as const,message:'ChatGPT plan is not connected or permission was not granted.'};
      if(!this.selectedModel)return {available:false as const,code:'unsupported_cli' as const,message:'Choose a model from this account’s catalog before sending.'};
      if(this.paused)return {available:false as const,code:'provider_error' as const,message:errors.subscription_sharing_usage_limit_exceeded};
      return {available:true as const};
    }catch{return {available:false as const,code:'unsupported_cli' as const,message:'ChatGPT plan disabled: configuration or protected storage could not be verified.'};}
  }
  private async fetch(url:string,init:RequestInit={},signal?:AbortSignal){
    this.ensureEnabled();const u=new URL(url);
    const permitted=this.config.testOrigin?u.origin===this.config.testOrigin:[issuer,'https://api.openai.com'].includes(u.origin);
    if(!permitted||u.username||u.password)throw new ProviderError('unsupported_cli','ChatGPT endpoint could not be verified.');
    return fetch(url,{...init,redirect:'error',signal:signal??AbortSignal.timeout(this.config.timeoutMs??30000)});
  }
  private async discovery(){
    if(this.metadata)return this.metadata;
    const response=await this.fetch(this.config.testOrigin?this.authOrigin+'/discovery':issuer+'/.well-known/openid-configuration');
    if(!response.ok)throw new ProviderError('provider_error','ChatGPT discovery failed.');
    const m=await response.json();
    if(m.issuer!==this.authOrigin)throw new ProviderError('unsupported_cli','ChatGPT issuer could not be verified.');
    for(const k of ['authorization_endpoint','token_endpoint','jwks_uri','revocation_endpoint'])if(typeof m[k]!=='string'||new URL(m[k]).origin!==this.authOrigin)throw new ProviderError('unsupported_cli','ChatGPT endpoint could not be verified.');
    if(!this.config.testOrigin&&(m.authorization_endpoint!==issuer+'/api/accounts/authorize'||m.token_endpoint!==issuer+'/api/accounts/oauth/token'))throw new ProviderError('unsupported_cli','ChatGPT OAuth endpoints differ from the reviewed contract.');
    this.metadata=m;return m;
  }
  async beginSignIn(){
    const diagnostics:SignInDiagnostics={listenerStarted:false,port:null,requestCount:0,paths:{},secondsFromBrowserOpen:null};
    let browserOpenedAt:number|undefined,callbackAt:number|undefined;
    const failureMetadata=()=>({...diagnostics,paths:{...diagnostics.paths},secondsFromBrowserOpen:browserOpenedAt===undefined?null:Math.max(0,Math.round(((callbackAt??Date.now())-browserOpenedAt)/1000))});
    try{
    this.ensureEnabled();if(this.signInPending)throw new ProviderError('provider_error','A ChatGPT sign-in is already pending.');
    const epoch=this.authEpoch;await this.vault.check();const meta=await this.discovery();
    const saved=await this.vault.peek();saved.ext_agent_host_id??=this.pendingHost;
    this.signInPending=true;
    const state=randomBytes(32).toString('base64url'),nonce=randomBytes(32).toString('base64url'),verifier=randomBytes(48).toString('base64url');
    let complete!:()=>void,reject!:(error:Error)=>void,consumed=false;
    const completed=new Promise<void>((resolve,fail)=>{complete=resolve;reject=fail;});void completed.catch(()=>{});
    const server=createServer(async(req,res)=>{
      const callback=new URL(req.url??'/',redirect);
      diagnostics.requestCount++;
      // Only fixed callback/browser paths are retained; never query strings or arbitrary path text.
      const requestPath=['/auth/callback','/favicon.ico','/'].includes(callback.pathname)?callback.pathname:'other';
      diagnostics.paths[requestPath]=(diagnostics.paths[requestPath]??0)+1;
      if(req.method!=='GET'||callback.pathname!=='/auth/callback'){res.writeHead(404).end();return;}
      if(consumed){res.writeHead(400).end('Sign-in attempt already used.');return;}
      consumed=true;
      callbackAt=Date.now();clearTimeout(timer);
      let token:any;
      try{
        if(callback.searchParams.get('state')!==state)throw new PlanSignInError('state_mismatch');
        if(callback.searchParams.has('error'))throw new PlanSignInError('oauth_error');
        const client=callback.searchParams.get('client_id')??saved.client_id;
        if(typeof client!=='string'||!client||client==='dynamic_agent_client')throw new PlanSignInError('client_id_missing');
        if(saved.client_id&&client!==saved.client_id)throw new PlanSignInError('client_id_mismatch');
        if(!callback.searchParams.get('code'))throw new PlanSignInError('code_missing');
        try{token=await this.token({grant_type:'authorization_code',client_id:client,code:callback.searchParams.get('code')!,code_verifier:verifier,redirect_uri:redirect,resource});}
        catch{throw new PlanSignInError('token_exchange_failed');}
        let identity:any;
        try{identity=await this.identity(token.id_token,client,nonce);}catch(e){throw e instanceof PlanSignInError?e:new PlanSignInError('id_token_invalid');}
        if(saved.subject&&saved.subject!==identity.sub)throw new PlanSignInError('subject_mismatch');
        const record=this.tokenRecord(token); // Exact grant from token response only, after identity validation.
        if(epoch!==this.authEpoch)throw new PlanSignInError('cancelled');
        try{await this.vault.locked(async()=>{if(epoch!==this.authEpoch)throw new PlanSignInError('cancelled');await this.vault.write({...saved,client_id:client,subject:identity.sub,issuer:meta.issuer,...record});});}
        catch(e){throw e instanceof PlanSignInError?e:new PlanSignInError('credential_persist_failed');}
        this.signInRejected=false;this.paused=false;this.signInPending=false;res.writeHead(200,{'Content-Type':'text/plain','Cache-Control':'no-store'}).end('ChatGPT connection completed. You can close this tab. Return to Aitiarch.');complete();
      }catch(e){
        this.signInRejected=true;this.selectedModel=null;
        if(token&&typeof token.refresh_token==='string'){
          try{await this.fetch(meta.revocation_endpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:token.refresh_token,token_type_hint:'refresh_token',client_id:callback.searchParams.get('client_id')??saved.client_id??''})});}catch{/* One best-effort revocation; no sensitive fallback. */}
        }
        let failure=e instanceof PlanSignInError?e:new PlanSignInError('id_token_invalid');
        try{await this.vault.discardCredentials();}catch{failure=new PlanSignInError('credential_persist_failed');}
        res.writeHead(400,{'Content-Type':'text/plain','Cache-Control':'no-store'}).end(failure.message+' You can close this tab. Return to Aitiarch.');reject(Object.assign(failure,{signInDiagnostics:failureMetadata()}));
      }
      finally{token=undefined;this.signInPending=false;clearTimeout(timer);server.close();this.listener=undefined;this.cancelSignIn=undefined;}
    });
    await new Promise<void>((resolve,fail)=>{server.once('error',fail);server.listen(0,'127.0.0.1',()=>resolve());});this.listener=server;
    diagnostics.listenerStarted=true;diagnostics.port=(server.address() as {port:number}).port;
    const redirect='http://127.0.0.1:'+(server.address() as {port:number}).port+'/auth/callback';
    const stop=(reason:'sign_in_timeout'|'cancelled')=>{this.authEpoch++;consumed=true;this.signInPending=false;this.signInRejected=true;server.closeAllConnections();server.close();this.listener=undefined;this.cancelSignIn=undefined;reject(Object.assign(new PlanSignInError(reason),{signInDiagnostics:failureMetadata()}));};
    let timer=setTimeout(()=>stop('sign_in_timeout'),300000);timer.unref();this.cancelSignIn=()=>{clearTimeout(timer);stop('cancelled');};
    const url=new URL(meta.authorization_endpoint);
    const params:Record<string,string>={client_id:saved.client_id??'dynamic_agent_client',ext_agent_host_id:saved.ext_agent_host_id,response_type:'code',redirect_uri:redirect,scope:planScopes,resource,state,nonce,code_challenge_method:'S256',code_challenge:createHash('sha256').update(verifier).digest('base64url')};
    if(!saved.client_id)params.agent_name_hint='Aitiarch';else if(saved.id_token)params.id_token_hint=saved.id_token;
    for(const [k,v]of Object.entries(params))url.searchParams.set(k,v);
    // The browser launcher marks this immediately before opening, once per attempt.
    const markBrowserOpened=()=>{if(browserOpenedAt!==undefined||consumed)return;browserOpenedAt=Date.now();clearTimeout(timer);timer=setTimeout(()=>stop('sign_in_timeout'),300000);timer.unref();};
    return {url:url.href,completed,markBrowserOpened}; // Never log the authorization URL.
    }catch(e){const failure=e instanceof ProviderError?e:new ProviderError('provider_error','ChatGPT sign-in could not be started.');throw Object.assign(failure,{signInDiagnostics:failureMetadata()});}
  }
  private async token(body:Record<string,string>){
    const meta=await this.discovery(),r=await this.fetch(meta.token_endpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(body)});
    if(!r.ok){let code='unknown';try{code=(await r.json()).error;}catch{}
      const e=new ProviderError('not_logged_in','ChatGPT token renewal or exchange failed.');
      if(['invalid_grant','invalid_refresh_token','token_expired','refresh_token_expired','refresh_token_invalidated','refresh_token_reused'].includes(code))Object.assign(e,{clearTokens:true});throw e;}
    return r.json();
  }
  private tokenRecord(token:any){
    if(typeof token.scope!=='string')throw new PlanSignInError('scope_not_granted');
    if(!['access_token','refresh_token','id_token'].every(k=>typeof token[k]==='string'&&token[k].length>0)||token.token_type!=='Bearer'||!Number.isFinite(token.expires_in)||token.expires_in<=0)throw new PlanSignInError('token_exchange_failed');
    const scopes=token.scope.split(/\s+/).filter(Boolean);
    if(!hasDirectGrant(scopes))throw new PlanSignInError('scope_not_granted');
    return {access_token:token.access_token,refresh_token:token.refresh_token,id_token:token.id_token,token_type:'Bearer',expires_in:token.expires_in,scopes,saved_at:new Date().toISOString()};
  }
  private async identity(jwt:unknown,client:string,nonce?:string){
    if(typeof jwt!=='string')throw new Error();const parts=jwt.split('.');if(parts.length!==3)throw new Error();
    const header=JSON.parse(Buffer.from(parts[0],'base64url').toString()),payload=JSON.parse(Buffer.from(parts[1],'base64url').toString());
    if(header.alg!=='RS256'||typeof header.kid!=='string'||header.crit)throw new Error();
    const meta=await this.discovery(),r=await this.fetch(meta.jwks_uri);if(!r.ok)throw new Error();
    const keys=(await r.json()).keys;if(!Array.isArray(keys))throw new Error();
    const candidates=keys.filter((k:any)=>k.kid===header.kid&&k.kty==='RSA'&&(!k.alg||k.alg==='RS256')&&(!k.use||k.use==='sig'));if(candidates.length!==1)throw new Error();
    if(!verify('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),createPublicKey({key:candidates[0],format:'jwk'}),Buffer.from(parts[2],'base64url')))throw new Error();
    const now=Date.now()/1000;
    if(!Number.isFinite(payload.exp)||!Number.isFinite(payload.iat)||(payload.nbf!==undefined&&!Number.isFinite(payload.nbf))||Array.isArray(payload.aud)&&payload.aud.length>1&&payload.azp!==client)throw new Error();
    if(payload.iss!==meta.issuer||!(Array.isArray(payload.aud)?payload.aud.includes(client):payload.aud===client)||typeof payload.exp!=='number'||payload.exp<=now||typeof payload.iat!=='number'||payload.iat>now+5||(payload.nbf!==undefined&&payload.nbf>now+5)||typeof payload.sub!=='string'||!payload.sub)throw new Error();
    if(nonce!==undefined&&payload.nonce!==nonce)throw new PlanSignInError('nonce_mismatch');
    return payload;
  }
  private withoutTokens(d:any){const {access_token,refresh_token,id_token,scopes,saved_at,expires_in,...registration}=d;return registration;}
  async refresh(){
    this.ensureEnabled();return this.vault.locked(async()=>{const d=await this.vault.read();if(!d.refresh_token||!d.client_id)throw new ProviderError('not_logged_in');
      try{const token=await this.token({grant_type:'refresh_token',client_id:d.client_id,refresh_token:d.refresh_token,resource});
        const identity=await this.identity(token.id_token,d.client_id);if(identity.sub!==d.subject)throw new Error();await this.vault.write({...d,...this.tokenRecord(token)});
      }catch(e){if((e as any).clearTokens)await this.vault.write(this.withoutTokens(d));throw new ProviderError('not_logged_in','ChatGPT refresh failed. No inference was sent.');}
    });
  }
  async signOut(){
    this.ensureEnabled();this.authEpoch++;this.cancelSignIn?.();this.paused=true;this.selectedModel=null;for(const controller of this.active)controller.abort();
    if(!Object.keys(await this.vault.peek()).length)return {revoked:true,message:'Signed out.'};
    return this.vault.locked(async()=>{const d=await this.vault.read();let revoked=!d.refresh_token;
      try{if(d.refresh_token){const meta=await this.discovery(),r=await this.fetch(meta.revocation_endpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:d.refresh_token,token_type_hint:'refresh_token',client_id:d.client_id})});revoked=r.status===200;}}
      catch{/* Local clearing still proceeds; never report native text or URL. */}
      finally{await this.vault.write(this.withoutTokens(d));}
      return {revoked,message:revoked?'Signed out.':'Signed out locally; remote revocation was not confirmed. Disconnect this app in ChatGPT Settings.'};
    });
  }
  private async accessToken(){const d=await this.vault.peek();if(this.signInPending||this.signInRejected||!d.access_token||!hasDirectGrant(d.scopes))throw new ProviderError('not_logged_in','ChatGPT plan permission is not enabled.');
    if(Date.parse(d.saved_at)+d.expires_in*1000<Date.now()+60000)await this.refresh();return (await this.vault.read()).access_token as string;
  }
  async listModels(){this.ensureEnabled();const token=await this.accessToken();const r=await this.fetch(this.config.testOrigin?this.authOrigin+'/models':resource+'/models',{headers:{Authorization:'Bearer '+token}});
    if(!r.ok)throw new ProviderError('provider_error','ChatGPT model catalog is unavailable.');const body=await r.json();
    if(!Array.isArray(body.models))throw new ProviderError('invalid_response');
    const models=body.models.filter((m:any)=>m.visibility==='list'&&typeof m.slug==='string'&&/^[\w.:-]{1,100}$/.test(m.slug)&&typeof m.display_name==='string');this.models=models.map((m:any)=>m.slug);return models.map((m:any)=>({slug:m.slug,display_name:m.display_name}));
  }
  setModel(model:string){if(!this.models.includes(model))throw new ProviderError('unsupported_cli','Select a model from the current account catalog.');this.selectedModel=model;}
  async status(){
    if(!this.config.enabled)return {enabled:false,connected:false,model:null,hourlyCap:2,welcome:false};
    await this.vault.check();const d=await this.vault.peek(),settings=await this.vault.peek('cap.json'),connected=!this.signInPending&&!this.signInRejected&&!!d.access_token&&hasDirectGrant(d.scopes);
    return {enabled:true,connected,model:this.selectedModel,hourlyCap:settings.limit??this.config.hourlyCap??2,welcome:connected&&!d.welcomeSeen};
  }
  async acknowledge(){await this.vault.locked(async()=>{const d=await this.vault.read();await this.vault.write({...d,welcomeSeen:true});});}
  async setHourlyCap(cap:number){if(!Number.isInteger(cap)||cap<1||cap>100)throw new ProviderError('context_limit','Hourly cap must be between 1 and 100.');await this.vault.locked(async()=>{const d=await this.vault.read('cap.json');await this.vault.write({...d,limit:cap},'cap.json');});}
  private async reserve(){await this.vault.locked(async()=>{const d=await this.vault.read('cap.json'),now=Date.now();const times=(Array.isArray(d.times)?d.times:[]).filter((n:any)=>typeof n==='number'&&n>now-3600000);
    if(times.length>=(d.limit??this.config.hourlyCap??2))throw new ProviderError('provider_error','Aitiarch’s hourly ChatGPT request cap was reached.');await this.vault.write({...d,times:[...times,now]},'cap.json');});}
  async invoke(request:Request,options:InvokeOptions={}):Promise<Result>{
    const start=performance.now(),counts:Record<string,number>={},fields:unknown[]=[];let status=0,rule='request',code='unknown';
    const own=new AbortController();this.active.add(own);
    const signal=AbortSignal.any([own.signal,AbortSignal.timeout(options.timeoutMs??this.config.timeoutMs??180000),...(options.signal?[options.signal]:[])]);
    try{
      this.ensureEnabled();const availability=await this.checkAvailability();if(!availability.available)throw new ProviderError(availability.code,availability.message);
      const packet=prepareRequest(request),token=await this.accessToken();
      const body={model:this.selectedModel,input:[{role:'user',content:JSON.stringify(packet.data)}],instructions:packet.instruction,store:false,stream:true};
      let response:Response|undefined;
      const attempts=options.retry503===false?1:3;
      for(let attempt=0;attempt<attempts;attempt++){
        await this.reserve();response=await this.fetch(this.config.testOrigin?this.authOrigin+'/responses':resource+'/responses',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)},signal);status=response.status;
        if(response.ok)break;
        let data:any;try{data=await response.json();}catch{}code=typeof data?.error?.code==='string'&&Object.hasOwn(errors,data.error.code)?data.error.code:'unknown';
        if(code==='subscription_sharing_usage_limit_exceeded')this.paused=true;
        if(code==='subscription_sharing_usage_limit_exceeded'||status!==503||attempt===attempts-1)throw new ProviderError('provider_error',errors[code]??'ChatGPT request was not accepted. No alternate billing path was used.');
        const value=response.headers.get('Retry-After');const retry=value===null?200*2**attempt:/^\d+(?:\.\d+)?$/.test(value)?Number(value)*1000:Math.max(0,Date.parse(value)-Date.now());
        if(!Number.isFinite(retry)||retry>5000)throw new ProviderError('provider_error','ChatGPT is temporarily unavailable. Retry later.');await delay(retry,undefined,{signal});
      }
      rule='stream';const {readPlanStream}=await import('./plan-stream.ts');const completed=await readPlanStream(response!,counts,fields);
      await this.vault.append('usage.jsonl',{at:new Date().toISOString(),provider:'chatgpt-plan',...completed.usage});
      rule='response_schema';const raw=JSON.parse(completed.text);
      if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).sort().join(',')!=='answer,claims'||!Array.isArray(raw.claims)||raw.claims.some((c:any)=>!c||typeof c!=='object'||Array.isArray(c)||Object.keys(c).sort().join(',')!=='quote,sourceId'))throw new ProviderError('invalid_response');
      const parsed=validateProviderResponse(raw);
      const result:Result={id:request.id,provider:'chatgpt-plan',model:completed.model,answer:parsed.answer,claims:parsed.claims,usage:{inputTokens:completed.usage.input,outputTokens:completed.usage.output}};
      rule='product';validateProductResult(result,request.id,packet.data,redact,textHash,'chatgpt-plan');
      return result;
    }catch(e){
      const streamCode=(e as {planCode?:unknown})?.planCode;
      if(typeof streamCode==='string'&&Object.hasOwn(errors,streamCode)){
        code=streamCode;if(code==='subscription_sharing_usage_limit_exceeded')this.paused=true;
        e=new ProviderError('provider_error',errors[code]);
      }
      if(e instanceof ProductValidationError)rule=e.record.rule;
      try{await this.vault.append('failures.jsonl',{rule,status,code:safeName(code),events:counts,fields,counts:e instanceof ProductValidationError?e.record.counts:null,wallMs:Math.round(performance.now()-start)});}catch{/* No sensitive fallback logs. */}
      if(options.signal?.aborted||own.signal.aborted)throw new ProviderError('cancelled');if(signal.aborted)throw new ProviderError('timeout');
      if(e instanceof ProductValidationError){const failure=new ProviderError('invalid_response','ChatGPT returned an invalid answer.');failure.validation=e.record;throw failure;}if(e instanceof ProviderError)throw e;throw new ProviderError('invalid_response');
    }finally{this.active.delete(own);}
  }
  async close(){this.authEpoch++;for(const controller of this.active)controller.abort();this.cancelSignIn?.();this.cancelSignIn=undefined;}
}
