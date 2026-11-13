import {execFileSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterAll,describe,expect,it} from 'vitest';
import {UiStateStore} from '../server/ui-state-store.ts';

// The app-side investigator is gone, but a ui-state.json written by it still has an "investigator" block (its folders and "always allow" choices). That is the person's
// data: nothing reads it any more, nothing validates it, and saving any other preference must write it back exactly as it was.
const tmp=realpathSync(mkdtempSync(path.join(tmpdir(),'aitiarch-uistate-old-')));afterAll(()=>rmSync(tmp,{recursive:true,force:true,maxRetries:5}));
const project=(ignored:boolean)=>{const d=path.join(tmp,'p'+Math.random().toString(36).slice(2));mkdirSync(d,{recursive:true});execFileSync('git',['init','-q'],{cwd:d});
 if(ignored)writeFileSync(path.join(d,'.gitignore'),'/ui-state.json*\n');return d;};
const OLD={enabled:true,roots:['C:\\Users\\someone\\project'],tiers:{inside:'notebook',outside:'ask',commands:'ask'},outsideEnabled:false,commands:[],settings:{concurrency:3,depth:1,turns:12,timeoutMs:180000,delegations:6,tokens:100000},fromAFutureOrOlderBuild:{keep:['me']}};
const onDisk=(d:string)=>JSON.parse(readFileSync(path.join(d,'ui-state.json'),'utf8'));

describe('an old investigator block in ui-state.json',()=>{
 it('is kept exactly as written when other preferences are saved, even in a shape no code here knows',async()=>{
  const d=project(true);writeFileSync(path.join(d,'ui-state.json'),JSON.stringify({v:1,tabs:[],active:null,investigator:OLD},null,2)+'\n');
  const store=new UiStateStore(d);await store.updateTabs({v:1,tabs:['a.md'],active:'a.md',theme:'moss'});
  const saved=onDisk(d);expect(saved.investigator).toEqual(OLD);expect(saved.theme).toBe('moss');expect(saved.tabs).toEqual(['a.md']);
 });
 it('does not stop the file from loading, and the app reads nothing from it',async()=>{
  const d=project(true);writeFileSync(path.join(d,'ui-state.json'),JSON.stringify({v:1,tabs:['a.md'],active:'a.md',investigator:{totally:'different',roots:42}})+'\n');
  const state=await new UiStateStore(d).read();expect(state.tabs).toEqual(['a.md']);expect(state.active).toBe('a.md');
 });
 it('is kept when ui-state.json is not git-ignored either (it used to be dropped on the next save)',async()=>{
  const d=project(false);writeFileSync(path.join(d,'ui-state.json'),JSON.stringify({v:1,tabs:[],active:null,investigator:OLD})+'\n');
  await new UiStateStore(d).updateTabs({v:1,tabs:['b.md'],active:'b.md'});
  expect(onDisk(d).investigator).toEqual(OLD);
 });
 it('is not a way in: a value that is not an object is not kept, and nothing is executed or validated',async()=>{
  const d=project(true);writeFileSync(path.join(d,'ui-state.json'),JSON.stringify({v:1,tabs:[],active:null,investigator:'rm -rf'})+'\n');
  const store=new UiStateStore(d);await store.updateTabs({v:1,tabs:[],active:null,theme:'ember'});expect(onDisk(d).investigator).toBeUndefined();
 });
});
