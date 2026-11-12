export function claudeArguments(options: { stream?: boolean; hardening?: readonly string[]; partial?:boolean } = {}): string[] {
  return ['-p', '--safe-mode', '--no-session-persistence', ...(options.hardening ?? []),
    '--tools', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
    '--setting-sources', '', '--settings', '{"disableAllHooks":true}', '--disable-slash-commands',
    '--output-format', options.stream ? 'stream-json' : 'json',
    ...(options.stream ? ['--verbose', '--include-hook-events'] : []),...(options.partial?['--include-partial-messages']:[])];
}
/** A chat harness session: no tools, no settings, MCP, hooks or slash commands; the conversation is kept by the CLI under the app-chosen id
 *  (--session-id on the first turn, --resume after). The app's instruction and the pasted notes come from a file, never argv. */
export const chatSessionArguments=(p:{id:string;resume:boolean;addendumFile:string;model?:string})=>['-p','--safe-mode','--tools','','--strict-mcp-config','--mcp-config','{"mcpServers":{}}',
  '--setting-sources','','--settings','{"disableAllHooks":true}','--disable-slash-commands','--output-format','stream-json','--verbose','--include-hook-events','--include-partial-messages',
  ...(p.model?['--model',p.model]:[]),p.resume?'--resume':'--session-id',p.id,'--append-system-prompt-file',p.addendumFile];
export const investigatorArguments=()=>[...claudeArguments({stream:true,partial:true}),'--permission-mode','dontAsk'];
