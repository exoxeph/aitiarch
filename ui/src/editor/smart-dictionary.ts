// ASCII words include identifiers as whole tokens: never split camelCase into prose.
export function wordsIn(text:string):Set<string>{return new Set((text.match(/[A-Za-z][A-Za-z0-9_'’-]*/g)??[]).map(w=>w.toLowerCase()));}
export function notebookWords(notes:ReadonlyMap<string,string>,active?:{path:string;text:string;head:number}):Set<string>{
 const result=new Set<string>();for(const [path,stored] of notes){let text=stored;
  if(active?.path===path&&active.text===stored){const from=active.head-(/[A-Za-z0-9_'’-]+$/.exec(text.slice(0,active.head))?.[0].length??0),to=active.head+(/^[A-Za-z0-9_'’-]+/.exec(text.slice(active.head))?.[0].length??0);text=text.slice(0,from)+' '+text.slice(to);}
  for(const word of wordsIn(text))result.add(word);
 }return result;
}
export async function createDictionaryCorrector(aff:string,dic:string):Promise<(word:string)=>string|null>{
 const {default:nspell}=await import('nspell'),spell=nspell({aff,dic}),cache=new Map<string,string|null>();
 return word=>{
  if(cache.has(word))return cache.get(word)!;
  if(!/^[a-z]{3,24}$/.test(word)||spell.correct(word))return null;
  // Exhaustive distance ONE, including adjacent transposition. No edit-two guesses.
  const candidates=new Set<string>(),alphabet="abcdefghijklmnopqrstuvwxyz'";
  const consider=(candidate:string)=>{if(spell.correct(candidate))candidates.add(candidate);};
  for(let i=0;i<=word.length;i++){
   const left=word.slice(0,i),right=word.slice(i);
   if(i<word.length){consider(left+right.slice(1));if(i+1<word.length)consider(left+right[1]+right[0]+right.slice(2));}
   for(const letter of alphabet){consider(left+letter+right);if(i<word.length&&letter!==right[0])consider(left+letter+right.slice(1));}
  }
  // The only candidate has a clear rank; tied candidates are deliberately untouched.
  const result=candidates.size===1?[...candidates][0]:null;
  if(cache.size>=2000)cache.clear();cache.set(word,result);return result;
 };
}
