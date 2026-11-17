import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it} from 'vitest';
import {NotesMenu} from '../src/menu/NotesMenu.tsx';
import {EdgeMenuController} from '../src/menu/edge-menu.ts';
it('offers a native Decisions button alongside Search in the notes menu',()=>{
 const html=renderToStaticMarkup(<NotesMenu menu={{open:true,pinned:true,focusTick:0,toggle:()=>{},controller:new EdgeMenuController(()=>{})}} burger={{current:null}} rootName="Synthetic" rootPath="fixture" tree={null} active={null} onOpen={()=>{}} onSearch={()=>{}} onDecisions={()=>{}} onSettings={()=>{}} usage={null} settings={null} onTreeChanged={()=>{}} onMoved={()=>{}} blocked={()=>null}/>);
 expect(html).toMatch(/<button[^>]*><span>Decisions<\/span><\/button>/);
});
