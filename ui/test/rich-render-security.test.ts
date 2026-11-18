import {expect,it,vi} from 'vitest';
import {checkDiagramSource,mathOptions,renderMath,renderMermaid} from '../src/ink/rich-render.ts';

const mermaid=vi.hoisted(()=>({initialize:vi.fn(),render:vi.fn()}));
vi.mock('mermaid',()=>({default:mermaid}));

it('bounds TeX, disables trust and falls back on unsafe or expanding expressions',async()=>{
 expect(mathOptions).toMatchObject({trust:false,maxExpand:100,maxSize:20});
 for(const source of ['\\href{https://example.invalid}{link}','\\includegraphics{https://example.invalid/a.png}','\\def\\a{\\a}\\a','x'.repeat(8193)]){
  await expect(renderMath(source,false)).resolves.toMatchObject({status:'source'});
 }
});

it('admits bounded diagrams and rejects directives, click, HTML and remote resources before rendering',()=>{
 expect(checkDiagramSource('flowchart TD\nA[Start] --> B[Finish]')).toBe(true);
 for(const source of ['flowchart TD\nA-->B\nclick A "https://example.invalid"','%%{init: {}}%%\nflowchart TD\nA-->B','flowchart TD\nA["<img src=https://example.invalid>"]-->B','flowchart TD\nA@{img:"https://example.invalid"}','flowchart TD\n'+ 'A-->B\n'.repeat(81)]){
  expect(checkDiagramSource(source)).toBe(false);
 }
});

it('a cancelled Mermaid job returns source before loading or touching a document',async()=>{
 const stop=new AbortController();
 stop.abort();
 await expect(renderMermaid('graph TD\nA-->B','light',stop.signal)).resolves.toMatchObject({status:'source'});
});

it('falls back on the deadline and holds the shared slot until the interrupted render settles',async()=>{
 vi.useFakeTimers();
 const stage={remove:vi.fn()};
 vi.stubGlobal('document',{createElement:()=>stage,body:{append:vi.fn()},getElementById:()=>null});
 let settle!: (value:{svg:string})=>void;
 mermaid.render.mockImplementationOnce(()=>new Promise(resolve=>{settle=resolve;}));
 try{
  const result=renderMermaid('graph TD\nA-->B','dark');
  await vi.dynamicImportSettled();
  expect(mermaid.render).toHaveBeenCalledTimes(1);
  expect(mermaid.initialize).toHaveBeenCalledWith(expect.objectContaining({securityLevel:'strict',htmlLabels:false,maxEdges:40}));
  await vi.advanceTimersByTimeAsync(4500);
  await expect(result).resolves.toMatchObject({status:'source',notice:expect.stringContaining('took too long')});
  expect(stage.remove).not.toHaveBeenCalled();
  settle({svg:'<svg/>'});
  await vi.advanceTimersByTimeAsync(0);
  expect(stage.remove).toHaveBeenCalledTimes(1);
 }finally{
  vi.unstubAllGlobals();
  vi.useRealTimers();
 }
});

it('rejects SVG that finishes after the elapsed deadline before the timer fires',async()=>{
 const stage={remove:vi.fn()},parse=vi.fn();
 vi.stubGlobal('document',{createElement:()=>stage,body:{append:vi.fn()},getElementById:()=>null});
 vi.stubGlobal('DOMParser',class {parseFromString=parse;});
 const clock=vi.spyOn(performance,'now').mockReturnValue(0);
 mermaid.render.mockImplementationOnce(async()=>{
  clock.mockReturnValue(4501);
  return {svg:'<svg/>'};
 });
 try{
  await expect(renderMermaid('graph TD\nA-->B','light')).resolves.toMatchObject({status:'source'});
  expect(parse).not.toHaveBeenCalled();
 }finally{
  clock.mockRestore();
  vi.unstubAllGlobals();
 }
});
