// The local server's front door, shared by the single-project app and the multi-project host.
//  - Host must be one of our loopback names on the bound port (blocks DNS rebinding).
//  - Origin, when present, must be one of ours (no CORS is ever sent).
//  - A random per-launch token becomes an HttpOnly cookie. In launch mode the browser gets it only through the launch link
//    the launcher opens (`/?launch=<token>`); otherwise any same-origin page load may ask for it (tests and embedded use).
import {randomBytes,timingSafeEqual} from 'node:crypto';

export interface SecurityOptions {port:()=>number;extraOrigins?:string[];requireLaunch?:boolean;token?:string}
export interface Security {
 readonly token:string;
 hostOk(host:string|undefined):boolean;
 originOk(origin:string):boolean;
 tokenOk(cookieHeader:string|undefined):boolean;
 cookie():string;
 launch(url:URL):'ok'|'bad'|'none';
 sessionAllowed(cookieHeader:string|undefined):boolean;
}
const NAMES=['127.0.0.1','localhost','aitiarch.localhost'];

export function createSecurity(o:SecurityOptions):Security{
 const token=o.token??randomBytes(24).toString('hex'),extra=new Set((o.extraOrigins??[]).map(x=>x.toLowerCase()));
 const same=(a:string)=>{const x=Buffer.from(a),y=Buffer.from(token);return x.length===y.length&&timingSafeEqual(x,y);};
 const tokenOk=(cookie:string|undefined)=>{const m=/(?:^|;\s*)aitiarch=([0-9a-f]+)/.exec(cookie??'');return !!m&&same(m[1]);};
 return {
  token,
  hostOk:host=>{const h=(host??'').toLowerCase(),p=o.port();return p>0&&NAMES.some(n=>h===`${n}:${p}`)||extra.has(`http://${h}`);},
  originOk:origin=>{const v=origin.toLowerCase(),p=o.port();return p>0&&NAMES.some(n=>v===`http://${n}:${p}`)||extra.has(v);},
  tokenOk,
  cookie:()=>`aitiarch=${token}; Path=/; HttpOnly; SameSite=Strict`,
  launch:url=>{const t=url.searchParams.get('launch');return t===null?'none':same(t)?'ok':'bad';},
  sessionAllowed:cookie=>!o.requireLaunch||tokenOk(cookie),
 };
}
