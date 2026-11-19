import type {CouncilRun} from '../../server/council-history.ts';
import type {CouncilStreamEvent} from '../../shared/council-stream.ts';
export type CouncilViewRun=CouncilRun&{live?:boolean};
export function applyCouncilEvent(runs:CouncilViewRun[],event:CouncilStreamEvent):CouncilViewRun[]{
 if(event.type==='provider_start')return runs.some(r=>r.id===event.run.id)?runs:[...runs,{...event.run,live:true}];
 return runs.map(run=>{if(run.id!==event.runId)return run;if(event.type==='done')return {...run,finishedAt:event.finishedAt,live:false};const results=[...run.results.filter(r=>r.provider!==event.result.provider),event.result],order=run.providers?.map(p=>p.id)??results.map(r=>r.provider);return {...run,results:order.flatMap(id=>results.filter(r=>r.provider===id))};});
}
export async function replanCouncilCap<P>(body:any,amount:number,plan:(body:any)=>Promise<P>){if(!Number.isInteger(amount)||amount<1||amount>100000)throw Error('Codex token cap must be between 1 and 100000.');const next={...body,caps:{...body.caps,codex:{...body.caps.codex,amount}}};return {body:next,plan:await plan(next)};}
export function selectCouncilProvider(selected:string[],id:string,available:readonly {id:string;available:boolean}[]){if(!available.find(a=>a.id===id)?.available)return selected;if(selected.includes(id))return selected.length===1?selected:selected.filter(p=>p!==id);return [...selected,id];}
/** The server is authoritative on every send, including revocation after after-turn usage. No client approval cache. */
export async function runCouncil<P extends {hash:string;needsApproval:boolean;skillReviewId?:string},R>(io:{plan:(body:any)=>Promise<P>;approve:(body:any)=>Promise<unknown>;run:(body:any)=>Promise<R>;onReuseApproval?:()=>void},body:unknown,approved:boolean,reviewed?:P){
 const plan=approved&&reviewed?.skillReviewId?reviewed:await io.plan(body);
 if((plan.needsApproval&&!approved)||(plan.skillReviewId&&(!approved||plan!==reviewed)))return {kind:'plan' as const,plan};
 if(!plan.needsApproval&&!approved)io.onReuseApproval?.();
 if(plan.needsApproval)await io.approve({...body as object,hash:plan.hash});
 const send=plan.skillReviewId?{...body as object,skillReviewId:plan.skillReviewId,confirmSkills:true}:body;
 return {kind:'result' as const,result:await io.run(send)};
}
