// Position tests for margin blobs and their connectors (pure functions; no browser).
import { describe, expect, it } from 'vitest';
import { BLOB_EDGE, BLOB_GAP_MAX, BLOB_GAP_MIN, BLOB_MAX, BLOB_MIN, BLOB_RESERVE, blobBox, connectorPath, connectorVisible } from '../shared/thoughts.ts';

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
  it.each(['right', 'left'] as const)('%s side: leaves the text end, runs in the gap under the line, then through the margin to the dot', (side) => {
    const b = blobBox(w, c.left, c.right, side), dot = { x: side === 'right' ? b.left : b.left + b.width, y: 340 };
    const end = { x: c.left + 200, lineBottom: 120 };
    const p = connectorPath(end, dot, c, side);
    expect(p).toHaveLength(4);
    expect(p[0]).toEqual({ x: end.x, y: end.lineBottom - 1 }); // starts at the end of the anchored text
    expect(p[1].y).toBe(p[0].y); // runs sideways under the line, not through it
    expect(p[3]).toEqual(dot); // ends at the dot
    for (const q of [p[1], p[2], p[3]]) {
      if (side === 'right') expect(q.x).toBeGreaterThan(c.right); else expect(q.x).toBeLessThan(c.left);
    }
    expect(p[2].x).toBe(p[1].x); // then straight down the empty margin
  });
});

it('connector hides displaced or offscreen anchors even when active',()=>{expect(connectorVisible(100,148,600)).toBe(true);expect(connectorVisible(100,149,600)).toBe(false);expect(connectorVisible(-1,0,600)).toBe(false);expect(connectorVisible(601,601,600)).toBe(false);});
