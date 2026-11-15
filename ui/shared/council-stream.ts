import type {CouncilRun} from '../server/council-history.ts';
import type {TurnResult} from '../server/providers/turn.ts';
/** Only validated, redacted final answers cross this boundary; no raw provider deltas. */
export type CouncilStreamEvent =
 | {type:'provider_start';provider:string;run:CouncilRun}
 | {type:'provider_result';runId:string;result:TurnResult}
 | {type:'done';runId:string;finishedAt:string;ledgerUnavailable:boolean;historyUnavailable:boolean;pruned:number};
