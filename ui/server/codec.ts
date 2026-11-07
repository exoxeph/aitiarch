// Byte-exact note codec. The editor only ever sees LF-normalised text; the file keeps its BOM and
// its exact line endings (uniform LF/CRLF/CR, or mixed) because encode() re-emits them per line.
import { createHash } from "node:crypto";
import { diffText } from "../shared/diff.ts";

export type Break = "\n" | "\r\n" | "\r";
export type EolLabel = "LF" | "CRLF" | "CR" | "mixed" | "none";

export interface Decoded {
  text: string; // LF-normalised, BOM stripped
  bom: boolean;
  breaks: Break[]; // one entry per line break in the original, in order
  version: string; // sha256 hex of the raw bytes
  size: number;
}

export class NotUtf8Error extends Error {
  constructor() {
    super("File is not valid UTF-8; refusing to open it so no bytes are changed.");
  }
}

export const versionOf = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

export function decode(bytes: Buffer): Decoded {
  const bom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const body = bom ? bytes.subarray(3) : bytes;
  let str: string;
  try {
    str = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(body);
  } catch {
    throw new NotUtf8Error();
  }
  const breaks: Break[] = [];
  const text = str.replace(/\r\n|\r|\n/g, (m) => {
    breaks.push(m as Break);
    return "\n";
  });
  return { text, bom, breaks, version: versionOf(bytes), size: bytes.length };
}

export function eolLabel(d: Pick<Decoded, "breaks">): EolLabel {
  const kinds = new Set(d.breaks);
  if (kinds.size === 0) return "none";
  if (kinds.size > 1) return "mixed";
  const k = [...kinds][0];
  return k === "\n" ? "LF" : k === "\r\n" ? "CRLF" : "CR";
}

function dominant(breaks: Break[]): Break {
  const counts = new Map<Break, number>();
  for (const b of breaks) counts.set(b, (counts.get(b) ?? 0) + 1);
  let best: Break = "\n";
  let n = 0;
  for (const [k, c] of counts) if (c > n) [best, n] = [k, c];
  return best;
}

/** Re-encode edited LF-text using the original file's BOM and line endings. */
export function encode(text: string, orig: Decoded): Buffer {
  const kinds = new Set(orig.breaks);
  let out: string;
  if (kinds.size <= 1) {
    const kind: Break = orig.breaks[0] ?? "\n";
    out = kind === "\n" ? text : text.replace(/\n/g, kind);
  } else {
    // mixed endings: keep each surviving line's own ending, new lines get the dominant one
    const fallback = dominant(orig.breaks);
    const oldKindAt = new Map<number, Break>();
    let k = 0;
    for (let i = orig.text.indexOf("\n"); i >= 0; i = orig.text.indexOf("\n", i + 1)) oldKindAt.set(i, orig.breaks[k++]);
    const hunks = diffText(orig.text, text);
    const toOld = (pos: number): number | undefined => {
      let shift = 0;
      for (const h of hunks) {
        const start = h.from + shift;
        if (pos < start) return pos - shift;
        if (pos < start + h.insert.length) return undefined;
        shift += h.insert.length - (h.to - h.from);
      }
      return pos - shift;
    };
    out = "";
    let at = 0;
    for (let i = text.indexOf("\n"); i >= 0; i = text.indexOf("\n", i + 1)) {
      const old = toOld(i);
      out += text.slice(at, i) + ((old !== undefined ? oldKindAt.get(old) : undefined) ?? fallback);
      at = i + 1;
    }
    out += text.slice(at);
  }
  const body = Buffer.from(out, "utf8");
  return orig.bom ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), body]) : body;
}
