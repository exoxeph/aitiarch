import {useEffect,useState} from 'react';
import App from './App.tsx';
import {Home} from './home/Home.tsx';
import {api} from './api.ts';
import {getProject} from './project-base.ts';

/** Home when asked for (?home) or when no project was chosen; the notebook when the launch link named one (or a single project was opened with --root). */
export default function Root(){
 const wantsHome=new URLSearchParams(location.search).has('home');
 const [mode,setMode]=useState<'checking'|'home'|'project'>(wantsHome?'home':getProject()?'project':'checking');
 useEffect(()=>{
  if(mode!=='checking')return;
  api.session().then(s=>setMode((s as {projects?:boolean}).projects?'home':'project')).catch(()=>setMode('project'));
 },[mode]);
 if(mode==='home')return <Home/>;
 if(mode==='project')return <App/>;
 return <div className="home-loading" role="status">Opening…</div>;
}
