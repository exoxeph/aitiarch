import type {SetupRole} from './setup.ts';

export const CODEX_SKILL_ROLES=['normal-chat','invoked','thread-reply','skill-diagram','council'] as const satisfies readonly SetupRole[];
export type CodexSkillRole=typeof CODEX_SKILL_ROLES[number];
export const isCodexSkillRole=(value:unknown):value is CodexSkillRole=>CODEX_SKILL_ROLES.some(role=>role===value);
export type CodexSkillClassification='read-only'|'writes'|'network'|'shell'|'needs review';

export interface CodexSkillMetadata {
 readonly name:string;
 readonly description:string;
 readonly pathHash:string;
 readonly contentHash:string|null;
 readonly classification:CodexSkillClassification;
 readonly reason:string;
}

export interface CodexSkillStatus {
 readonly skills:readonly (CodexSkillMetadata&{approvedRoles:readonly SetupRole[];changedRoles:readonly SetupRole[]})[];
 readonly nativeUnavailable:string;
 readonly storageReason?:string;
}

export interface CodexSkillChange {
 role:CodexSkillRole;
 pathHash:string;
 enabled:boolean;
 contentHash?:string;
}
