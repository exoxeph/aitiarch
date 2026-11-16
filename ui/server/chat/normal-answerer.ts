// Transport/validation boundary only. Product activation awaits stateless session history
// and native-unit budget/grant integration; runtime.ts fails closed in the meantime.
import {activePipelineConfig} from '../../shared/pipeline-config.ts';
import {prepareRequest,redact,type Request} from '../providers/index.ts';
import {runTurn,type TurnAdapter,type TurnResult} from '../providers/turn.ts';
import {validateProductResult,type ProductResult} from '../product-validation.ts';
import {hash} from './context.ts';

/** Same exact-provider check and product rules as the Claude path; no aliases or fallback. */
export function validateNormalChatResult(result:ProductResult,request:Request){
 return validateProductResult(result,request.id,request,redact,hash,activePipelineConfig().normalAnswerer);
}

/** Receives the already reviewed/redacted request, never a file path or transcript loader.
 * The adapters themselves are Council's existing instances, with their pinned safety policies.
 * No command, env, fence, permission, home or version logic is duplicated here. */
export async function normalChatTurn(request:Request,adapters:readonly TurnAdapter[],signal?:AbortSignal):Promise<TurnResult>{
 const config=activePipelineConfig(),id=config.normalAnswerer;
 if(id==='claude')throw new Error('Claude uses the existing chat runner');
 if(!request.chat||request.decisions.some(s=>! /^(?:O[1-9][0-9]*|T[1-9][0-9]*)$/.test(s.id)))throw new Error('Notes-only context required');
 const adapter=adapters.find(a=>a.id===id);
 if(!adapter)return {provider:id,safetyLabel:config.safetyLabels[id],status:'unavailable',code:'provider-unavailable',message:'The selected normal-chat provider is unavailable. No other provider was tried.',answer:'',usage:[],durationMs:0};
 const packet=prepareRequest(request),cap=config.council.caps[id];
 // Data first, fixed instruction last, as in the existing chat prompt. Council's adapter
 // adds its own tool-less instruction too; nothing here changes that assembly or its flags.
 const question=JSON.stringify(packet.data)+'\n\n'+packet.instruction;
 return runTurn(adapter,{question,notes:[...(request.note?[{id:'N1',label:'This note',text:redact(request.note)}]:[]),...(request.selection?[{id:'S1',label:'Selection',text:redact(request.selection)}]:[]),...request.decisions.map(s=>({...s,label:s.id,text:redact(s.text)}))],cap:{unit:cap.unit,amount:cap.amount},deadlineMs:cap.deadlineMs,maxOutputBytes:config.council.outputBytes},signal);
}
