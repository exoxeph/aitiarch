// Which project this page belongs to. The launch link carries ?project=<id>; every project API call then goes to /api/p/<id>/...
// The host's own routes (/api/projects*, /api/health) stay unprefixed. With no project (a --dev-session launch) nothing changes.
const ID=/^[0-9a-f]{12}$/;

export function projectFromSearch(search:string):string|null{
 const v=new URLSearchParams(search).get('project');
 return v&&ID.test(v)?v:null;
}

let current:string|null=typeof location!=='undefined'?projectFromSearch(location.search):null;
export const getProject=()=>current;
export const setProject=(id:string|null)=>{current=id&&ID.test(id)?id:null;};

export function scoped(url:string,id:string|null=current):string{
 if(!id||!url.startsWith('/api/')||/^\/api\/(projects|health|p)(\/|\?|$)/.test(url))return url;
 return `/api/p/${id}/${url.slice(5)}`;
}
