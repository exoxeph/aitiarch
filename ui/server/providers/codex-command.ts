import path from 'node:path';import {statSync} from 'node:fs';
export const CODEX_VERSION='0.167.0';
export function validateCodexCommand(command:string):string{
 if(!path.isAbsolute(command)||/^(?:~|\\\\|\/\/)/.test(command)||!statSync(command,{throwIfNoEntry:false})?.isFile())throw Error('Codex needs an existing absolute local executable file.');
 return command;
}
export const codexVersionNotice=(found:string)=>`Codex unavailable: found ${found}; expected ${CODEX_VERSION}. Please start the server with --codex <path to a 0.167.0 codex>.`;
