// The fence around a conversation turn that may open diagram pictures with Read. The server enforces it (server/harness/diagram-watch.ts); the page only words it.
// Pure and shared. The fence was verified on one CLI version (the probe: with the working folder holding only PNGs, Read denied every path outside it); a different version is flagged in Settings.

/** The Claude Code CLI version the diagram fence was verified on. */
export const TESTED_CLI_VERSION='2.1.205';
/** The most a conversation turn that may open diagrams can cost, passed to the CLI as --max-budget-usd. It is the Investigate plan's default cap. */
export const DIAGRAM_TURN_CAP_USD=0.5;
/** The app kills the turn on the next tool event after this many. */
export const DIAGRAM_MAX_TOOL_EVENTS=12;

/** Why a turn that may open diagrams was stopped by the app (or by the CLI's own cost cap). */
export const FENCE_CODES=['outside_path','tool_refused','isolation','tool_limit','folder','budget'] as const;
export type FenceCode=typeof FENCE_CODES[number];
export const isFenceCode=(v:unknown):v is FenceCode=>typeof v==='string'&&(FENCE_CODES as readonly string[]).includes(v);
/** One clause per cause, finishing "Claude was stopped: ...". */
export const FENCE_WORDS:Record<FenceCode,string>={
 outside_path:'it tried to open something that is not one of the diagram pictures',
 tool_refused:'it tried to use a tool it is not allowed',
 isolation:'the Claude Code CLI did not behave the way Aitiarch requires (a hook, a permission or an unexpected session)',
 tool_limit:`it opened more than ${DIAGRAM_MAX_TOOL_EVENTS} files in one turn`,
 folder:'the diagram folder held something Aitiarch did not put there',
 budget:'it reached the cost cap for one turn',
};
/** The sentence the chat shows for a stopped turn. `capUsd` is the cap the turn had. */
export const fenceText=(code:FenceCode,capUsd?:number)=>code==='budget'&&capUsd!==undefined?`The turn reached its cost cap of $${capUsd.toFixed(2)}, so it was stopped. Nothing from it was kept.`:`The turn was stopped: ${FENCE_WORDS[code]}. Nothing from it was kept.`;
