import {Store} from '../store.ts';import {InsertionStore,type BringPreview} from '../insertion-store.ts';import {ChatStore} from './store.ts';
import {previewAiCallout} from '../../shared/thoughts.ts';import {secretKinds} from './secrets.ts';import {ChatError} from './runtime.ts';
import {hash} from './context.ts';
/** `path` is the note the reply is added to. `chat` is the note whose chat holds the reply when that is another note: a conversation follows the person from note to note
 *  and keeps its replies under the note it was started on, so a reply written while another note was open is added to that open note from there. */
export interface ChatBringInput {path:string;id:string;noteVersion:string;after:number;chat?:string}
export class ChatInsertion {
 private store:Store;private chats:ChatStore;private insertions:InsertionStore;
 constructor(store:Store,chats:ChatStore,insertions:InsertionStore){this.store=store;this.chats=chats;this.insertions=insertions;}
 private async build(input:ChatBringInput){
  const note=await this.store.read(input.path);if(note.version!==input.noteVersion)throw new ChatError('stale_review');
  if(input.chat!==undefined&&typeof input.chat!=='string')throw new ChatError('invalid_chat');
  const message=(await this.chats.read(input.chat??input.path)).messages.find(m=>m.id===input.id);
  if(!message)throw new ChatError('invalid_chat');
  if(message.insertionBlocked||secretKinds(message.body).length)throw new ChatError('secrets_blocked');
  return {note,preview:previewAiCallout(note,message.body,input.after)};
 }
 async preview(input:ChatBringInput){return (await this.build(input)).preview;}
 async prepare(input:ChatBringInput&{preview:BringPreview}){
  const {note,preview}=await this.build(input);if(JSON.stringify(preview)!==JSON.stringify(input.preview))throw new ChatError('stale_review');
  return this.insertions.prepareChat(note,'chat-'+hash(input.path+'\0'+input.id),preview);
 }
 complete(note:string,id:string){return this.insertions.complete(note,id);}
 reconcile(note:string){return this.insertions.reconcile(note);}
 cancel(note:string,id:string){return this.insertions.cancel(note,id);}
}
