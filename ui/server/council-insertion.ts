import {Store} from './store.ts';import {InsertionStore} from './insertion-store.ts';
import {previewAiCallout} from '../shared/thoughts.ts';import {secretKinds} from './chat/secrets.ts';import {hash} from './chat/context.ts';
import type {CouncilRecord} from './council-history.ts';
/** Adds one model's finished Council answer to the note as an AI-marked callout, the same way a normal chat reply is added.
 *  `path` is the note, `after` a character offset in it. Completion and cancel reuse the chat bring-complete/bring-cancel routes. */
export interface CouncilBringInput {path:string;conversation:string;runId:string;provider:string;noteVersion:string;after:number}
type History=(conversation:string)=>Promise<CouncilRecord>;
const NAMES:Record<string,string>={claude:'Claude',codex:'Codex',kiro:'Kiro'};
export class CouncilInsertion {
 private store:Store;private insertions:InsertionStore;
 constructor(store:Store,insertions:InsertionStore){this.store=store;this.insertions=insertions;}
 private async build(input:CouncilBringInput,history:History){
  if(![input?.path,input?.conversation,input?.runId,input?.provider,input?.noteVersion].every(v=>typeof v==='string'&&v.length>0)||!Number.isSafeInteger(input.after))throw new Error('invalid_bring');
  const note=await this.store.read(input.path);if(note.version!==input.noteVersion)throw new Error('stale_review');
  const run=(await history(input.conversation)).runs.find(r=>r.id===input.runId),result=run?.results.find(r=>r.provider===input.provider);
  if(!result||result.status!=='ok'||!result.answer.trim())throw new Error('no_answer');
  if(secretKinds(result.answer).length)throw new Error('secrets_blocked');
  const name=NAMES[input.provider]??input.provider;
  return {note,preview:previewAiCallout(note,`${name}, answering in Council:\n\n${result.answer.trim()}`,input.after)};
 }
 async preview(input:CouncilBringInput,history:History){return (await this.build(input,history)).preview;}
 async prepare(input:CouncilBringInput&{preview:unknown},history:History){
  const {note,preview}=await this.build(input,history);if(JSON.stringify(preview)!==JSON.stringify(input.preview))throw new Error('stale_review');
  return this.insertions.prepareChat(note,'council-'+hash(input.path+'\0'+input.conversation+'\0'+input.runId+'\0'+input.provider),preview);
 }
}
