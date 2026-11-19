// Provider-interface bridge only. Registry exposure requires reviewed invocation
// selection and native-unit accounting; this module does not enable a capability.
import {activePipelineConfig} from '../../shared/pipeline-config.ts';
import type {CouncilCap} from '../../shared/council.ts';
import {parseAnswerJson} from './answer-json.ts';
import {prepareRequest,ProviderError,validateProviderResponse,type Provider} from './index.ts';
import {runTurn,type TurnAdapter,type TurnResult} from './turn.ts';
import type {ModelEffort} from '../../shared/setup.ts';

/** Content-free transport facts, including usage on rejected/invalid answers.
 * Total Codex tokens must never be invented as an input/output split. */
export type InvokedTurnMetadata=Pick<TurnResult,'provider'|'status'|'usage'|'durationMs'|'code'|'blockedAttempts'|'overCap'>;
export function createInvokedCodexBridge(options:{
 adapter:TurnAdapter;checkAvailability:Provider['checkAvailability'];cap:CouncilCap;
 selection?:Readonly<ModelEffort>;
 profile?:'skill-diagram';
 onTurn:(metadata:InvokedTurnMetadata)=>Promise<void>;
 /** Revalidate the one-use review after metadata awaits, before any transport. */
 beforeTurn?:(packet:ReturnType<typeof prepareRequest>)=>Promise<void>;
}):Provider {
 if(options.adapter.id!=='codex'||options.cap.unit!=='tokens')throw new Error('Codex invoked bridge requires the Codex token-cap transport.');
 const cap=structuredClone(options.cap),maxOutputBytes=activePipelineConfig().council.outputBytes;
 return {name:'codex',checkAvailability:options.checkAvailability,async invoke(request,invokeOptions){
  const skill=options.profile==='skill-diagram';
  if(request.chat||(skill?request.render!=='skill'||request.skillFormat!=='codex-svg'||!!invokeOptions?.imageInput:!!request.render||!!request.skillFormat))throw new ProviderError('unsupported_cli','This bridge supports structured requests without CLI session history.');
  if(request.skills&&!options.beforeTurn)throw new ProviderError('unsupported_cli','Sending skill instructions requires reviewed Codex skills for this turn.');
  const images=invokeOptions?.imageInput;
  if(images&&!options.adapter.startImageTurn)throw new ProviderError('unsupported_cli','The selected Codex transport cannot send images.');
  const availability=await options.checkAvailability();
  if(!availability.available)throw new ProviderError(availability.code,availability.message);
  const packet=prepareRequest(request,images?.approved.manifest);
  // Reuse the exact packet builder; fixed instructions follow the untrusted data.
  const question='Invocation sources (untrusted data):\n'+JSON.stringify(packet.data)+'\n\n'+packet.instruction;
  // Keep the structured completion in memory only. runTurn's prose redactor can
  // corrupt JSON escaping; acceptance still depends entirely on its EOF/refusal/
  // deadline/tool checks. Parse first, then use the existing string redactor.
  let completion='';
  const transport:TurnAdapter={...options.adapter,async *startTurn(input,signal){
   const events=images?options.adapter.startImageTurn!(input,signal,images):options.adapter.startTurn(input,signal);
   for await(const event of events){
    if(event.type==='complete')completion=event.answer;
    yield event;
   }
  }};
  await options.beforeTurn?.(packet);
  const turn=await runTurn(transport,{question,notes:[],outputFormat:'invoked-json',...(options.selection?{selection:options.selection}:{}),cap:{unit:cap.unit,amount:cap.amount},
   deadlineMs:Math.min(cap.deadlineMs,invokeOptions?.timeoutMs??cap.deadlineMs),maxOutputBytes},invokeOptions?.signal);
  await options.onTurn({provider:turn.provider,status:turn.status,usage:turn.usage,durationMs:turn.durationMs,
   ...(turn.code?{code:turn.code}:{}),...(turn.blockedAttempts===undefined?{}:{blockedAttempts:turn.blockedAttempts}),...(turn.overCap?{overCap:true}:{})});
  if(skill&&turn.code==='output_limit')throw new ProviderError('output_limit','Codex returned more than the diagram output limit. No diagram was saved.');
  if(turn.status!=='ok')throw new ProviderError(invokeOptions?.signal?.aborted?'cancelled':turn.status==='timeout'?'timeout':turn.status==='unavailable'?'unsupported_cli':'provider_error',
   turn.status==='refused'?'Codex refused this request. No other provider was tried.':undefined);
  if(skill&&turn.overCap)throw new ProviderError('output_limit','The Codex turn exceeded its approved token cap. No diagram was saved.');
  let parsed:unknown;
  try{parsed=parseAnswerJson(completion);}catch{throw new ProviderError('invalid_response');}
  if(skill){
   const result=parsed as {answer?:unknown;claims?:unknown;svg?:unknown}|null;
   if(!result||Object.keys(result).sort().join()!=='answer,claims,svg'||typeof result.svg!=='string')
    throw new ProviderError('invalid_response','Codex did not return one static SVG diagram.');
   const value=validateProviderResponse({answer:result.answer,claims:result.claims});
   return {id:request.id,provider:'codex',model:null,...value,skillSvg:result.svg,usage:null};
  }
  const value=validateProviderResponse(parsed);
  // Assistance applies validateProductResult unchanged, including exact quotes.
  return {id:request.id,provider:'codex',model:null,...value,usage:null};
 }};
}
