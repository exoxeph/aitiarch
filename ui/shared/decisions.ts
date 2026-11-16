/** Human-written Markdown only. Line numbers are one-based; input is never rewritten. */
export interface NoteDecision {
  decision: string;
  why: string;
  rejected: string[];
  lineNumber: number;
}

export function parseDecisions(markdown: string): NoteDecision[] {
  const entries: NoteDecision[] = [];
  let current: NoteDecision | undefined;
  let fence: {mark: string; length: number} | undefined;
  const lines = markdown.split(/\r\n|\n|\r/);
  for (let index = 0; index < lines.length; index++) {
    const line = index === 0 ? lines[index].replace(/^\ufeff/, '') : lines[index];
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (marker && marker[1][0] === fence.mark && marker[1].length >= fence.length && !marker[2].trim()) fence = undefined;
      continue;
    }
    if (marker && !(marker[1][0] === '`' && marker[2].includes('`'))) {
      fence = {mark: marker[1][0], length: marker[1].length};
      current = undefined;
      continue;
    }
    const field = /^\s*(?:-\s+)?(?:\*\*(Decision|Why|Rejected):\*\*|\*\*(Decision|Why|Rejected)\*\*:|(Decision|Why|Rejected):)[ \t]*(.*)$/i.exec(line);
    if (!field) { current = undefined; continue; }
    const kind = (field[1] ?? field[2] ?? field[3]).toLowerCase();
    const text = field[4].trim();
    if (kind === 'decision' || (kind === 'rejected' && !current)) {
      current = {decision: kind === 'decision' ? text : '', why: '', rejected: [], lineNumber: index + 1};
      entries.push(current);
    }
    if (kind === 'why' && current) current.why += (current.why ? '\n' : '') + text;
    if (kind === 'rejected' && current) current.rejected.push(text);
  }
  return entries;
}
