// Which named conversation the chat panel has chosen, kept for this browser tab so a page reload comes back to the same conversation (its history is then loaded by its id).
// Only an id and the note it was started on are kept, never any text. The server is asked for the conversation as soon as the panel opens; one that is gone is simply dropped.
export interface ConversationChoice {id:string;home:string}
const KEY='aitiarch.chat.conversation';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** The choice written by an earlier page, or null when there is none or it is not a plain id and note path. */
export function readConversationChoice(store:Pick<Storage,'getItem'>|undefined=safeStorage()):ConversationChoice|null{
 try{const v=JSON.parse(store?.getItem(KEY)??'null');
  return v&&typeof v==='object'&&typeof v.id==='string'&&UUID.test(v.id)&&typeof v.home==='string'&&v.home.length>0&&v.home.length<=400&&!/[\u0000-\u001f]/.test(v.home)?{id:v.id,home:v.home}:null;}catch{return null;}
}
export function writeConversationChoice(choice:ConversationChoice|null,store:Pick<Storage,'setItem'|'removeItem'>|undefined=safeStorage()):void{
 try{if(choice)store?.setItem(KEY,JSON.stringify({id:choice.id,home:choice.home}));else store?.removeItem(KEY);}catch{/* storage may be off: the choice is then simply not kept */}
}
function safeStorage():Storage|undefined{try{return typeof sessionStorage==='undefined'?undefined:sessionStorage;}catch{return undefined;}}
