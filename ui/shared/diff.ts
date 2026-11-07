// Pure text diff + paragraph helpers. Offsets are UTF-16 code units (same as CodeMirror 6).
// Used by the server (mixed line-ending preservation) and the client (external-change merge).

export interface Hunk {
  from: number;
  to: number;
  insert: string;
}

function splitLines(s: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < s.length) {
    const j = s.indexOf("\n", i);
    if (j < 0) {
      out.push(s.slice(i));
      break;
    }
    out.push(s.slice(i, j + 1));
    i = j + 1;
  }
  return out;
}

const MAX_CELLS = 4_000_000;

const isHigh = (c: number) => c >= 0xd800 && c <= 0xdbff;
const isLow = (c: number) => c >= 0xdc00 && c <= 0xdfff;

/** Minimal-ish hunks turning `a` into `b`: line-level LCS, then trimmed to the exact changed characters. */
export function diffText(a: string, b: string): Hunk[] {
  if (a === b) return [];
  const A = splitLines(a);
  const B = splitLines(b);
  let pre = 0;
  while (pre < A.length && pre < B.length && A[pre] === B[pre]) pre++;
  let suf = 0;
  while (suf < A.length - pre && suf < B.length - pre && A[A.length - 1 - suf] === B[B.length - 1 - suf]) suf++;
  const am = A.slice(pre, A.length - suf);
  const bm = B.slice(pre, B.length - suf);

  let base = 0;
  for (let i = 0; i < pre; i++) base += A[i].length;
  const aPos = [base];
  for (const l of am) aPos.push(aPos[aPos.length - 1] + l.length);
  const bPos = [base];
  for (const l of bm) bPos.push(bPos[bPos.length - 1] + l.length);

  // matched line pairs inside the middle
  const matches: Array<[number, number]> = [];
  const n = am.length;
  const m = bm.length;
  if (n > 0 && m > 0 && n * m <= MAX_CELLS) {
    const w = m + 1;
    const lcs = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        lcs[i * w + j] = am[i] === bm[j] ? lcs[(i + 1) * w + j + 1] + 1 : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (am[i] === bm[j]) {
        matches.push([i, j]);
        i++;
        j++;
      } else if (lcs[(i + 1) * w + j] >= lcs[i * w + j + 1]) i++;
      else j++;
    }
  }
  matches.push([n, m]); // sentinel

  const hunks: Hunk[] = [];
  let pi = 0;
  let pj = 0;
  for (const [mi, mj] of matches) {
    if (mi > pi || mj > pj) {
      let from = aPos[pi];
      let to = aPos[mi];
      let insert = b.slice(bPos[pj], bPos[mj]);
      // trim to exact characters
      const sa = a.slice(from, to);
      let p = 0;
      const maxP = Math.min(sa.length, insert.length);
      while (p < maxP && sa[p] === insert[p]) p++;
      if (p > 0 && isHigh(sa.charCodeAt(p - 1))) p--;
      let s = 0;
      const maxS = Math.min(sa.length, insert.length) - p;
      while (s < maxS && sa[sa.length - 1 - s] === insert[insert.length - 1 - s]) s++;
      if (s > 0 && isLow(sa.charCodeAt(sa.length - s))) s--;
      from += p;
      to -= s;
      insert = insert.slice(p, insert.length - s);
      if (to > from || insert.length > 0) hunks.push({ from, to, insert });
    }
    pi = mi + 1;
    pj = mj + 1;
  }
  return hunks;
}

export function applyHunks(text: string, hunks: Hunk[]): string {
  let out = "";
  let at = 0;
  for (const h of hunks) {
    out += text.slice(at, h.from) + h.insert;
    at = h.to;
  }
  return out + text.slice(at);
}

function lineStart(t: string, pos: number): number {
  return pos <= 0 ? 0 : t.lastIndexOf("\n", pos - 1) + 1;
}
function lineEnd(t: string, pos: number): number {
  const i = t.indexOf("\n", pos);
  return i < 0 ? t.length : i;
}

/** The paragraph block (maximal run of non-blank lines) containing [from,to]; a blank line is its own block. */
export function paragraphSpan(t: string, from: number, to: number): [number, number] {
  let s = lineStart(t, from);
  const firstBlank = t.slice(s, lineEnd(t, s)).trim() === "";
  if (!firstBlank) {
    while (s > 0) {
      const prevStart = lineStart(t, s - 1);
      if (t.slice(prevStart, s - 1).trim() === "") break;
      s = prevStart;
    }
  }
  let e = lineEnd(t, to);
  const lastBlank = t.slice(lineStart(t, to), e).trim() === "";
  if (!lastBlank) {
    while (e < t.length) {
      const ns = e + 1;
      const ne = lineEnd(t, ns);
      if (t.slice(ns, ne).trim() === "") break;
      e = ne;
    }
  }
  return [s, Math.max(e, s)];
}

export function spansIntersect(a: [number, number], b: [number, number]): boolean {
  return a[0] <= b[1] && b[0] <= a[1];
}
