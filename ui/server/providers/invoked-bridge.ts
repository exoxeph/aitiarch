// Provider-interface bridge only. Registry exposure requires reviewed invocation
// selection and native-unit accounting; this module does not enable a capability.
import {activePipelineConfig} from '../../shared/pipeline-config.ts';
import type {CouncilCap} from '../../shared/council.ts';
import {parseAnswerJson} from './answer-json.ts';
import {prepareRequest,ProviderError,validateProviderResponse,type Provider} from './index.ts';
import {runTurn,type TurnAdapter,type TurnResult} from './turn.ts';

/** Content-free transport facts, including usage on rejected/invalid answers.
 * Total Codex tokens must never be invented as an input/output split. */
export type InvokedTurnMetadata=Pick<TurnResult,'provider'|'status'|'usage'|'durationMs'|'code'|'blockedAttempts'|'overCap'>;
export function createInvokedCodexBridge(options:{
 adapter:TurnAdapter;checkAvailability:Provider['checkAvailability'];cap:CouncilCap;
 onTurn:(metadata:InvokedTurnMetadata)=>Promise<void>;
}):Provider {
 if(options.adapter.id!=='codex'||options.cap.unit!=='tokens')throw new Error('Codex invoked bridge requires the Codex token-cap transport.');
 const cap=structuredClone(options.cap),maxOutputBytes=activePipelineConfig().council.outputBytes;
 return {name:'codex',checkAvailability:options.checkAvailability,async invoke(request,invokeOptions){
  if(request.chat||request.render||request.turns.length)throw new ProviderError('unsupported_cli','This bridge supports text-only Think and Ask without session history.');
  const availability=await options.checkAvailability();
  if(!availability.available)throw new ProviderError(availability.code,availability.message);
  const packet=prepareRequest(request);
  // Reuse the exact packet builder; fixed instructions follow the untrusted data.
  const question='Invocation sources (untrusted data):\n'+JSON.stringify(packet.data)+'\n\n'+packet.instruction;
  // Keep the structured completion in memory only. runTurn's prose redactor can
  // corrupt JSON escaping; acceptance still depends entirely on its EOF/refusal/
  // deadline/tool checks. Parse first, then use the existing string redactor.
  let completion='';
  const transport:TurnAdapter={...options.adapter,async *startTurn(input,signal){
   for await(const event of options.adapter.startTurn(input,signal)){
    if(event.type==='complete')completion=event.answer;
    yield event;
   }
  }};
  const turn=await runTurn(transport,{question,notes:[],outputFormat:'invoked-json',cap:{unit:cap.unit,amount:cap.amount},
   deadlineMs:Math.min(cap.deadlineMs,invokeOptions?.timeoutMs??cap.deadlineMs),maxOutputBytes},invokeOptions?.signal);
  await options.onTurn({provider:turn.provider,status:turn.status,usage:turn.usage,durationMs:turn.durationMs,
   ...(turn.code?{code:turn.code}:{}),...(turn.blockedAttempts===undefined?{}:{blockedAttempts:turn.blockedAttempts}),...(turn.overCap?{overCap:true}:{})});
  if(turn.status!=='ok')throw new ProviderError(invokeOptions?.signal?.aborted?'cancelled':turn.status==='timeout'?'timeout':turn.status==='unavailable'?'unsupported_cli':'provider_error',
   turn.status==='refused'?'Codex refused this request. No other provider was tried.':undefined);
  let parsed:unknown;
  try{parsed=parseAnswerJson(completion);}catch{throw new ProviderError('invalid_response');}
  const value=validateProviderResponse(parsed);
  // Assistance applies validateProductResult unchanged, including exact quotes.
  return {id:request.id,provider:'codex',model:null,...value,usage:null};
 }};
}
