/** Pinned from the Codex spike's c2/c3/c5 tool-less canaries.
 * Read-only is containment, NOT a no-read guarantee. The host kills every action item.
 * Explicit names only: CLI changes must fail closed rather than drop a flag. */
export const CODEX_FLAGS=Object.freeze(['exec','--json','--ephemeral','--skip-git-repo-check','--color','never','--ignore-user-config','--ignore-rules','-s','read-only','-c','web_search="disabled"','-c','project_doc_max_bytes=0',...['shell_tool','unified_exec','view_image','apps','plugins','hooks','browser_use','computer_use','image_generation','skill_search','tool_suggest','multi_agent','multi_agent_v2','goals','memories','code_mode_host','code_mode_interrupt','sleep_tool','write_stdin_approval','incremental_tools'].flatMap(f=>['--disable',f])]);
export const TOOLLESS_AGENT='aitiarch-tool-less';
