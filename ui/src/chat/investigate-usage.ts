// How Investigate's usage is worded, in one place: the chat footer, the Settings usage tab and the usage panel all use these. Investigate is shown on its own
// and is never part of a chat's token budget (it has a dollar cap of its own, set on the plan card).
import {formatTokens} from '../../shared/chat.ts';
import type {InvestigateUsage} from '../../shared/usage.ts';

/** 0 -> "$0", 0.0123 -> "$0.012", 0.4 -> "$0.40", 12 -> "$12.00". */
export const usd=(n:number):string=>n===0?'$0':n<0.1?'$'+n.toFixed(3):'$'+n.toFixed(2);
export const turnsWord=(n:number)=>`${n} ${n===1?'turn':'turns'}`;
/** The sentence that says some counts are missing, or '' when none are. */
export const unreportedText=(u:InvestigateUsage):string=>u.unreportedTurns>0?`${turnsWord(u.unreportedTurns)} did not report every count`:'';
/** One line for the chat footer: "Investigate: 6 turns · 17k in · 3k cached · 900 out · $0.42 (2 turns did not report every count)". */
export function investigateLine(u:InvestigateUsage):string{
 const missing=unreportedText(u);
 return `Investigate: ${turnsWord(u.turns)} · ${formatTokens(u.input)} in · ${formatTokens(u.cached)} cached · ${formatTokens(u.output)} out · ${usd(u.costUsd)}${missing?` (${missing})`:''}`;
}
