// Footnotes. Insertion is an explicit command (the /footnote slash item); drawing is display only and never changes the document.
import {syntaxTree} from '@codemirror/language';
import {RangeSetBuilder, type ChangeSpec, type EditorState, type Text} from '@codemirror/state';
import {Decoration, ViewPlugin, WidgetType, type DecorationSet, type EditorView, type ViewUpdate} from '@codemirror/view';

const NUMBERED=/\[\^(\d+)\]/g;
/**
 * `/footnote`: the next unused number replaces the typed text as a reference, and its definition is added at the end of the note
 * (after a blank line, or directly under the other definitions) with the cursor placed there, ready for the footnote text.
 */
export function footnoteInsertion(doc:Text,from:number,to:number):{changes:ChangeSpec[];caret:number}{
 const text=doc.toString();let n=0;for(const m of text.matchAll(NUMBERED))n=Math.max(n,Number(m[1]));n+=1;
 const ref=`[^${n}]`,def=`[^${n}]: `;
 const after=text.slice(0,from)+ref+text.slice(to),body=after.replace(/\s+$/,''),lastLine=body.slice(body.lastIndexOf('\n')+1);
 const trailing=(after.slice(body.length).match(/\n/g)??[]).length,want=/^\[\^[^\]\s]+\]:/.test(lastLine)?1:2;
 const insert='\n'.repeat(Math.max(0,want-trailing))+def;
 return {changes:[{from,to,insert:ref},{from:doc.length,insert}],caret:doc.length+(ref.length-(to-from))+insert.length};
}

const CODE=new Set(['InlineCode','FencedCode','CodeBlock','CodeText','HTMLBlock','CommentBlock']);
class Ref extends WidgetType{
 constructor(readonly label:string){super();}
 eq(o:Ref){return o.label===this.label;}
 toDOM(){const s=document.createElement('sup');s.className='cm-footnote-ref';s.textContent=this.label;return s;}
}
class Label extends WidgetType{
 constructor(readonly label:string){super();}
 eq(o:Label){return o.label===this.label;}
 toDOM(){const s=document.createElement('span');s.className='cm-footnote-label';s.textContent=this.label+'.';return s;}
}
const REF=/\[\^([^\]\s]+)\](?!:)/g,DEF=/^([ \t]{0,3})\[\^([^\]\s]+)\]:[ \t]?/;
function build(view:EditorView):DecorationSet{
 const out=new RangeSetBuilder<Decoration>(),state:EditorState=view.state,tree=syntaxTree(state),sel=state.selection.ranges;
 const inCode=(pos:number)=>{for(let n:{name:string;parent:any}|null=tree.resolveInner(pos,1);n;n=n.parent)if(CODE.has(n.name))return true;return false;};
 let last=-1;
 for(const {from,to} of view.visibleRanges){
  for(let pos=from;pos<=to;){
   const line=state.doc.lineAt(pos);pos=line.to+1;if(line.number<=last)continue;last=line.number;
   const here=sel.some(r=>r.from<=line.to&&r.to>=line.from),def=DEF.exec(line.text);
   if(def&&!inCode(line.from)){
    out.add(line.from,line.from,Decoration.line({class:'cm-footnote-def'}));
    if(!here)out.add(line.from+def[1].length,line.from+def[0].length,Decoration.replace({widget:new Label(def[2])}));
    continue;
   }
   if(here||!line.text.includes('[^'))continue;
   for(const m of line.text.matchAll(REF)){const at=line.from+m.index!;if(!inCode(at))out.add(at,at+m[0].length,Decoration.replace({widget:new Ref(m[1])}));}
  }
 }
 return out.finish();
}
/** Draws `[^1]` as a small raised number and `[^1]: text` as a small note, unless the cursor is on that line. */
export const footnotes=ViewPlugin.fromClass(class{
 decorations:DecorationSet;
 constructor(view:EditorView){this.decorations=build(view);}
 update(u:ViewUpdate){if(u.docChanged||u.viewportChanged||u.selectionSet||syntaxTree(u.state)!==syntaxTree(u.startState))this.decorations=build(u.view);}
},{decorations:v=>v.decorations});
