import {Store} from './store.ts';import {InsertionStore} from './insertion-store.ts';
import {previewAiCallout} from '../shared/thoughts.ts';import {secretKinds} from './chat/secrets.ts';import {hash} from './chat/context.ts';
/** Adds a finished Investigate answer to the note as an AI-marked callout, the same way a chat reply is added.
 *  `path` is the note, `after` a character offset in it. Completion and cancel reuse the chat bring-complete/bring-cancel routes. */
export interface InvestigateBringInput {path:string;session:string;turn:string;noteVersion:string;after:number}
type Turns=(session:string)=>Promise<{id:string;message?:{body:string}}[]>;
export class InvestigateInsertion {
 private store:Store;private insertions:InsertionStore;
 constructor(store:Store,insertions:InsertionStore){this.store=store;this.insertions=insertions;}
 private async build(input:InvestigateBringInput,turns:Turns){
  if(![input?.path,input?.session,input?.turn,input?.noteVersion].every(v=>typeof v==='string'&&v.length>0)||!Number.isSafeInteger(input.after))throw new Error('invalid_bring');
  const note=await this.store.read(input.path);if(note.version!==input.noteVersion)throw new Error('stale_review');
  const body=(await turns(input.session)).find(t=>t.id===input.turn||(t as any).message?.id===input.turn)?.message?.body;
  if(!body?.trim())throw new Error('no_answer');
  if(secretKinds(body).length)throw new Error('secrets_blocked');
  return {note,preview:previewAiCallout(note,body.trim(),input.after)};
 }
 async preview(input:InvestigateBringInput,turns:Turns){return (await this.build(input,turns)).preview;}
 async prepare(input:InvestigateBringInput&{preview:unknown},turns:Turns){
  const {note,preview}=await this.build(input,turns);if(JSON.stringify(preview)!==JSON.stringify(input.preview))throw new Error('stale_review');
  return this.insertions.prepareChat(note,'investigate-'+hash(input.path+'\0'+input.session+'\0'+input.turn),preview);
 }
}
