/** Separate, additive grant profile. Existing notes/diagram/Investigate grants confer no Council rights. */
export type CouncilProvider='claude'|'codex'|'kiro';
export interface CouncilCap {unit:'usd'|'tokens'|'credits';amount:number;deadlineMs:number}
export interface CouncilGrant {v:1;profile:'council';project:string;session:string;providers:CouncilProvider[];caps:Partial<Record<CouncilProvider,CouncilCap>>;confirmed:string}
export const COUNCIL_DEFAULT_CAPS:Readonly<Record<CouncilProvider,CouncilCap>>=Object.freeze({claude:{unit:'usd',amount:0.5,deadlineMs:60000},codex:{unit:'tokens',amount:40000,deadlineMs:60000},kiro:{unit:'credits',amount:0.1,deadlineMs:60000}});
export function validCouncilGrant(v:unknown):v is CouncilGrant{
 if(!v||typeof v!=='object'||Array.isArray(v))return false;const g=v as CouncilGrant;
 return Object.keys(g).sort().join()==='caps,confirmed,profile,project,providers,session,v'&&g.v===1&&g.profile==='council'&&typeof g.project==='string'&&/^[a-f0-9]{16}$/.test(g.project)&&typeof g.session==='string'&&/^[a-f0-9-]{36}$/.test(g.session)&&typeof g.confirmed==='string'&&/^[a-f0-9]{64}$/.test(g.confirmed)&&Array.isArray(g.providers)&&g.providers.length>0&&g.providers.length<=3&&new Set(g.providers).size===g.providers.length&&g.providers.every(id=>['claude','codex','kiro'].includes(id))&&!!g.caps&&Object.keys(g.caps).sort().join()===g.providers.slice().sort().join()&&g.providers.every(id=>{const c=g.caps[id];return c&&Object.keys(c).sort().join()==='amount,deadlineMs,unit'&&c.unit===COUNCIL_DEFAULT_CAPS[id].unit&&Number.isFinite(c.amount)&&c.amount>0&&c.amount<=({usd:5,tokens:100000,credits:2}[c.unit])&&Number.isInteger(c.deadlineMs)&&c.deadlineMs>=100&&c.deadlineMs<=180000;});
}
