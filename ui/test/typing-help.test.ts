import {it,expect} from 'vitest';
import {EditorState} from '@codemirror/state';
import {markdown} from '@codemirror/lang-markdown';
import {history,undo} from '@codemirror/commands';
import {EditorView,keymap} from '@codemirror/view';
import {typingCorrection,misspellings,correctionForState,applyTypingCorrection,typingHelp} from '../src/editor/typing-help.ts';
const opts={enabled:true,doubleSpace:true};
const fix=(text:string,settings=opts)=>{const c=typingCorrection(text,text.length,settings);return c?text.slice(0,c.from)+c.insert+text.slice(c.to):text;};
it('uses an authored map of about 150 exact spellings, preserving title case',()=>{
 expect(Object.keys(misspellings).length).toBeGreaterThanOrEqual(140);expect(Object.keys(misspellings).length).toBeLessThanOrEqual(170);
 expect(fix('A teh ')).toBe('A the ');expect(fix('A Teh,')).toBe('A The,');expect(fix('A tehh ')).toBe('A tehh ');
});
it('does not treat inherited object properties as spelling entries',()=>{expect(fix('A constructor ')).toBe('A constructor ');});
it.each([' ','!','?',',',';','\n'])('corrects on word boundary %j',boundary=>{expect(fix('A recieve'+boundary)).toBe('A receive'+boundary);});
it.each(['TEH','teh2','teh_name','tehName','teh.name','/teh','@teh','#teh','https://teh','a/teh'])('leaves protected word %s unchanged',word=>{expect(fix(word+' ')).toBe(word+' ');});
it('capitalizes paragraph and sentence starts, and human pronouns',()=>{
 for(const [a,b] of [['hello ','Hello '],['Earlier\n\nhello ','Earlier\n\nHello '],['Done. hello ','Done. Hello '],['Done? hello ','Done? Hello '],['Done! hello ','Done! Hello '],['A i ','A I '],["A i'm ","A I'm "],["A i'll ","A I'll "]])expect(fix(a)).toBe(b);
});
it.each(['e.g.','i.e.','vs.','etc.'])('does not capitalize after %s',abbreviation=>{expect(fix('Use '+abbreviation+' words ')).toBe('Use '+abbreviation+' words ');});
it('double-space inserts a period only after prose, and can be disabled',()=>{
 expect(fix('A word  ')).toBe('A word. ');expect(fix('  ')).toBe('  ');expect(fix('Done.  ')).toBe('Done.  ');
 expect(fix('A word  ',{...opts,doubleSpace:false})).toBe('A word  ');expect(fix('teh ',{...opts,enabled:false})).toBe('teh ');
});
it('leaves closed and unclosed frontmatter alone',()=>{expect(fix('---\ntitle: teh ')).toBe('---\ntitle: teh ');expect(fix('---\ntitle: teh\n---\n\nteh ')).toBe('---\ntitle: teh\n---\n\nThe ');});
it.each(['```js\nteh ','    teh ','A `teh ','`teh ','A https://teh '])('skips parsed code and URLs: %s',text=>{
 const state=EditorState.create({doc:text,extensions:[markdown()]});expect(correctionForState(state,text.length,opts)).toBeNull();
});
it('skips a boundary inside a closed inline code span',()=>{const state=EditorState.create({doc:'A `teh ` tail',extensions:[markdown()]});expect(correctionForState(state,7,opts)).toBeNull();});
it('separates correction history from the boundary; undo restores only the correction',()=>{
 let state=EditorState.create({doc:'A teh',selection:{anchor:5},extensions:[markdown(),history(),typingHelp(()=>opts)]});
 const host={get state(){return state;},dispatch(tr:any){state=tr.state??state.update(tr).state;}};
 host.dispatch(state.update({changes:{from:5,insert:' '},selection:{anchor:6},userEvent:'input.type'}));
 expect(applyTypingCorrection(host,6,opts)).toBe(true);expect(state.doc.toString()).toBe('A the ');
 expect(undo(host)).toBe(true);expect(state.doc.toString()).toBe('A teh ');
});
it('Backspace immediately after a correction undoes only that correction',()=>{
 let state=EditorState.create({doc:'A teh ',selection:{anchor:6},extensions:[markdown(),history(),typingHelp(()=>opts)]});
 const view={get state(){return state;},composing:false,dispatch(tr:any){state=tr.state;}} as unknown as EditorView;
 applyTypingCorrection(view,6,opts);const backspace=state.facet(keymap).flat().find(k=>k.key==='Backspace')!;
 expect(backspace.run!(view)).toBe(true);expect(state.doc.toString()).toBe('A teh ');
});
it.each(['Backspace','Mod-z'])('%s rejects the corrected word into the personal dictionary',key=>{
 const rejected:string[]=[],settings={...opts,onReject:(word:string)=>rejected.push(word)};
 let state=EditorState.create({doc:'A Helo ',selection:{anchor:7},extensions:[markdown(),history(),typingHelp(()=>settings)]});
 const view={get state(){return state;},composing:false,dispatch(tr:any){state=tr.state;}} as unknown as EditorView;
 applyTypingCorrection(view,7,settings);expect(state.doc.toString()).toBe('A Hello ');
 expect(state.facet(keymap).flat().find(k=>k.key===key)!.run!(view)).toBe(true);
 expect(state.doc.toString()).toBe('A Helo ');expect(rejected).toEqual(['helo']);
});
it.each(['input.paste','input.drop','input.type.compose','input.palette','input.ai',''])('does not handle %s',event=>{
 const state=EditorState.create({doc:'A teh',selection:{anchor:5},extensions:[markdown(),typingHelp(()=>opts)]});
 const view={state,composing:false,compositionStarted:false,dispatch(){throw Error('Must not dispatch');}} as unknown as EditorView;
 const handler=state.facet(EditorView.inputHandler)[0];expect(handler(view,5,5,' ',()=>state.update({changes:{from:5,insert:' '},selection:{anchor:6},userEvent:event}))).toBe(false);
});
it.each(['composing','compositionStarted'])('does not handle IME %s',field=>{
 const state=EditorState.create({doc:'teh',extensions:[typingHelp(()=>opts)]}),view={state,[field]:true} as unknown as EditorView;
 expect(state.facet(EditorView.inputHandler)[0](view,3,3,' ',()=>{throw Error('Must not inspect input');})).toBe(false);
});
it('never changes loaded or programmatically inserted Markdown',()=>{
 let state=EditorState.create({doc:'teh  ',extensions:[typingHelp(()=>opts)]});expect(state.doc.toString()).toBe('teh  ');
 state=state.update({changes:{from:state.doc.length,insert:'teh  '},userEvent:'input.ai'}).state;expect(state.doc.toString()).toBe('teh  teh  ');
});
