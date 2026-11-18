import type {SelectedCli} from './platform/cli-selection.ts';
import {providerCapabilities} from './providers/registry.ts';
import {loadMachineSetup, saveMachineSetup, SetupError} from './setup-store.ts';
import {initProject, privateProtection} from './init.ts';
import {LAUNCH_ROLE_LOCK, MODEL_ROLES, ROLE_REGISTRY, SETUP_PROVIDERS, SETUP_ROLES, roleDefinition, validCouncilParticipants, type MachineSetup, type ModelEffort, type SetupProvider, type SetupRole, type SetupView} from '../shared/setup.ts';
import {modelArguments, modelSelection} from '../shared/model-settings.ts';

const labels = {claude:'Claude', codex:'Codex', kiro:'Kiro'};
const wiredBridges = {invoked:true, 'thread-reply':true, 'investigate-read':true, 'skill-diagram':true};
const writes = new Map<string, Promise<unknown>>();

export class SetupRequestError extends Error {}

/** Called behind the ordinary project API session and origin guards. */
export function createSetupHttp(options: {
 dir:string;
 project:string;
 providers:readonly SelectedCli[];
 overrides?:Partial<Record<SetupProvider,string>>;
 ready:()=>Promise<boolean>;
}) {
 const capable = (role:SetupRole) => options.providers.filter(p =>
  p.isolation==='metadata-compatible' && providerCapabilities(p.id, wiredBridges)[roleDefinition(role).capability]
 ).map(p => p.id);
 const launchLocked = (provider:SetupProvider|null) => provider!==null && options.overrides?.[provider]!==undefined;
 const enabledCouncil = (setup:MachineSetup) => capable('council').filter(id=>setup.providers[id].enabled);
 const effortSupported = (id:SetupProvider) => id==='claude' && options.providers.some(p =>
  p.id===id && p.effort===true && p.effortCode==='help_flag_present');

 async function get():Promise<SetupView> {
  const [setup, protection, ready] = await Promise.all([
   loadMachineSetup(options.dir), privateProtection(options.project), options.ready(),
  ]);
  return {
   ready, seen:setup.setupSeen===true,
   fontSize:setup.fontSizeConfigured||setup.fontSize!==16 ? setup.fontSize : null,
   models:MODEL_ROLES.flatMap(role=>capable(role)
    .filter(provider=>role==='council'||provider===setup.roles[role])
    .map(provider=>({role,provider,effortSupported:effortSupported(provider),
     selection:setup.providers[provider].roles[role]??null,
     effective:modelSelection(setup,role,provider)}))),
   providers:options.providers.map(p => ({
    id:p.id, label:labels[p.id], path:p.path, version:p.version, reason:p.reason,
    notices:p.notices?.map(n=>n.message)??[], compatible:p.isolation==='metadata-compatible',
    source:launchLocked(p.id)?'explicit flag':setup.providers[p.id].executable?'saved choice':p.path?'discovered':'default',
   })),
   roles:ROLE_REGISTRY.map(def => {
    const role=def.id;
    const routingNote='routingNote' in def ? def.routingNote : undefined;
    const capableProviders = capable(role);
    const provider = routingNote ? capableProviders.includes('claude') ? 'claude' : null : setup.roles[role];
    const savedChoice = provider!==null && !setup.defaultRoles?.includes(role);
    const locked = !def.multiple && launchLocked(provider) ? LAUNCH_ROLE_LOCK : undefined;
    const source = routingNote
     ? launchLocked('claude') ? 'explicit flag' : setup.providers.claude.executable ? 'saved choice' : 'default'
     : def.multiple ? setup.councilParticipants===undefined ? 'default' : 'saved choice'
     : locked ? 'explicit flag' : savedChoice ? 'saved choice' : 'default';
    const eligibleParticipants = def.multiple ? enabledCouncil(setup) : undefined;
    const participants = eligibleParticipants && (setup.councilParticipants??eligibleParticipants);
    let reason = null;
    if (participants && eligibleParticipants) reason = participants.filter(id=>eligibleParticipants.includes(id)).length<2 ? 'Council needs at least two enabled, compatible providers.' : null;
    else if (!capableProviders.length) reason = 'No detected compatible provider can perform this role.';
    else if (provider === null) reason = 'No provider is assigned to this role.';
    else if (!capableProviders.includes(provider)) reason = 'The saved provider is unavailable for this role.';
    else if (!routingNote && !setup.providers[provider].enabled) reason = 'The saved provider is disabled.';
    return {role, provider, capableProviders, reason, source, ...(participants ? {participants,eligibleParticipants} : {}), ...(locked ? {locked} : {}),
     ...(routingNote ? {routingNote} : {})};
   }),
   privacy:{mode:'private', sharedReady:protection.sharedReady, notice:protection.messages.join(' ')},
  };
 }

 async function put(body:unknown):Promise<void> {
  if (!body || typeof body!=='object' || Array.isArray(body)) throw new SetupError('setup_invalid');
  const data = body as Record<string,unknown>;
  const keys = Object.keys(data);
  const seen = keys.length===1 && data.seen===true;
  const font = keys.length===1 && Object.hasOwn(data,'fontSize');
  const role = data.role as SetupRole;
  const provider = data.provider as SetupProvider;
  const def = SETUP_ROLES.includes(role) ? roleDefinition(role) : undefined;
  const model = keys.length===3 && def?.modelSettings && Object.hasOwn(data,'selection') && SETUP_PROVIDERS.includes(provider);
  const assignment = keys.length===2 && SETUP_PROVIDERS.includes(provider);
  const reset = keys.length===2 && data.reset===true;
  const participants = keys.length===2 && def?.multiple && validCouncilParticipants(data.participants) ? data.participants : undefined;
  if (!seen && !font && (!def || !(model||assignment||reset||participants)))
   throw new SetupError('setup_invalid');
  if (font && (!Number.isInteger(data.fontSize) || Number(data.fontSize)<14 || Number(data.fontSize)>24))
   throw new SetupRequestError('Choose a whole-number font size from 14 to 24 px.');
  if ((model||assignment) && !capable(role).includes(provider))
   throw new SetupRequestError('Choose a detected compatible provider that supports this role.');
  const routingNote = def && 'routingNote' in def ? def.routingNote : undefined;
  if (routingNote) throw new SetupRequestError(routingNote);
  const selection=data.selection as ModelEffort|null;
  if (model && selection!==null) {
   if (!selection || typeof selection!=='object' || Array.isArray(selection))
    throw new SetupRequestError('Invalid model selection.');
   try {modelArguments(provider,selection,effortSupported(provider));}
   catch (error) {throw new SetupRequestError((error as Error).message);}
  }

  const write = (writes.get(options.dir)??Promise.resolve()).catch(()=>{}).then(async () => {
   const setup = await loadMachineSetup(options.dir);
   if (seen) setup.setupSeen = true;
   else if (font) {
    setup.fontSize=Number(data.fontSize);
    setup.fontSizeConfigured=true;
   } else if (!def?.multiple && (launchLocked(setup.roles[role])||((assignment||model)&&launchLocked(provider)))) {
    throw new SetupRequestError(LAUNCH_ROLE_LOCK);
   } else if (reset) {
    for(const id of SETUP_PROVIDERS) delete setup.providers[id].roles[role];
    if(def?.multiple) delete setup.councilParticipants;
    else {
     setup.roles[role]=SETUP_PROVIDERS.find(id=>capable(role).includes(id)&&setup.providers[id].enabled&&!launchLocked(id))??null;
     setup.defaultRoles=[...new Set([...(setup.defaultRoles??[]),role])];
    }
   } else if (participants) {
    if (participants.some(id=>!enabledCouncil(setup).includes(id)))
     throw new SetupRequestError('Choose only enabled, detected compatible Council participants.');
    setup.councilParticipants=SETUP_PROVIDERS.filter(id=>participants.includes(id));
   } else if(model) {
    if(role!=='council'&&setup.roles[role]!==provider)
     throw new SetupRequestError('The assigned provider changed. Reopen setup and try again.');
    if(def?.multiple && setup.councilParticipants && !setup.councilParticipants.includes(provider))
     throw new SetupRequestError('Add this provider to Council participants first.');
    if(selection===null) delete setup.providers[provider].roles[role];
    else setup.providers[provider].roles[role]=selection;
   }
   else {
    setup.roles[role] = provider;
    if (setup.defaultRoles) setup.defaultRoles = setup.defaultRoles.filter(item=>item!==role);
   }
   await saveMachineSetup(options.dir, setup);
  });
  writes.set(options.dir, write);
  try { await write; }
  finally { if (writes.get(options.dir)===write) writes.delete(options.dir); }
 }

 async function init(body:unknown) {
  if (!body || typeof body!=='object' || Object.keys(body).length!==1 ||
      !('confirmIgnore' in body) || body.confirmIgnore!==true)
   throw new SetupRequestError('Confirm the private Git ignore rule before applying it.');
  return initProject({project:options.project, sharing:'private', confirmIgnore:true});
 }
 return {get, put, init};
}
