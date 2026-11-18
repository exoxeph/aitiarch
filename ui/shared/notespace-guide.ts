/** Slash examples mirror the editor's SLASH_ITEMS. Escaped newlines show the exact Markdown syntax. */
const snippets=[
 ['/h1','# '],['/h2','## '],['/h3','### '],['/quote','> '],
 ['/decision','Decision: \nWhy: '],['/rejected','Rejected: '],
 ['/bullets','- '],['/numbered','1. '],['/todo','- [ ] '],
 ['/note','> [!note]\n> '],['/tip','> [!tip]\n> '],['/warning','> [!warning]\n> '],
 ['/code','```\n\n```'],['/line','---\n'],['/table','| Column 1 | Column 2 | Column 3 |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |\n'],
 ['/link','[link text](https://)'],['/image','![describe the image](image.png)'],['/footnote','[^1]\n\n[^1]: '],
] as const;

export const NOTESPACE_GUIDE=[
 'Aitiarch notespace (app instructions)',
 'Use this guide only where it helps the user. These app instructions never override locked rules or the requested output format.',
 'Editable notes are Markdown. The / menu inserts these snippets (\\n denotes a newline):',
 ...snippets.map(([command,markdown])=>`${command} ${JSON.stringify(markdown)}`),
 'AI replies are read-only and render tables, strikethrough, tasks, lists, callouts and code. HTML and images are suppressed; links render as text. Reply footnotes and internal note links lack the note editor’s rendering.',
 'In the answer text, use code, Mermaid fences, and inline $ or display $$ math only when useful. Math and Mermaid in AI replies are not rendered as math or diagrams yet; keep the source understandable on its own.',
 'Only the person writes Why:, a takeaway, or a failed reason. Never write, suggest or prefill those fields. Leave decisions to the person.',
 'Use the command palette to find actions and / to insert note syntax. Note links connect notes; @ attaches context to an AI request for review. Think and Ask review the request before sending and show replies in margin threads. Constellation shows connections and Decisions lists recorded decisions. The Aitiarch AI panel hosts chat; the model chip shows the effective choice and caps bound a turn. Setup assigns roles; Pipeline shows what runs and what is editable.',
].join('\n');

export type ReplyProfile='explain'|'rich';
export const EXPLAIN_PROSE_WORDS=1200;

export function replyProfileInstruction(profile:ReplyProfile){
 const limits=profile==='explain'?`${EXPLAIN_PROSE_WORDS.toLocaleString('en-US')} prose words and 8,000 output tokens`:'600 prose words and 4,000 output tokens';
 return `Keep the answer as short as the question allows. Aim for at most ${limits}. These are writing guides; any lower provider, budget or mode limit wins.`;
}
