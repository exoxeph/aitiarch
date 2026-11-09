import {Prec,StateEffect,StateField,type EditorState,type Transaction} from '@codemirror/state';
import {EditorView,keymap} from '@codemirror/view';
import {syntaxTree} from '@codemirror/language';
import {insertNewlineAndIndent,isolateHistory,undo} from '@codemirror/commands';

export interface TypingOptions {enabled:boolean;doubleSpace:boolean}
export interface Correction {from:number;to:number;insert:string}
// Authored exact substitutions only. No dictionary service, fuzzy matching or learned corrections.
export const misspellings:Readonly<Record<string,string>>=Object.freeze({
 accomodate:'accommodate',accomodation:'accommodation',acheive:'achieve',acheived:'achieved',acheivement:'achievement',
 acknowlege:'acknowledge',acquireing:'acquiring',accross:'across',adress:'address',adn:'and',
 aggresive:'aggressive',agressive:'aggressive',alot:'a lot',amature:'amateur',apparant:'apparent',
 appearence:'appearance',arguement:'argument',assasinate:'assassinate',athiest:'atheist',awfull:'awful',
 basicly:'basically',becasue:'because',becuase:'because',begining:'beginning',beleive:'believe',
 beleived:'believed',beleif:'belief',benifit:'benefit',buisness:'business',calender:'calendar',
 carribean:'Caribbean',catagory:'category',cemetary:'cemetery',changable:'changeable',cheif:'chief',
 cieling:'ceiling',collegue:'colleague',comming:'coming',commited:'committed',committment:'commitment',
 comparision:'comparison',completly:'completely',concious:'conscious',concensus:'consensus',congradulations:'congratulations',
 consistant:'consistent',convienient:'convenient',curiousity:'curiosity',definately:'definitely',definate:'definite',
 definatelyly:'definitely',dependantcy:'dependency',desparate:'desperate',developement:'development',diferent:'different',
 diffrent:'different',dissapear:'disappear',dissapoint:'disappoint',dissapointed:'disappointed',dissapointment:'disappointment',
 embarass:'embarrass',embarassed:'embarrassed',embarassing:'embarrassing',enviroment:'environment',equiptment:'equipment',
 especcially:'especially',exagerate:'exaggerate',existance:'existence',experiance:'experience',explaination:'explanation',
 familar:'familiar',finaly:'finally',flourescent:'fluorescent',foriegn:'foreign',fourty:'forty',
 freind:'friend',freinds:'friends',futher:'further',gaurd:'guard',goverment:'government',
 grammer:'grammar',greatful:'grateful',guage:'gauge',happend:'happened',harrass:'harass',
 hieght:'height',humerous:'humorous',hygene:'hygiene',imediately:'immediately',immediatly:'immediately',
 independant:'independent',indispensible:'indispensable',insted:'instead',interupt:'interrupt',irresistable:'irresistible',
 knowlege:'knowledge',lenght:'length',liason:'liaison',libary:'library',maintainance:'maintenance',
 millenium:'millennium',miniscule:'minuscule',mispell:'misspell',mispelled:'misspelled',neccessary:'necessary',
 necesary:'necessary',neice:'niece',noticable:'noticeable',occassion:'occasion',occassionally:'occasionally',
 occured:'occurred',occurence:'occurrence',ommitted:'omitted',oppurtunity:'opportunity',orginal:'original',
 ouput:'output',paralell:'parallel',particulary:'particularly',paticular:'particular',peice:'piece',
 persistant:'persistent',personaly:'personally',posession:'possession',possable:'possible',prefered:'preferred',
 preffered:'preferred',privelege:'privilege',probaly:'probably',publically:'publicly',quikly:'quickly',
 realy:'really',recieve:'receive',recieved:'received',recieving:'receiving',recomend:'recommend',
 refered:'referred',relevent:'relevant',remeber:'remember',repitition:'repetition',restaraunt:'restaurant',
 rythym:'rhythm',seperate:'separate',seperately:'separately',similiar:'similar',succesful:'successful',
 sucess:'success',suprise:'surprise',teh:'the',thier:'their',tommorow:'tomorrow',
 tommorrow:'tomorrow',truely:'truly',twelth:'twelfth',untill:'until',usefull:'useful',
 usualy:'usually',vaccum:'vacuum',wierd:'weird',writting:'writing',woudl:'would',
});
function frontmatter(text:string,pos:number){
 const start=/^\uFEFF?---\r?\n/.exec(text);if(!start)return false;
 const end=/\r?\n---(?:\r?\n|$)/g;end.lastIndex=start[0].length-1;const m=end.exec(text);
 return !m||pos<=m.index+m[0].length;
}
export function typingCorrection(text:string,pos:number,options:TypingOptions):Correction|null{
 if(!options.enabled||pos<1||pos>text.length||frontmatter(text,pos))return null;
 // While an inline code span is still being typed, the parser cannot identify it yet.
 const paragraphStart=text.lastIndexOf('\n\n',pos-1),paragraph=text.slice(paragraphStart<0?0:paragraphStart+2,pos);let ticks=0;
 for(const run of paragraph.matchAll(/(?<!\\)`+/g)){if(!ticks)ticks=run[0].length;else if(ticks===run[0].length)ticks=0;}
 if(ticks)return null;
 const boundary=text[pos-1];if(!/^[ \t\n.,!?;:)\]}\"]$/.test(boundary))return null;
 if(options.doubleSpace&&boundary===' '&&text[pos-2]===' '){
  const token=/\S+$/.exec(text.slice(0,pos-2))?.[0]??'';
  if(/[a-zA-Z][)'\"]?$/.test(token)&&!/[\d_./@#]/.test(token))return {from:pos-2,to:pos,insert:'. '};
  return null;
 }
 const before=text.slice(0,pos-1),match=/[A-Za-z]+(?:['’][A-Za-z]+)?$/.exec(before);if(!match)return null;
 const word=match[0],from=before.length-word.length,token=/\S+$/.exec(before)?.[0]??'';
 if(/[\d_./@#]/.test(token)||/[a-z][A-Z]/.test(word)||word===word.toUpperCase())return null;
 const lower=word.toLowerCase();let replacement=Object.hasOwn(misspellings,lower)?misspellings[lower]:word;
 if(/^[A-Z]/.test(word))replacement=replacement[0].toUpperCase()+replacement.slice(1);
 if(/^i(?:['’](?:m|ll))?$/i.test(word))replacement='I'+word.slice(1);
 const prefix=text.slice(0,from),abbreviation=/\b(?:e\.g|i\.e|vs|etc)\.[ \t]+$/i.test(prefix);
 const start=/(?:^|\n)[ \t]*(?:(?:#{1,6}|>|[-+*]|\d+[.)])[ \t]+)*$/.test(prefix)||(!abbreviation&&/[.!?][ \t]+$/.test(prefix));
 if(start)replacement=replacement[0].toUpperCase()+replacement.slice(1);
 return replacement===word?null:{from,to:pos-1,insert:replacement};
}
const protectedNodes=new Set(['FencedCode','CodeBlock','InlineCode','URL','Autolink','Link','Image','HTMLBlock','HTMLTag']);
export function correctionForState(state:EditorState,pos:number,options:TypingOptions){
 const correction=typingCorrection(state.doc.toString(),pos,options);if(!correction)return null;
 for(let node=syntaxTree(state).resolveInner(Math.min(correction.from+1,state.doc.length),1);node;node=node.parent!)if(protectedNodes.has(node.name))return null;
 return correction;
}
const corrected=StateEffect.define<number>();
const immediate=StateField.define<number|null>({create:()=>null,update(value,tr){if(tr.docChanged||tr.selection)value=null;for(const e of tr.effects)if(e.is(corrected))value=e.value;return value;}});
interface Host {state:EditorState;dispatch(tr:Transaction):void}
export function applyTypingCorrection(host:Host,pos:number,options:TypingOptions){
 const change=correctionForState(host.state,pos,options);if(!change)return false;
 const head=host.state.selection.main.head+change.insert.length-(change.to-change.from);
 host.dispatch(host.state.update({changes:change,effects:corrected.of(head),annotations:isolateHistory.of('full'),userEvent:'input.correct'}));return true;
}
export function typingHelp(options:()=>TypingOptions){
 return [immediate,EditorView.inputHandler.of((view,from,to,text,insert)=>{
  if(view.composing||view.compositionStarted||view.state.readOnly||from!==to||view.state.selection.ranges.length!==1||text.length!==1||!/[ \t\n.,!?;:)\]}\"]/.test(text))return false;
  const tr=insert();if(!tr.isUserEvent('input.type')||tr.isUserEvent('input.type.compose')||!correctionForState(tr.state,tr.state.selection.main.head,options()))return false;
  view.dispatch(tr);applyTypingCorrection(view,view.state.selection.main.head,options());return true;
 }),Prec.highest(keymap.of([
  {key:'Backspace',run:view=>!view.composing&&!view.state.readOnly&&view.state.field(immediate)===view.state.selection.main.head&&undo(view)},
  {key:'Enter',run:view=>{
   if(view.composing||view.compositionStarted||view.state.readOnly||view.state.selection.ranges.length!==1||!view.state.selection.main.empty)return false;
   // Reuse the normal newline/indent command; never append a period on Enter.
   let tr:Transaction|undefined;insertNewlineAndIndent({state:view.state,dispatch:value=>{tr=value;}});
   if(!tr||!correctionForState(tr.state,view.state.selection.main.head+1,options()))return false;
   const pos=view.state.selection.main.head+1;view.dispatch(tr);applyTypingCorrection(view,pos,options());return true;
  }}
 ]))];
}
