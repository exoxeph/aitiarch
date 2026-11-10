import type {InvestigatorRunner,RunInput,RunResult} from '../../shared/investigator.ts';
/** Explicit fixture injection only; no discovery, subprocess or network. */
export class FakeInvestigator implements InvestigatorRunner {
 calls:RunInput[]=[];private results:unknown[];
 constructor(results:unknown[]){this.results=[...results];}
 async run(input:RunInput):Promise<RunResult>{this.calls.push(input);input.signal.throwIfAborted();const result=this.results.shift();if(!result)throw new Error('No fake result.');if(typeof (result as any).say==='string')input.emit({type:'text',text:(result as any).say});return {text:JSON.stringify(result),tokens:20,cost:null,turns:1};}
}
