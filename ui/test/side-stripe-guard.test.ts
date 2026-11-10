import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';

// Guard for the ui-remodel rule: AI content and quotes are never marked by a side stripe.
// AI is marked by the filled "AI" label, outline, sans type and inset; quotes by italics and typographic marks.
// A side border (or a horizontal inset shadow) wider than 1px on any AI or quote class fails this test.
const css=readFileSync(new URL('../src/styles.css',import.meta.url),'utf8').replace(/\/\*[\s\S]*?\*\//g,'');
const AI_OR_QUOTE=/(margin-card|cm-ink|thought|thread|callout|cm-quote|blockquote|orphan|attach|ai-|human-takeaway|summary|reply)/i;
const SIDE=/^(border-(left|right|inline-start|inline-end)(-width)?|border-inline(-width)?)$/;

function rules(){
  const out:{selector:string;decls:[string,string][]}[]=[];
  const re=/([^{}]+)\{([^{}]*)\}/g;let m:RegExpExecArray|null;
  while((m=re.exec(css))){
    const selector=m[1].trim();
    if(selector.startsWith('@'))continue;
    const decls=m[2].split(';').map(d=>d.trim()).filter(Boolean).map(d=>{const i=d.indexOf(':');return [d.slice(0,i).trim().toLowerCase(),d.slice(i+1).trim()] as [string,string];});
    out.push({selector,decls});
  }
  return out;
}
const widths=(v:string)=>[...v.matchAll(/(-?\d*\.?\d+)px/g)].map(x=>Math.abs(parseFloat(x[1])));

describe('no side stripes on AI or quote classes',()=>{
  it('declares no side border wider than 1px and no wide horizontal inset on any AI or quote selector',()=>{
    const bad:string[]=[];
    for(const {selector,decls} of rules()){
      if(!AI_OR_QUOTE.test(selector))continue;
      for(const [prop,value] of decls){
        if(SIDE.test(prop)&&widths(value).some(w=>w>1))bad.push(`${selector} { ${prop}: ${value} }`);
        if(prop==='box-shadow'&&/inset\s+-?(?:[2-9]|\d{2,})(?:px)?\s+0(?:px)?\s+0/.test(value))bad.push(`${selector} { ${prop}: ${value} }`);
      }
    }
    expect(bad).toEqual([]);
  });
  it('keeps the former offenders stripe-free',()=>{
    const known=['.margin-card','.cm-ink-block','.cm-quote','.thread-reply','blockquote'];
    const hits:string[]=[];
    for(const {selector,decls} of rules())
      if(selector.split(',').some(s=>known.some(k=>s.trim()===k||s.trim().endsWith(' '+k))))
        for(const [p,v] of decls) if(SIDE.test(p)&&widths(v).some(w=>w>1))hits.push(`${selector} ${p}: ${v}`);
    expect(hits).toEqual([]);
  });
  it('sanity: the scanner sees the stylesheet and the AI selectors',()=>{
    expect(rules().length).toBeGreaterThan(200);
    expect(rules().some(r=>/margin-card/.test(r.selector))).toBe(true);
  });
  it('has no stray control characters (a mangled CSS escape once rendered as tofu)',()=>{
    expect(/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(css)).toBe(false);
  });
});
