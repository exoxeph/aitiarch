import {describe,expect,it} from 'vitest';
import {emptyPrefs,frontBlob,moveBlob,prunePrefs,readBlobPrefs,resetBlob,sanitizePrefs,writeBlobPrefs} from '../src/ink/blob-prefs.ts';

// Where a person put their AI thought blobs, and which is in front. A display preference only: kept in this browser, never in the note
// or the ink file, and nothing but numbers and ids.
const fakeStore=()=>{const m=new Map<string,string>();return {m,s:{getItem:(k:string)=>m.get(k)??null,setItem:(k:string,v:string)=>void m.set(k,v)}};};

describe('changing preferences',()=>{
 it('moving a blob records where, and brings it to the front',()=>{
  const p=moveBlob(moveBlob(emptyPrefs(),'a',{left:10,top:20}),'b',{left:30,top:40});
  expect(p.positions).toEqual({a:{left:10,top:20},b:{left:30,top:40}});expect(p.order).toEqual(['a','b']);
  expect(moveBlob(p,'a',{left:11,top:21}).order).toEqual(['b','a']);
 });
 it('putting a blob back removes its position but keeps its place in the stack',()=>{
  const p=resetBlob(moveBlob(emptyPrefs(),'a',{left:1,top:2}),'a');expect(p.positions).toEqual({});expect(p.order).toEqual(['a']);
 });
 it('choosing a blob without moving it only brings it to the front',()=>{
  const p=frontBlob({positions:{},order:['a','b']},'a');expect(p.order).toEqual(['b','a']);expect(p.positions).toEqual({});
 });
 it('forgets blobs that no longer exist',()=>{
  const p=prunePrefs({positions:{a:{left:1,top:2},gone:{left:3,top:4}},order:['gone','a']},['a','b']);
  expect(p.positions).toEqual({a:{left:1,top:2}});expect(p.order).toEqual(['a']);
 });
 it('never changes the preferences it was given',()=>{
  const p=Object.freeze({positions:Object.freeze({}),order:Object.freeze([])}) as any;expect(()=>moveBlob(p,'a',{left:1,top:1})).not.toThrow();
 });
});

describe('what is accepted from storage',()=>{
 it('accepts exactly ids and finite numbers',()=>{
  const p={positions:{a:{left:10.5,top:200}},order:['a']};expect(sanitizePrefs(p)).toEqual(p);
 });
 it('drops anything else: paths, text, extra keys, non-numbers, huge numbers, too many entries',()=>{
  expect(sanitizePrefs(null)).toEqual(emptyPrefs());expect(sanitizePrefs('x')).toEqual(emptyPrefs());expect(sanitizePrefs([])).toEqual(emptyPrefs());
  expect(sanitizePrefs({positions:{'C:\\x':{left:1,top:1},ok:{left:'1',top:1},big:{left:1e9,top:1},extra:{left:1,top:1,z:1},fine:{left:1,top:2}},order:['C:\\x',5,'fine']})).toEqual({positions:{fine:{left:1,top:2}},order:['fine']});
  const many=Object.fromEntries(Array.from({length:300},(_,i)=>['b'+i,{left:i,top:i}]));expect(Object.keys(sanitizePrefs({positions:many,order:[]}).positions)).toHaveLength(200);
 });
});

describe('reading and writing',()=>{
 it('round-trips per note, and one note never sees another\'s blobs',()=>{
  const {s}=fakeStore(),p=moveBlob(emptyPrefs(),'a',{left:5,top:6});writeBlobPrefs('one.md',p,s);
  expect(readBlobPrefs('one.md',s)).toEqual(p);expect(readBlobPrefs('two.md',s)).toEqual(emptyPrefs());
 });
 it('storage that is missing, blocked or holds junk is simply no preferences',()=>{
  expect(readBlobPrefs('n.md',undefined)).toEqual(emptyPrefs());
  expect(readBlobPrefs('n.md',{getItem:()=>{throw new Error('blocked');},setItem:()=>{throw new Error('blocked');}})).toEqual(emptyPrefs());
  const {m,s}=fakeStore();m.set('aitiarch.blobs:n.md','not json');expect(readBlobPrefs('n.md',s)).toEqual(emptyPrefs());
  expect(()=>writeBlobPrefs('n.md',emptyPrefs(),{getItem:()=>null,setItem:()=>{throw new Error('blocked');}})).not.toThrow();
 });
});
