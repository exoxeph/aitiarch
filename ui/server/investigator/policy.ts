import path from 'node:path';
import {lstat,realpath} from 'node:fs/promises';
import {UiStateStore} from '../ui-state-store.ts';
import {DEFAULT_INVESTIGATOR,InvestigatorError,validatePolicy,type InvestigatorPolicy,type Permission,type Tier} from '../../shared/investigator.ts';
export const inside=(root:string,file:string)=>{const r=path.relative(root,file);return !r||!r.startsWith('..')&&!path.isAbsolute(r);};
/** Includes local session stores: an investigator must not accidentally read a transcript. */
export function deniedPath(name:string){return name.replace(/\\/g,'/').split('/').some(p=>/^\.env|\.pem$|^id_|credentials|secrets|\.private\.|^ui-state\.json|^(?:node_modules|\.git|\.claude|\.codex|chat|runs|measurements|backups)$/i.test(p));}
export class PolicyGate {
 private store:UiStateStore;private project:string;private memory:InvestigatorPolicy|null=null;private grants=new Map<string,Set<Tier>>();private once=new Map<string,Set<Tier>>();
 constructor(store:UiStateStore,project:string){this.store=store;this.project=project;}
 async status(){const saved=await this.store.investigatorPolicy(),policy=this.memory??saved??{v:1 as const,enabled:false,roots:[this.project],tiers:{inside:'notebook' as const,outside:'ask' as const,commands:'notebook' as const},outsideEnabled:false,commands:[],settings:{...DEFAULT_INVESTIGATOR}};return {policy:structuredClone(policy),persistence:!!saved,ignoreLine:'/ui-state.json*',notice:'Permissions are private. Add /ui-state.json* with the explicit setup button to remember them.',fallback:'Tools off; lookups run in the app. Codex agents blocked.'};}
 async configure(patch:Partial<InvestigatorPolicy>){const current=(await this.status()).policy,policy=validatePolicy({...current,...patch,v:1});
  if(policy.roots.some(r=>!path.isAbsolute(r)||deniedPath(r)))throw new InvestigatorError('invalid_policy');
  for(const root of policy.roots){const real=await realpath(root);if(path.resolve(root)!==real||!(await lstat(root)).isDirectory())throw new InvestigatorError('invalid_policy');}
  this.memory=policy;this.grants.clear();this.once.clear();if((await this.store.draftStatus()).enabled)await this.store.saveInvestigatorPolicy(policy);return this.status();
 }
 async grant(chat:string,tier:Tier,duration:Permission){if(!['inside','outside','commands'].includes(tier)||!['ask','chat','notebook'].includes(duration)||typeof chat!=='string'||chat.length>100)throw new InvestigatorError('invalid_policy');
  const p=(await this.status()).policy;if(!p.enabled||tier==='outside'&&!p.outsideEnabled)throw new InvestigatorError('blocked');
  if(duration==='notebook'){if(!(await this.store.draftStatus()).enabled)throw new InvestigatorError('invalid_policy');await this.configure({tiers:{...p.tiers,[tier]:'notebook'}});}
  else {const map=duration==='chat'?this.grants:this.once;if(map.size>100)throw new InvestigatorError('busy');const set=map.get(chat)??new Set<Tier>();set.add(tier);map.set(chat,set);}
 }
 async authorize(chat:string,tier:Tier,_target:string){const p=(await this.status()).policy;if(!p.enabled)throw new InvestigatorError('disabled');if(tier==='outside'&&!p.outsideEnabled)throw new InvestigatorError('blocked');
  if(p.tiers[tier]==='notebook'||this.grants.get(chat)?.has(tier))return;
  if(this.once.get(chat)?.delete(tier))return;throw new InvestigatorError('permission_required');
 }
 async file(chat:string,target:string,permission=true){
  if(typeof target!=='string'||!target||target.length>1000||/[\0<>"|?*]/.test(target)||target.replace(/^[A-Za-z]:/,'').includes(':')||target.replace(/\\/g,'/').split('/').some(p=>p==='..'||p!=='.'&&/[. ]$/.test(p)))throw new InvestigatorError('blocked');
  const policy=(await this.status()).policy,file=path.resolve(policy.roots[0],target);
  if(deniedPath(file))throw new InvestigatorError('blocked');
  const root=policy.roots.find(r=>inside(r,file)),tier=root?'inside':'outside';if(permission)await this.authorize(chat,tier,target);else if(!root&&!policy.outsideEnabled)throw new InvestigatorError('blocked');
  // Refuse every link/reparse component, not just a final realpath escape. Never traverse a junction.
  let current=path.parse(file).root;for(const part of file.slice(current.length).split(path.sep).filter(Boolean)){current=path.join(current,part);const stat=await lstat(current);if(stat.isSymbolicLink()||stat.isFile()&&stat.nlink!==1)throw new InvestigatorError('blocked');}
  const actual=await realpath(file);if(actual!==file||root&&!inside(root,actual))throw new InvestigatorError('blocked');return actual;
 }
 async withinScope(chat:string,target:string,scope:string[]){const file=await this.file(chat,target),allowed=await Promise.all(scope.map(s=>this.file(chat,s,false)));if(!allowed.some(s=>inside(s,file)))throw new InvestigatorError('blocked');return file;}
 clearChat(chat:string){this.grants.delete(chat);this.once.delete(chat);}
}
