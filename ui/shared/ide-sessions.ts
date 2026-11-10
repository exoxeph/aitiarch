/** Session text is private, ephemeral context, never repository storage. */
export type SessionKind='claude-sessions'|'codex-sessions';
export interface SessionTurn {role:'user'|'assistant';text:string}
export interface SessionDetails {title:string;modifiedAt:string;messageCount:number;bytes:number;estimatedTokens:number;projectMatch:boolean;status:'ready'|'format'|'limit'|'read';notice?:string}
export const SESSION_REDACTION_NOTICE='Redaction can miss secrets in prose, unfamiliar tokens and indirect identifiers. Review before sending.';
export const SESSION_PICKER_NOTICES={format:'Session format was not recognized. This session was skipped.',limit:'Session too large: limit is 8 MiB per file, 1 MiB per line, 20,000 records, 40 messages and 20,000 characters. Nothing was cut or included.',read:'This session could not be read. Check that it still exists and is readable.',empty:'Nothing found for this project.'} as const;
export const SESSION_LIMITS=Object.freeze({fileBytes:8*1024*1024,lineBytes:1024*1024,records:20000,turns:40,characters:20000,files:500,directories:1000});
export const SESSION_NOTICES=Object.freeze({
 format:'Session format changed or is unsupported. Nothing from this session was sent.',
 limit:'Session exceeds the safe size limit. Choose a smaller session.',
 changed:'Session changed while being read. Select it again and review the new preview.',
 selection:'Choose a session from this project first.',
 privacy:'Session context and replies stay in memory. Add to note is unavailable. Review the redacted preview before every send.',
 redaction:'Redaction is best effort: unknown or encoded secrets, split credentials, ordinary personal text and proprietary code may remain. Review every source before sending.'
});
