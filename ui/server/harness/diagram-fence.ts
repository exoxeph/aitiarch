// A conversation turn that may open diagram pictures is stopped by the app, or by the CLI's own cost cap. One error says which fence it was, in words that are safe to show
// (the words come from shared/diagram-fence.ts: never a path, a file name from the stream or any text of the reply).
import {FENCE_WORDS,type FenceCode} from '../../shared/diagram-fence.ts';
import {ProviderError} from '../providers/index.ts';

export class FenceStop extends ProviderError {
 readonly fence:FenceCode;
 /** What the CLI had spent when the turn was stopped, when it said (the cost cap). */
 costUsd?:number;
 constructor(fence:FenceCode,costUsd?:number){
  super('invalid_response');this.name='FenceStop';this.fence=fence;
  if(costUsd!==undefined)this.costUsd=costUsd;
  this.reason=fence==='budget'?{kind:'cost_cap'}:{kind:'unparseable',detail:FENCE_WORDS[fence]};
 }
}
