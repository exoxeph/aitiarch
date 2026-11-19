import {isDiagramIssue,readDiagram,type Diagram,type DiagramIssue} from './diagram.ts';
import {validSkillDiagramRef,type SkillDiagramRef} from './skill-diagram.ts';
import {validateGeneration,validateThread,type ThreadRecord} from './threads.ts';
import { resolveAnchor, validateAnchor, type Anchor, type Attachment } from "./anchors.ts";

export interface Generation {
  requestId: string;
  action: "think" | "ask";
  provider: "claude" | "chatgpt-plan" | "codex";
  model: string | null;
  createdAt: string;
  status: "pending" | "complete" | "error" | "cancelled";
  evidence: { sourceId: string; sourceHash: string; quote: string }[];
  dismissed: boolean;
  /** Interpretation label only. Attachment identifiers and hashes remain private. */
  imageInterpretation?:true;
  /** Names of the skills that shaped this answer. Absent in older files. Names only: never paths or skill text. */
  skills?: string[];
}

export interface InkItem {
  id: string;
  kind: "answer" | "margin";
  body: string;
  diagram?: Diagram;
  diagramIssue?: DiagramIssue;
  /** The Skill renderer's saved document (see shared/skill-diagram.ts). Shown only in a sandboxed iframe. */
  skillDiagram?: SkillDiagramRef;
  originalAnchor: Anchor;
  anchorHistory?: Anchor[];
  anchor: Anchor;
  attachment: Attachment;
  generation?: Generation;
  thread?: ThreadRecord;
}
export interface InkDocument {
  v: 2;
  note: string;
  noteVersion: string | null;
  lastSeenTextHash: string | null;
  items: InkItem[];
}

/** A saved attachment is authoritative for the exact note version it saw. */
export function resolveStoredAttachment(text: string, item: InkItem, savedVersion: string | null, currentVersion: string | null): Attachment {
  const r = item.attachment;
  if (savedVersion !== null && savedVersion === currentVersion && r.status === "attached" &&
      text.slice(r.from, r.to) === item.anchor.quote) return r;
  return resolveAnchor(text, item.anchor);
}

function keys(value: unknown, expected: string[]): boolean {
  return !!value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).sort().join(",") === expected.sort().join(",");
}

export function validateDocument(value: unknown, note: string): asserts value is InkDocument {
  const d = value as InkDocument;
  if (!keys(d, ["v", "note", "noteVersion", "lastSeenTextHash", "items"]) || d.v !== 2 || d.note !== note ||
      !(d.lastSeenTextHash === null || (typeof d.lastSeenTextHash === "string" && /^[a-f0-9]{64}$/.test(d.lastSeenTextHash))) ||
      !(d.noteVersion === null || (typeof d.noteVersion === "string" && /^[a-f0-9]{64}$/.test(d.noteVersion))) ||
      !Array.isArray(d.items) || d.items.length > 1000) throw new Error("Invalid or unsupported ink document.");
  const ids = new Set<string>();
  for (const i of d.items) {
    if (!keys(i, ["id", "kind", "body", "originalAnchor", "anchor", "attachment",
          ...(i.anchorHistory !== undefined ? ["anchorHistory"] : []), ...(i.generation !== undefined ? ["generation"] : []), ...(i.thread !== undefined ? ["thread"] : []), ...(i.diagram !== undefined ? ["diagram"] : []), ...(i.diagramIssue !== undefined ? ["diagramIssue"] : []), ...(i.skillDiagram !== undefined ? ["skillDiagram"] : [])]) ||
        typeof i.id !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(i.id) || ids.has(i.id) ||
        !["answer", "margin"].includes(i.kind) || typeof i.body !== "string" || i.body.length > 100000) throw new Error("Invalid ink item.");
    ids.add(i.id);
    if((i.diagram!==undefined&&!readDiagram(i.diagram))||(i.diagramIssue!==undefined&&!isDiagramIssue(i.diagramIssue))||(i.skillDiagram!==undefined&&!validSkillDiagramRef(i.skillDiagram)))throw new Error("Invalid ink diagram.");
    if (i.generation !== undefined) validateGeneration(i.generation,i.id);
    if (i.thread !== undefined) validateThread(i.thread,i.id);
    if (i.anchorHistory !== undefined && (!Array.isArray(i.anchorHistory) || i.anchorHistory.length > 100)) throw new Error("Invalid ink anchor history.");
    for (const a of [i.anchor, i.originalAnchor, ...(i.anchorHistory ?? [])]) {
      if (!keys(a, ["quote", "prefix", "suffix", "position", "quoteCount", "contextCount"]) || !keys(a.position, ["from", "to"])) throw new Error("Invalid ink anchor.");
      validateAnchor(a);
    }
    const r = i.attachment;
    if (r?.status === "attached") {
      if (!keys(r, ["status", "from", "to"]) || r.from !== i.anchor.position.from || r.to !== i.anchor.position.to) throw new Error("Invalid ink attachment.");
    } else if (r?.status !== "orphaned" || !keys(r, ["status", "reason"]) || !["missing", "ambiguous", "note-missing"].includes(r.reason)) {
      throw new Error("Invalid ink attachment.");
    }
  }
}

// Sort recursively so caller object insertion order cannot churn diffs.
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => [k, stable(v)]));
  return value;
}
export const serializeInk = (document: InkDocument): string => JSON.stringify(stable(document), null, 2) + "\n";
