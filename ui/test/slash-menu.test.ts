import {it,expect} from 'vitest';
import {SLASH_ITEMS,slashPick,slashItems} from '../src/editor/slash.ts';
import {slashInsert,slashSource} from '../src/editor/slash.ts';
import {EditorState} from '@codemirror/state';
import {CompletionContext} from '@codemirror/autocomplete';
it.each([['decision','Decision: \nWhy: ',10],['rejected','Rejected: ',10]] as const)('inserts /%s with the human entry caret and preserves surrounding BOM/CRLF bytes', (query,insert,caret)=>{
 const item=slashPick(query);expect(item?.shortcut).toBe('/'+query);
 const original='\ufeffBefore\r\n/'+query+'\r\nAfter\r\n';
 let state=EditorState.create({doc:original});const from=state.doc.toString().indexOf('/');const to=from+query.length+1;
 const change=slashInsert(item!,from,to);state=state.update({changes:change.changes,selection:{anchor:change.caret}}).state;
 expect(state.doc.sliceString(0,state.doc.length,'\r\n')).toBe(original.replace('/'+query,insert.replace(/\n/g,'\r\n')));
 expect(state.selection.main.head).toBe(from+caret);
 const completion=slashSource(new CompletionContext(EditorState.create({doc:'/'+query}),query.length+1,false))!;
 expect(completion.options[0].label).toBe(item!.label);
});
it.each([['bullets','Bulleted list'],['todo','Checklist'],['checklist','Checklist'],['line','Divider'],['table','Table'],['note','Note callout'],['warning','Warning callout'],['image','Image'],['footnote','Footnote']])('finds synonym %s', (q,label)=>expect(slashPick(q)?.label).toBe(label));
it('groups all supported items with a plain description, icon and shortcut',()=>{expect(new Set(SLASH_ITEMS.map(i=>i.group))).toEqual(new Set(['Text','Lists','Insert','Advanced']));for(const i of SLASH_ITEMS){expect(i.icon).toBeTruthy();expect(i.shortcut).toBeTruthy();expect(i.detail.length).toBeGreaterThan(8);}expect(slashPick('todo')?.detail).toBe('Items you can tick off');expect(SLASH_ITEMS).toHaveLength(19);});
it('search and fast Enter use the same filtering',()=>{for(const q of ['h2','todo','line','zzzz'])expect(slashItems(q)[0]??null).toEqual(slashPick(q));});
it('no custom HTML or collapsible syntax is inserted',()=>{for(const i of SLASH_ITEMS)expect(i.insert).not.toMatch(/<\/?(?:details|div|span|summary)/);});

it('recomputes synonym results synchronously while the menu is open',async()=>{const {EditorState}=await import('@codemirror/state');const {CompletionContext}=await import('@codemirror/autocomplete');const {slashSource}=await import('../src/editor/slash.ts');const first=slashSource(new CompletionContext(EditorState.create({doc:'/'}),1,false))!;const s=EditorState.create({doc:'/todo'});const next=first.update!(first,1,5,new CompletionContext(s,5,false))!;expect(next.options[0].label).toBe('Checklist');});
