// What the Delete conversation confirmation says: which note the conversation was started on and how many saved replies go with it. Pure; the numbers come from the server.
import {noteTitle} from './chat-stub.ts';

/** What the server says deleting would remove from the chat of the note the conversation was started on. */
export interface DeleteImpact {note:string|null;replies:number}

/** `impact` is null while the server is being asked, and 'failed' when it could not say. */
export function deleteConversationText(label:string,impact:DeleteImpact|'failed'|null):string{
 const head=`Delete “${label}”?`;
 if(impact===null)return `${head} Counting its saved replies…`;
 if(impact==='failed')return `${head} Its saved replies could not be counted. They are removed too, with Claude’s own record of the conversation and its questions.`;
 const from=impact.note?` It was started on ${noteTitle(impact.note)}.`:'';
 const n=impact.replies,replies=n===0?' It has no saved replies.':` ${n} saved ${n===1?'reply':'replies'} in that note’s chat ${n===1?'is':'are'} removed.`;
 return `${head}${from}${replies} Claude’s own record of the conversation and its questions are removed too.`;
}
