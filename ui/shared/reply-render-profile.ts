import type {PersonaMode} from './persona.ts';

export const replyRenderProfiles={
 concise:{characters:32768,nodes:2048,depth:32},
 teaching:{characters:65536,nodes:4096,depth:32},
} as const;
export type ReplyRenderProfile=keyof typeof replyRenderProfiles;

export function profileForRole(role:string,mode?:PersonaMode):ReplyRenderProfile{
 if(mode==='grill'||mode==='plan')return 'concise';
 return mode==='explain'||['normal-chat','thread-reply','investigate-read','council'].includes(role)?'teaching':'concise';
}
