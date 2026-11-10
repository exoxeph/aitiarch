/** Investigator is opt-in and independent of the isolated chat provider. */
export type AgentName='claude'|'codex';
export interface Delegation {id:string;kind:'lookup'|'agent';agent:AgentName;task:string;scope:string[];why:string}
export interface MotherEnvelope {say:string;delegate:Delegation[]}
export interface AgentReport {findings:{claim:string;evidence:{path:string;lines:[number,number]}[]}[];unknowns:string[];files_read:string[]}
export type Tier='inside'|'outside'|'commands';
export type Permission='ask'|'chat'|'notebook';
export interface InvestigatorSettings {concurrency:number;depth:number;turns:number;timeoutMs:number;delegations:number;tokens:number}
export const DEFAULT_INVESTIGATOR:Readonly<InvestigatorSettings>=Object.freeze({concurrency:3,depth:1,turns:12,timeoutMs:180000,delegations:6,tokens:100000});
export interface InvestigatorPolicy {v:1;enabled:boolean;roots:string[];tiers:Record<Tier,Permission>;outsideEnabled:boolean;commands:string[];settings:InvestigatorSettings}
export type InvestigatorCode='invalid_envelope'|'invalid_report'|'invalid_policy'|'disabled'|'permission_required'|'blocked'|'budget'|'cancelled'|'timeout'|'format_changed'|'provider_failed'|'audit_failed'|'busy';
export class InvestigatorError extends Error {code:InvestigatorCode;constructor(code:InvestigatorCode){super(code==='blocked'?'Blocked: raise policy to retry':code);this.code=code;}}
export type RunEvent={type:'text';text:string}|{type:'thinking';text:string;label:'CLI-emitted thinking'}|{type:'status';name:string}|{type:'tool';tool:string;target:string;resultBytes:number};
export type InvestigatorEvent=
 |{type:'start';source:string;role:'mother'|'agent'|'lookup'}
 |({source:string}&RunEvent)
 |{type:'report';source:string;report:AgentReport;untrusted:true}
 |{type:'complete';source:'mother';say:string}
 |{type:'error';source:string;code:InvestigatorCode}
 |{type:'permission';source:string;tier:Tier;target:string};
export interface RunInput {role:'mother'|'agent';input:unknown;signal:AbortSignal;emit:(event:RunEvent)=>void;cwd:string;maxTokens:number;turns:number;timeoutMs:number}
export interface RunResult {text:string;tokens:number|null;cost:number|null;turns:number}
export interface InvestigatorRunner {run(input:RunInput):Promise<RunResult>}
const obj=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v);
export const exact=(v:unknown,keys:string[])=>obj(v)&&Object.keys(v).sort().join()===keys.sort().join();
const text=(v:unknown,n:number)=>typeof v==='string'&&v.length<=n&&!v.includes('\0');
const list=(v:unknown,n:number,max:number):v is string[]=>Array.isArray(v)&&v.length<=n&&v.every(s=>text(s,max));
export const safeId=(v:unknown):v is string=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(v);
export function validateEnvelope(raw:unknown,maxDelegations=DEFAULT_INVESTIGATOR.delegations):MotherEnvelope {
 const fail=()=>{throw new InvestigatorError('invalid_envelope');};
 if(!exact(raw,['say','delegate']))return fail();const d=raw as MotherEnvelope;
 if(!text(d.say,16000)||!Array.isArray(d.delegate)||d.delegate.length>20)return fail();
 if(d.delegate.length>maxDelegations)return fail();
 const ids=new Set<string>();for(const x of d.delegate){if(!exact(x,['id','kind','agent','task','scope','why'])||!safeId(x.id)||ids.has(x.id)||!['lookup','agent'].includes(x.kind)||!['claude','codex'].includes(x.agent)||!text(x.task,8000)||!x.task.trim()||!list(x.scope,20,400)||!x.scope.length||!text(x.why,1000))return fail();ids.add(x.id);}return structuredClone(d);
}
export function validateReport(raw:unknown):AgentReport {
 const fail=()=>{throw new InvestigatorError('invalid_report');};
 if(!exact(raw,['findings','unknowns','files_read']))return fail();const r=raw as AgentReport;
 if(JSON.stringify(r).length>64000||!Array.isArray(r.findings)||r.findings.length>40||!list(r.unknowns,30,2000)||!list(r.files_read,100,400))return fail();
 for(const f of r.findings){if(!exact(f,['claim','evidence'])||!text(f.claim,4000)||!Array.isArray(f.evidence)||f.evidence.length>20)return fail();for(const e of f.evidence)if(!exact(e,['path','lines'])||!text(e.path,400)||!Array.isArray(e.lines)||e.lines.length!==2||e.lines.some(n=>!Number.isSafeInteger(n)||n<1)||e.lines[1]<e.lines[0])return fail();}return structuredClone(r);
}
export function validateSettings(raw:unknown):InvestigatorSettings {
 if(!exact(raw,Object.keys(DEFAULT_INVESTIGATOR)))throw new InvestigatorError('invalid_policy');const s=raw as InvestigatorSettings;
 const caps:InvestigatorSettings={concurrency:6,depth:1,turns:12,timeoutMs:180000,delegations:20,tokens:1000000};
 for(const k of Object.keys(caps) as (keyof InvestigatorSettings)[])if(!Number.isSafeInteger(s[k])||s[k]<1||s[k]>caps[k])throw new InvestigatorError('invalid_policy');return {...s};
}
export function validatePolicy(raw:unknown):InvestigatorPolicy {
 if(!exact(raw,['v','enabled','roots','tiers','outsideEnabled','commands','settings']))throw new InvestigatorError('invalid_policy');const p=raw as InvestigatorPolicy;
 if(p.v!==1||typeof p.enabled!=='boolean'||typeof p.outsideEnabled!=='boolean'||!list(p.roots,10,1000)||!p.roots.length||!list(p.commands,20,80)||!exact(p.tiers,['inside','outside','commands'])||Object.values(p.tiers).some(v=>!['ask','chat','notebook'].includes(v)))throw new InvestigatorError('invalid_policy');
 validateSettings(p.settings);return structuredClone(p);
}
