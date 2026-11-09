import {it,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {typingCorrection} from '../src/editor/typing-help.ts';
import {correctionForState} from '../src/editor/typing-help.ts';
import {EditorState} from '@codemirror/state';
import {markdown} from '@codemirror/lang-markdown';
import {createDictionaryCorrector,wordsIn,notebookWords} from '../src/editor/smart-dictionary.ts';
const aff=await readFile(new URL('index.aff',import.meta.resolve('dictionary-en')),'utf8'),dic=await readFile(new URL('index.dic',import.meta.resolve('dictionary-en')),'utf8');
const dictionary=await createDictionaryCorrector(aff,dic);
export const typos=Object.entries({helo:'hello',wht:'what',itt:'it',teh:'the',recieve:'receive',definately:'definitely',thier:'their',becuase:'because',waht:'what',dont:"don't",wich:'which',seperate:'separate',
 accomodate:'accommodate',acheive:'achieve',adress:'address',adn:'and',alot:'a lot',appearence:'appearance',arguement:'argument',begining:'beginning',beleive:'believe',buisness:'business',calender:'calendar',comming:'coming',commited:'committed',completly:'completely',diferent:'different',enviroment:'environment',experiance:'experience',finaly:'finally',foriegn:'foreign',freind:'friend',goverment:'government',grammer:'grammar',imediately:'immediately',knowlege:'knowledge',
 sentnce:'sentence',databse:'database',pargraph:'paragraph',brower:'browser',keybord:'keyboard',functon:'function',documnt:'document',langage:'language',queston:'question',answr:'answer',exmple:'example',mesage:'message',synhetic:'synthetic',perfrmance:'performance',compatiblity:'compatibility',deletd:'deleted',instalation:'installation',aplication:'application',navigtion:'navigation',persistnce:'persistence',interacton:'interaction',validtion:'validation',selecton:'selection',correcton:'correction'});
export const technical='useState kubectl FastAPI tsconfig ESLint npm regex localhost OAuth middleware TypeScript JavaScript React CodeMirror Vite Vitest JSX TSX JSON YAML HTML CSS HTTP HTTPS SSE PKCE JWT UUID SQL SQLite PostgreSQL Redis GraphQL WebSocket API SDK CLI UTF8 CRLF BOM git github node node_modules pnpm yarn webpack esbuild rollup nginx docker Kubernetes Terraform AWS Azure Linux macOS Windows fetch async'.split(' ');
const options={enabled:true,doubleSpace:true,smart:true,dictionary};
function fix(word:string,extra={}){const text='A '+word+' ',c=typingCorrection(text,text.length,{...options,...extra});return c?c.insert:word;}
it('fixes at least 85 percent of 60 authored typos and no technical words',()=>{
 expect(typos).toHaveLength(60);expect(technical).toHaveLength(60);
 const misses=typos.filter(([a,b])=>fix(a)!==b);console.log('Smart corpus:',JSON.stringify({fixed:60-misses.length,total:60,misses:misses.map(([a])=>a),technicalChanged:technical.filter(w=>fix(w,{vocabulary:wordsIn(technical.join(' '))})!==w)}));
 expect(60-misses.length).toBeGreaterThanOrEqual(51);for(const w of technical){expect(fix(w)).toBe(w);expect(fix(w,{vocabulary:wordsIn(technical.join(' '))})).toBe(w);}
});
it('preserves title case and respects personal and notebook words before either path',()=>{
 expect(fix('Helo')).toBe('Hello');expect(fix('sentnce')).toBe('sentence');
 for(const w of ['helo','teh','sentnce'])expect(fix(w,{neverCorrect:[w]})).toBe(w);
 expect(fix('sentnce',{vocabulary:wordsIn('Existing sentnce')})).toBe('sentnce');
});
it('requires one unambiguous distance-one candidate; transpositions count as one',()=>{
 expect(dictionary('sentnce')).toBe('sentence');expect(dictionary('snetence')).toBe('sentence');
 expect(dictionary('helo')).toBeNull();expect(dictionary('wht')).toBeNull();expect(dictionary('zzzzzzzz')).toBeNull();expect(dictionary('sentence')).toBeNull();
});
it('turns off dictionary corrections independently of the exact map',()=>{expect(fix('sentnce',{smart:false})).toBe('sentnce');expect(fix('teh',{smart:false})).toBe('the');});
it('protects words elsewhere in the current note but not the word currently being typed',()=>{
 const text='Existing sentnce. Another sentnce ';expect(typingCorrection(text,text.length,options)).toBeNull();expect(fix('sentnce')).toBe('sentence');
});
it('collects vocabulary from every notebook note, including unopened notes, without protecting the active token',()=>{
 const notes=new Map([['open.md','Typing pargraph'],['closed.md','My sentnce vocabulary OAuth']]);
 expect(notebookWords(notes,{path:'open.md',text:'Typing pargraph',head:15})).toEqual(new Set(['typing','my','sentnce','vocabulary','oauth']));
 expect(notebookWords(notes).has('pargraph')).toBe(true);
 notes.set('closed.md','Changed documnt');expect(notebookWords(notes).has('documnt')).toBe(true);expect(notebookWords(notes).has('sentnce')).toBe(false);
});
it.each(['SENTNCE','sentnce2','sentnce_name','sentnceName','sentnce.name','/sentnce','@sentnce','#sentnce','https://sentnce','a/sentnce'])('retains token skip rule %s',word=>{expect(fix(word)).toBe(word);});
it('keeps uncached dictionary work under 5ms per word after load',async()=>{
 const fresh=await createDictionaryCorrector(aff,dic);
 const times=[];for(const [word] of typos){const start=performance.now();fresh(word);times.push(performance.now()-start);}times.sort((a,b)=>a-b);
 expect(times.reduce((a,b)=>a+b)/times.length).toBeLessThan(5);expect(times[Math.floor(times.length*.95)]).toBeLessThan(5);
});
it('uses the exact map without calling the dictionary',()=>{expect(fix('teh',{dictionary:()=>{throw Error('Map must be the fast path');}})).toBe('the');});
it.each(['```js\nsentnce ','    sentnce ','A `sentnce ','A https://sentnce ','---\ntitle: sentnce '])('retains protected Markdown context %s',text=>{
 const state=EditorState.create({doc:text,extensions:[markdown()]});expect(correctionForState(state,text.length,options)).toBeNull();
});

