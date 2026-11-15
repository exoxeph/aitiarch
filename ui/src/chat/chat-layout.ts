/** Where the chat panel sits. Overlay is the default: a raised layer over the note and the AI thoughts that never changes their layout.
 *  Pinned docks it beside them, the way it always worked. Both choices are remembered in this browser only; neither is sent anywhere. */
export const CHAT_MIN_WIDTH=380,CHAT_DEFAULT_RATIO=.45,CHAT_MAX_RATIO=.9,CHAT_SHEET_BELOW=700;
const PIN_KEY='aitiarch.chat.pinned',WIDTH_KEY='aitiarch.chat.width';
/** The width the panel gets for a window this wide: the remembered one, else about 45%; never under the minimum or over 90% of the window. */
export function clampChatWidth(width:number|null,windowWidth:number):number{
 const max=Math.max(CHAT_MIN_WIDTH,Math.floor(windowWidth*CHAT_MAX_RATIO)),want=width??Math.round(windowWidth*CHAT_DEFAULT_RATIO);
 return Math.min(max,Math.max(CHAT_MIN_WIDTH,Math.round(want)));
}
export const isSheet=(windowWidth:number)=>windowWidth<CHAT_SHEET_BELOW;
export function loadPinned(storage:Pick<Storage,'getItem'>|undefined=safe()):boolean{try{return storage?.getItem(PIN_KEY)==='1';}catch{return false;}}
export function savePinned(pinned:boolean,storage:Pick<Storage,'setItem'>|undefined=safe()){try{storage?.setItem(PIN_KEY,pinned?'1':'0');}catch{/* private window: the choice just is not remembered */}}
export function loadChatWidth(storage:Pick<Storage,'getItem'>|undefined=safe()):number|null{try{const raw=storage?.getItem(WIDTH_KEY);if(raw==null)return null;const n=Number(raw);return Number.isFinite(n)&&n>=CHAT_MIN_WIDTH&&n<=10000?Math.round(n):null;}catch{return null;}}
export function saveChatWidth(width:number,storage:Pick<Storage,'setItem'>|undefined=safe()){try{storage?.setItem(WIDTH_KEY,String(Math.round(width)));}catch{/* not remembered */}}
function safe():Storage|undefined{try{return typeof localStorage==='undefined'?undefined:localStorage;}catch{return undefined;}}
