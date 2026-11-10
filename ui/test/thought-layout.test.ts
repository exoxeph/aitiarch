// Position tests for margin blobs and their connectors (pure functions; no browser).
import { describe, expect, it } from 'vitest';
import { BLOB_EDGE, BLOB_GAP_MAX, BLOB_GAP_MIN, BLOB_MAX, BLOB_MIN, BLOB_RESERVE, blobBox, connectorD, connectorPath, connectorVisible, layoutThoughts } from '../shared/thoughts.ts';

const column = (w: number) => { const col = Math.min(760, w - BLOB_RESERVE); return { left: (w - col) / 2, right: (w + col) / 2 }; };

describe('blob placement beside the note column', () => {
  it.each([1216, 1280, 1366, 1440, 1600, 1920, 2560, 3440])('window %i: both sides sit 32-56px from the column, 280-360px wide, clear of the edge', (w) => {
    const c = column(w);
    const r = blobBox(w, c.left, c.right, 'right'), l = blobBox(w, c.left, c.right, 'left');
    for (const b of [r, l]) {
      expect(b.width).toBeGreaterThanOrEqual(BLOB_MIN);
      expect(b.width).toBeLessThanOrEqual(BLOB_MAX);
      expect(b.gap).toBeGreaterThanOrEqual(BLOB_GAP_MIN);
      expect(b.gap).toBeLessThanOrEqual(BLOB_GAP_MAX);
    }
    expect(r.left - c.right).toBe(r.gap);
    expect(c.left - (l.left + l.width)).toBe(l.gap);
    expect(r.left + r.width).toBeLessThanOrEqual(w - BLOB_EDGE);
    expect(l.left).toBeGreaterThanOrEqual(BLOB_EDGE);
  });
  it('the gap grows with spare room but stays within 56px, and the blob is never at the window edge on wide screens', () => {
    const w = 3440, c = column(w), r = blobBox(w, c.left, c.right, 'right');
    expect(r.gap).toBe(BLOB_GAP_MAX);
    expect(w - (r.left + r.width)).toBeGreaterThan(BLOB_EDGE * 10);
  });
  it('the reserved width is exactly what the narrowest wide layout needs', () => {
    const w = 760 + BLOB_RESERVE, c = column(w), r = blobBox(w, c.left, c.right, 'right');
    expect(r.width).toBe(BLOB_MIN);
    expect(r.left + r.width).toBe(w - BLOB_EDGE);
  });
});

describe('connector path', () => {
  const w = 1600, c = column(w);
  it.each(['right', 'left'] as const)('%s side: one straight horizontal line that starts outside the writing column', (side) => {
    const b = blobBox(w, c.left, c.right, side), dot = { x: side === 'right' ? b.left : b.left + b.width, y: 130 };
    const p = connectorPath({ x: c.left + 200, lineBottom: 140, lineMid: 128 }, dot, c, side);
    expect(p).toHaveLength(2);
    expect(p[0].y).toBe(p[1].y); // straight
    expect(p[1]).toEqual(dot);
    if (side === 'right') expect(p[0].x).toBeGreaterThanOrEqual(c.right); else expect(p[0].x).toBeLessThanOrEqual(c.left); // never inside the note
  });
  it.each(['right', 'left'] as const)('%s side: a displaced blob steps once in the empty gutter, level with the line at the note edge', (side) => {
    const b = blobBox(w, c.left, c.right, side), dot = { x: side === 'right' ? b.left : b.left + b.width, y: 340 };
    const p = connectorPath({ x: c.left + 200, lineBottom: 140, lineMid: 128 }, dot, c, side);
    expect(p).toHaveLength(4);
    expect(p[0].y).toBe(128);
    expect(p[1].y).toBe(128);
    expect(p[2].x).toBe(p[1].x);
    expect(p[3]).toEqual(dot);
    for (const q of p) { if (side === 'right') expect(q.x).toBeGreaterThanOrEqual(c.right); else expect(q.x).toBeLessThanOrEqual(c.left); }
  });
});
it('connector starts just beside the sentence when nothing follows it, never beyond the column edge', () => {
  const w = 1600, c = column(w), rb = blobBox(w, c.left, c.right, 'right'), lb = blobBox(w, c.left, c.right, 'left');
  const r = connectorPath({ x: c.left, lineBottom: 140, lineMid: 128, rightX: c.left + 300, leftX: c.left - 3 }, { x: rb.left, y: 130 }, c, 'right');
  expect(r[0].x).toBe(c.left + 300); // right at the end of the sentence, inside the note's own line, no further
  expect(r).toHaveLength(2);
  const l = connectorPath({ x: c.left, lineBottom: 140, lineMid: 128, rightX: c.left + 300 }, { x: lb.left + lb.width, y: 130 }, c, 'left');
  expect(l[0].x).toBe(c.left - 4); // text may precede the sentence on the left: stops at the column edge
});
it('thought blobs make room for a full-width diagram instead of overlapping it', () => {
  const rows = [{ id: 'a', side: 'right' as const, target: 300, height: 100 }, { id: 'b', side: 'left' as const, target: 700, height: 100 }];
  const band = { top: 250, bottom: 800 }; // an inserted diagram spans both margins
  const placed = layoutThoughts(rows, [band]);
  for (const p of placed) expect(p.top + p.height <= band.top - 8 || p.top >= band.bottom + 8).toBe(true);
  expect(layoutThoughts(rows).map(p => p.top)).toEqual([300, 700]); // no diagram: unchanged
});
it('connector stays attached however far the blob was pushed, and hides only when both ends are offscreen',()=>{
 expect(connectorVisible(100,148,600)).toBe(true);expect(connectorVisible(100,400,600)).toBe(true); // displaced blob: still drawn
 expect(connectorVisible(-60,-60,600)).toBe(false);expect(connectorVisible(601,601,600)).toBe(false);
 expect(connectorVisible(-40,300,600)).toBe(true); // sentence scrolled up, blob still in view
});
describe('sticky connector path', () => {
 const w = 1600, c = column(w);
 it.each(['right', 'left'] as const)('%s side: level blob is one straight line; displaced blob is one smooth curve ending on the dot', (side) => {
  const b = blobBox(w, c.left, c.right, side), x = side === 'right' ? b.left : b.left + b.width;
  const flat = connectorD({ x: c.left + 200, lineBottom: 140, lineMid: 128 }, { x, y: 130 }, c, side);
  expect(flat).not.toContain('C');
  for (const y of [340, -60]) {
   const d = connectorD({ x: c.left + 200, lineBottom: 140, lineMid: 128 }, { x, y }, c, side);
   expect(d).toContain('C');
   expect(d.endsWith(`${x} ${y}`)).toBe(true);
   const xs = [...d.matchAll(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g)].map(m => Number(m[1]));
   for (const px of xs) { if (side === 'right') expect(px).toBeGreaterThanOrEqual(c.right); else expect(px).toBeLessThanOrEqual(c.left); } // never inside the note
  }
 });
});
