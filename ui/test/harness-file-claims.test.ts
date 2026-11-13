import {mkdir,mkdtemp,rm,symlink,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach,describe,expect,it} from 'vitest';
import {finishFileReply,quoteLine} from '../server/harness/file-claims.ts';
import {validClaims} from '../shared/chat.ts';
import {claimChips} from '../src/chat/claim-chips.ts';
import {claimLines} from '../src/chat/chat-model.ts';

// An investigation teaches the code with file claims: path, line and a verbatim quote. Each is checked against the real file in the repo the user
// picked (not the snapshot), by the same normalisation the chat uses, near the line it names. Nothing outside the repo or denied is ever read.
const dirs:string[]=[];afterEach(async()=>{for(const d of dirs.splice(0))await rm(d,{recursive:true,force:true});});
const temp=async(n:string)=>{const d=await mkdtemp(path.join(os.tmpdir(),n));dirs.push(d);return d;};
const SRC='const http = require(\'http\');\n// Sessions live in memory.\nconst sessions = new Map();\nfunction login(name) {\n  return sessions.get(name);\n}\n';
async function repo(){const r=await temp('aitiarch-fclaims-');await mkdir(path.join(r,'src'));await writeFile(path.join(r,'src','login.js'),SRC);await mkdir(path.join(r,'src','chat'));await writeFile(path.join(r,'src','chat','runtime.js'),SRC);await mkdir(path.join(r,'journal'));await writeFile(path.join(r,'journal','plan.js'),SRC);await writeFile(path.join(r,'.env'),'KEY=secret\n');return r;}
const reply=(claims:unknown)=>`Sessions are kept in memory.\n<claims>${JSON.stringify(claims)}</claims>`;

describe('finishFileReply',()=>{
 it('finds a verbatim quote at or near the line it names, and marks a paraphrase or a wrong line as not found',async()=>{
  const r=await repo(),out=await finishFileReply(reply([
   {path:'src/login.js',line:3,quote:'const sessions = new Map();'},
   {path:'src\\login.js',line:4,quote:'// Sessions live in memory.'}, // two lines off, backslashes: still found
   {path:'src/login.js',line:3,quote:'Sessions are stored in a map'}, // paraphrase
   {path:'src/login.js',line:40,quote:'const sessions = new Map();'}, // far from the line it names: found elsewhere in the file, with the real line
  ]),r);
  expect(out.body).toBe('Sessions are kept in memory.');
  expect(out.claims.map((c:{status:string})=>c.status)).toEqual(['found','found','not_found','found']);
  expect(out.claims[3]).toEqual({sourceId:'F',source:'file',path:'src/login.js',line:3,namedLine:40,quote:'const sessions = new Map();',status:'found'});
  expect(out.claims[0]).toEqual({sourceId:'F',source:'file',path:'src/login.js',line:3,quote:'const sessions = new Map();',status:'found'});
  expect(validClaims(out.claims)).toBe(true);
 });
 it('never reads outside the repo, a denied file or a link, and keeps such a claim as no valid source',async()=>{
  const r=await repo(),outside=await temp('aitiarch-fclaims-out-');await writeFile(path.join(outside,'x.js'),'const sessions = new Map();\n');
  await symlink(outside,path.join(r,'linked'),'junction');
  const out=await finishFileReply(reply([{path:'../'+path.basename(outside)+'/x.js',line:1,quote:'const sessions = new Map();'},{path:path.join(outside,'x.js'),line:1,quote:'const sessions = new Map();'},
   {path:'.env',line:1,quote:'KEY=secret'},{path:'linked/x.js',line:1,quote:'const sessions = new Map();'},{quote:'no path'},{path:'src~1/login.js',line:3,quote:'x'},{path:'src/login.js.',line:3,quote:'x'}]),r);
  expect(out.claims.map((c:{status:string})=>c.status)).toEqual(Array(7).fill('no_valid_source'));
  expect(validClaims(out.claims)).toBe(true);
 });
 it('a claim about code in a folder named chat is checked like any other; the notebook folder, when it is inside the repo, is never read',async()=>{
  const r=await repo(),claims=[{path:'src/chat/runtime.js',line:3,quote:'const sessions = new Map();'},{path:'journal/plan.js',line:3,quote:'const sessions = new Map();'}];
  expect((await finishFileReply(reply(claims),r)).claims.map((c:{status:string})=>c.status)).toEqual(['found','found']); // no notebook given: both are plain repo files
  expect((await finishFileReply(reply(claims),r,path.join(r,'journal'))).claims.map((c:{status:string})=>c.status)).toEqual(['found','no_valid_source']);
 });
 it('a reply without a claims block keeps its text and says so',async()=>{
  const out=await finishFileReply('Just prose.',await repo());expect(out).toMatchObject({body:'Just prose.',claims:[],citation:'missing_block'});
 });
});

describe('quoteLine',()=>{
 it('prefers the named line, falls back to the whole file, and says nowhere only when it is nowhere',()=>{
  expect(quoteLine(SRC,3,'const sessions = new Map();')).toBe(3);expect(quoteLine(SRC,99,'const sessions = new Map();')).toBe(3);
  expect(quoteLine('filler\n'.repeat(20)+SRC,1,'sessions.get(name)')).toBe(25);expect(quoteLine(SRC,3,'a paraphrase that is nowhere')).toBeNull();
 });
});

describe('file claims in the chips and lines',()=>{
 it('a corrected line is shown on the chip with the line the AI named',()=>{
  const [c]=claimChips([{sourceId:'F',source:'file',path:'src/login.js',line:3,namedLine:40,quote:'q',status:'found'}],{path:'plan.md',text:''});
  expect(c.label).toBe('src/login.js:3 (the AI said line 40)');expect(validClaims([{sourceId:'F',source:'file',path:'a.js',line:3,namedLine:40,quote:'q',status:'found'}])).toBe(true);
 });
 it('read as the file and line, with the AI kind F, and offer no Show or Cite',()=>{
  const [c]=claimChips([{sourceId:'F',source:'file',path:'src/login.js',line:3,quote:'q',status:'found'}],{path:'plan.md',text:''});
  expect(c).toMatchObject({kind:'F',label:'src/login.js:3',stateWords:'Found',canShow:false,canCite:false});
  expect(claimLines([{sourceId:'F',source:'file',path:'src/login.js',line:3,quote:'q',status:'not_found'}])[0].text).toBe('Quote not found in src/login.js');
 });
});
