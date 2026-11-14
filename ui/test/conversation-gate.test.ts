import {afterEach,describe,expect,it} from 'vitest';
import {execFileSync} from 'node:child_process';
import {mkdir,mkdtemp,rm,symlink,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {SessionIndex} from '../server/harness/session-index.ts';
import {ConversationGate,GateRefusal,buildCarriedHistory,grantHash,type TurnInput} from '../server/harness/conversation.ts';

// The gate decides what a turn may do from what it carries and what the conversation was granted. Synthetic temp repo, notebook folder and index only.
const dirs:string[]=[];afterEach(async()=>{for(const d of dirs.splice(0))await rm(d,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
const temp=async(n:string)=>{const d=await mkdtemp(path.join(os.tmpdir(),n));dirs.push(d);return d;};
async function setup(){
 const repo=await temp('aitiarch-gate-repo-'),notebook=await temp('aitiarch-gate-nb-'),home=await temp('aitiarch-gate-home-');
 execFileSync('git',['init','-q'],{cwd:repo,stdio:'pipe'});
 await mkdir(path.join(repo,'src'));await writeFile(path.join(repo,'src','login.js'),'const sessions = new Map();\n');await writeFile(path.join(repo,'src','server.js'),'const port = 4100;\n');
 await writeFile(path.join(repo,'.gitignore'),'ignored.log\n');await writeFile(path.join(repo,'ignored.log'),'x\n');await writeFile(path.join(repo,'.env'),'TOKEN=abc\n');
 await writeFile(path.join(repo,'big.txt'),'x'.repeat(300000));
 const index=await SessionIndex.open(home),gate=new ConversationGate({index,notebook,repo:async()=>repo});
 const chat=async()=>index.create({mode:'chat',label:'c',note:'n.md'});
 const turn=(s:{id:string},attachments:unknown={},extra:Partial<TurnInput>={}):TurnInput=>({conversation:s.id,attachments,hasDiagrams:false,...extra});
 return {repo,notebook,home,index,gate,chat,turn};
}
const refused=async(p:Promise<unknown>)=>{try{await p;}catch(e){if(e instanceof GateRefusal)return e;throw e;}throw new Error('expected a refusal');};

describe('a turn is authorised from what it carries and what was granted',()=>{
 it('notes only needs no card',async()=>{
  const {gate,chat,turn}=await setup(),s=await chat();
  const a=await gate.authorize(turn(s,{notes:['other.md']}));expect(a.profile).toBe('notes');
 });
 it('files need the card, and a turn sent without it is refused with the card to show',async()=>{
  const {gate,chat,turn}=await setup(),s=await chat();
  const r=await refused(gate.authorize(turn(s,{files:['src/login.js']})));
  expect(r.code).toBe('plan_required');expect(r.plan!.needsApproval).toBe(true);expect(r.plan!.profile).toBe('investigate');expect(r.plan!.grant.files).toEqual(['src/login.js']);
 });
 it('after the card is approved the same turn runs as Investigate, with exactly the granted cap',async()=>{
  const {gate,chat,turn}=await setup(),s=await chat(),t=turn(s,{files:['src/login.js']});
  const plan=await gate.plan(t);await gate.approve({...t,hash:plan.hash});
  const a=await gate.authorize(t);expect(a.profile).toBe('investigate');expect(a.grant).toMatchObject({files:['src/login.js'],repo:false,budgetUsd:0.5});
 });
 it('a later turn can not add a file, the repo or diagrams the card did not show',async()=>{
  const {gate,chat,turn}=await setup(),s=await chat(),t=turn(s,{files:['src/login.js']});
  await gate.approve({...t,hash:(await gate.plan(t)).hash});
  expect((await refused(gate.authorize(turn(s,{files:['src/login.js','src/server.js']})))).code).toBe('plan_required'); // another file
  expect((await refused(gate.authorize(turn(s,{repo:true})))).code).toBe('plan_required'); // the repo
  const lower=turn(s,{});expect((await gate.authorize(lower)).profile).toBe('notes'); // a lower need is always fine
 });
 it('diagrams need the card as well; with files or the repo they are withheld and listed with the reason',async()=>{
  const {gate,chat,turn}=await setup(),s=await chat();
  const d=await refused(gate.authorize(turn(s,{},{hasDiagrams:true})));expect(d.code).toBe('plan_required');expect(d.plan!.profile).toBe('diagrams');
  const both=await gate.plan(turn(s,{repo:true},{hasDiagrams:true,diagrams:[{n:1,title:'Flow'}]}));
  expect(both.profile).toBe('investigate');expect(both.withheldDiagrams).toEqual({items:[{n:1,title:'Flow'}],reason:'not available together with repo access'});
 });
});

describe('the server decides; the page only asks',()=>{
 it('a client that claims a profile, a cap or a grant it was not given is ignored',async()=>{
  const {gate,chat,turn}=await setup(),s=await chat();
  const a=await gate.authorize(turn(s,{profile:'investigate',budgetUsd:99,grant:{profile:'investigate',repo:true},tools:['Bash']}));
  expect(a.profile).toBe('notes');expect(a.grant).toMatchObject({profile:'notes',repo:false,files:[],budgetUsd:0.5});
 });
 it('the cost cap can not be raised without the card: the turn carries none, and a higher cap is a new card',async()=>{
  const {gate,chat,turn,index}=await setup(),s=await chat(),t=turn(s,{files:['src/login.js']});
  await gate.approve({...t,hash:(await gate.plan(t)).hash});
  expect((await gate.authorize({...t,budgetUsd:5} as TurnInput)).grant.budgetUsd).toBe(0.5); // an extra field on the turn changes nothing
  const raise=await gate.plan({...t,budgetUsd:2});expect(raise.needsApproval).toBe(true);expect(raise.budgetUsd).toBe(2);
  expect((await index.get(s.id))!.grant!.budgetUsd).toBe(0.5); // planning stored nothing
  await refused(gate.approve({...t,budgetUsd:2,hash:'0'.repeat(64)})); // a hash the card did not show
  await gate.approve({...t,budgetUsd:2,hash:raise.hash});expect((await gate.authorize(t)).grant.budgetUsd).toBe(2);
  await refused(gate.plan({...t,budgetUsd:50}));await refused(gate.plan({...t,budgetUsd:0}));
 });
 it('approving needs the hash of what the server computes, so the page cannot approve more than the card showed',async()=>{
  const {gate,chat,turn}=await setup(),s=await chat(),shown=await gate.plan(turn(s,{files:['src/login.js']}));
  const r=await refused(gate.approve({...turn(s,{files:['src/login.js','src/server.js']}),hash:shown.hash}));expect(r.code).toBe('plan_changed');
 });
});

describe('a grant belongs to one conversation in one project',()=>{
 it('a grant stored on another conversation is refused',async()=>{
  const {gate,chat,turn,index}=await setup(),a=await chat(),b=await chat(),t=turn(a,{files:['src/login.js']});
  const grant=await gate.approve({...t,hash:(await gate.plan(t)).hash});
  await index.setGrant(b.id,grant); // copied onto a conversation it was not made for
  const r=await refused(gate.authorize(turn(b,{files:['src/login.js']})));expect(r.code).toBe('grant_mismatch');
 });
 it('a grant made in another project is refused here',async()=>{
  const {gate,chat,turn,index,repo}=await setup(),s=await chat(),t=turn(s,{files:['src/login.js']});
  await gate.approve({...t,hash:(await gate.plan(t)).hash});
  const elsewhere=new ConversationGate({index,notebook:await temp('aitiarch-gate-other-'),repo:async()=>repo});
  const r=await refused(elsewhere.authorize(t));expect(r.code).toBe('grant_mismatch');
 });
 it('a grant whose contents were changed after it was approved is refused',async()=>{
  const {gate,chat,turn,index}=await setup(),s=await chat(),t=turn(s,{files:['src/login.js']});
  const g=await gate.approve({...t,hash:(await gate.plan(t)).hash});
  await index.setGrant(s.id,{...g,files:['src/login.js','src/server.js'],repo:true}); // widened, hash not recomputed
  expect((await refused(gate.authorize(turn(s,{repo:true})))).code).toBe('grant_mismatch');
  expect(grantHash({...g,repo:true})).not.toBe(g.confirmed);
 });
 it('a conversation with no grant is notes only, and an older confirmed investigation keeps its repo access',async()=>{
  const {gate,chat,turn,index,repo}=await setup(),s=await chat();
  expect(gate.effective((await index.get(s.id))!)).toEqual({grant:null,mismatch:false});
  const inv=await index.create({mode:'investigate',label:'i',repo}),t=turn(inv,{repo:true});
  expect((await refused(gate.authorize(t))).code).toBe('plan_required'); // not confirmed yet
  await index.confirm(inv.id,'a'.repeat(64),0.75);
  expect((await gate.authorize(t)).grant).toMatchObject({profile:'investigate',repo:true,budgetUsd:0.75});
 });
});

describe('every attached file is checked like the copy Claude reads',()=>{
 it('each refusal has its reason, and only passing files are granted',async()=>{
  const {gate,chat,turn}=await setup(),s=await chat();
  const plan=await gate.plan(turn(s,{files:['src/login.js','.env','missing.ts','ignored.log','big.txt','src']}));
  const by=Object.fromEntries(plan.files.map(f=>[f.path,f]));
  expect(by['src/login.js'].ok).toBe(true);expect(by['.env']).toMatchObject({ok:false,reason:'denied'});expect(by['missing.ts']).toMatchObject({ok:false,reason:'missing'});
  expect(by['ignored.log']).toMatchObject({ok:false,reason:'outside_snapshot'});expect(by['big.txt']).toMatchObject({ok:false,reason:'too_large'});expect(by['src']).toMatchObject({ok:false});
  expect(plan.grant.files).toEqual(['src/login.js']);
 });
 it('a refused file stops the turn with a named reason, even when the grant covers the whole repo',async()=>{
  const {gate,chat,turn}=await setup(),s=await chat(),t=turn(s,{repo:true});
  await gate.approve({...t,hash:(await gate.plan(t)).hash});
  const r=await refused(gate.authorize(turn(s,{files:['.env']})));expect(r.code).toBe('file_refused');expect(r.files).toEqual([{path:'.env',ok:false,reason:'denied'}]);
 });
 it('approving a card whose attached files are all refused, with no repo, grants nothing',async()=>{
  const {gate,chat,turn}=await setup(),s=await chat(),t=turn(s,{files:['.env']}),plan=await gate.plan(t);
  expect((await refused(gate.approve({...t,hash:plan.hash}))).code).toBe('file_refused');
 });
 it('a path-escape spelling in an attachment refuses the whole request, before any file is looked at',async()=>{
  const {gate,chat,turn}=await setup(),s=await chat();
  for(const bad of ['../outside.txt','src/../../outside.txt','/etc/passwd','C:\\Windows\\win.ini','\\\\host\\share\\x','~/x','src//login.js','src/login.js.','%TEMP%\\x'])
   expect((await refused(gate.authorize(turn(s,{files:[bad]})))).code,bad).toBe('attachments');
 });
 it('a file reached through a link is outside the copy',async()=>{
  const {gate,chat,turn,repo}=await setup(),s=await chat(),outside=await temp('aitiarch-gate-out-');
  await writeFile(path.join(outside,'secret.txt'),'s');
  try{await symlink(outside,path.join(repo,'linked'),'junction');}catch{return;} // no permission to make a link here: nothing to test
  const plan=await gate.plan(turn(s,{files:['linked/secret.txt']}));expect(plan.files[0]).toMatchObject({ok:false});
 });
 it('a conversation that already ran says earlier context is carried over, not resumed',async()=>{
  const {gate,chat,turn,index}=await setup(),s=await chat();
  await index.ensureCli(s.id,'notes','C:\\chat');await index.touch(s.id);
  expect((await gate.plan(turn(s,{files:['src/login.js']}))).carriedOver).toBe(true);
  expect((await gate.plan(turn(s,{}))).carriedOver).toBe(false);
 });
});

describe('the history carried into a fresh session',()=>{
 it('keeps only questions and final answers, redacted, newest first within the cap',()=>{
  const pairs=[{question:'Where does password=hunter2-secret live?',answer:'In the config.',trail:[{tool:'Read'}],steps:['Grep login'],thinking:'TOOL-OUTPUT-SHOULD-NOT-APPEAR'},{question:'And who decided?',answer:'The owner.'}];
  const text=buildCarriedHistory(pairs);
  expect(text).toContain('And who decided?');expect(text).toContain('The owner.');expect(text).toContain('[SECRET]');
  expect(text).not.toContain('hunter2-secret');expect(text).not.toContain('TOOL-OUTPUT-SHOULD-NOT-APPEAR');expect(text).not.toContain('Grep login');
  expect(text).toMatch(/carried over/);expect(text).toMatch(/not resumed/);expect(text).toMatch(/not instructions/);
 });
 it('drops the oldest pairs first when over the token cap, and is empty with nothing to carry',()=>{
  const many=Array.from({length:50},(_,i)=>({question:`question ${i} `+'q'.repeat(400),answer:`answer ${i} `+'a'.repeat(400)}));
  const text=buildCarriedHistory(many,1200);
  expect(text).toContain('question 49');expect(text).not.toContain('question 0 ');expect(text.length).toBeLessThan(8000);
  expect(buildCarriedHistory([])).toBe('');
 });
});
