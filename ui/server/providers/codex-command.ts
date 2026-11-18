import path from 'node:path';import {statSync} from 'node:fs';
import {TESTED_VERSION} from './cli-compatibility.ts';
export const CODEX_TESTED_VERSION=TESTED_VERSION.codex;
/** Historical export retained for callers; this is a tested baseline, not an equality gate. */
export const CODEX_VERSION=CODEX_TESTED_VERSION;
export function validateCodexCommand(command:string):string{
 if(!path.isAbsolute(command)||/^(?:~|\\\\|\/\/)/.test(command)||!statSync(command,{throwIfNoEntry:false})?.isFile())throw Error('Codex needs an existing absolute local executable file.');
 return command;
}
export const codexVersionNotice=(found:string)=>`Codex: tested ${CODEX_TESTED_VERSION}; found ${found}. Minimum ${CODEX_TESTED_VERSION} with all required help flags. Start the server with --codex <path to a compatible codex> if another binary is needed.`;
