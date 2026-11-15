// The fence around a conversation turn that may open diagram pictures with Read. The server enforces it (server/harness/diagram-watch.ts); the page only words it.
// Pure and shared. The fence was verified on one CLI version (the probe: with the working folder holding only PNGs, Read denied every path outside it); a different version is flagged in Settings.

/** The Claude Code CLI version the diagram fence was verified on. */
export const TESTED_CLI_VERSION='2.1.205';
/** The most a conversation turn that may open diagrams can cost, passed to the CLI as --max-budget-usd. It is the Investigate plan's default cap. */
import {DEFAULT_PIPELINE_CONFIG} from './pipeline-config.ts';
export const DIAGRAM_TURN_CAP_USD=DEFAULT_PIPELINE_CONFIG.diagram.turnCapUsd;
/** The app kills the turn on the next tool event after this many. */
export const DIAGRAM_MAX_TOOL_EVENTS=12;

/** Why a diagram of the note cannot be opened in a turn. Withheld diagrams are listed (review card and manifest) with the reason, and are never copied into the turn's folder. */
export const WITHHELD_REASONS=['no_picture','too_large','too_many_pixels','bad_file','secret','page','too_many'] as const;
export type WithheldReason=typeof WITHHELD_REASONS[number];
/** The words for each reason, the same on the review card, in the manifest the model reads and in the chat. */
export const WITHHELD_WORDS:Record<WithheldReason,string>={
 no_picture:'no picture yet',
 too_large:'too large (its picture is over 500 KB)',
 too_many_pixels:'too many pixels (its picture is over 1,600 px on a side)',
 bad_file:'bad file (its picture or saved drawing is damaged or does not match its name)',
 secret:'looks like a secret (it holds text that looks like a secret)',
 page:'interactive page only, no picture',
 too_many:'more than nine diagrams in the note (only D1 to D9 can be opened)',
};
/** Why a turn that may open diagrams was stopped by the app (or by the CLI's own cost cap). */
export const FENCE_CODES=['outside_path','tool_refused','isolation','tool_limit','folder','budget','unavailable_again'] as const;
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
 unavailable_again:'it kept trying to open a diagram that is withheld',
};
/** The sentence the chat shows for a stopped turn. `capUsd` is the cap the turn had. */
export const fenceText=(code:FenceCode,capUsd?:number)=>code==='budget'&&capUsd!==undefined?`The turn reached its cost cap of $${capUsd.toFixed(2)}, so it was stopped. Nothing from it was kept.`:`The turn was stopped: ${FENCE_WORDS[code]}. Nothing from it was kept.`;
