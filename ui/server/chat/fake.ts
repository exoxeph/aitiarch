import {ProviderError,type Provider,type Request,type Result,type InvokeOptions} from '../providers/index.ts';
/** Explicit synthetic stream; never launches an executable or contacts a provider. */
export class FakeChatProvider implements Provider {
 readonly demo=true as const;
 readonly name='claude' as const;
 requests:Request[]=[];
 answer:{answer:string;claims:unknown[]}={answer:'**Synthetic** reply.',claims:[]};
 async checkAvailability(){return {available:true as const};}
 async invoke(request:Request,options:InvokeOptions={}):Promise<Result>{
  this.requests.push(structuredClone(request));
  const json=JSON.stringify(this.answer),middle=Math.floor(json.length/2);
  for(const text of [json.slice(0,middle),json.slice(middle)]){
   if(options.signal?.aborted)throw new ProviderError('cancelled');
   options.onTextDelta?.(text);await Promise.resolve();
  }
  return {id:request.id,provider:'claude',model:null,...this.answer,usage:{inputTokens:20,cachedTokens:5,outputTokens:10}};
 }
}
