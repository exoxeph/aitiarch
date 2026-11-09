import { describe, expect, it } from 'vitest';
import { diagramPalettes, diagramSvg } from '../shared/diagram-svg.ts';
import { layoutDiagram } from '../src/diagrams/layout.ts';
import { cicd } from './fixtures/diagrams.ts';

const lin = (c: number) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = (hex: string) => { const n = parseInt(hex.slice(1), 16); return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255); };
const ratio = (a: string, b: string) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

describe('exported SVG is readable on light and dark pages', () => {
  it('the in-app drawing is unchanged: no style block unless asked for', async () => {
    const l = await layoutDiagram(cicd);
    expect(diagramSvg(cicd, l, 'light')).not.toContain('<style>');
  });
  it('the adaptive file recolours itself for the other colour scheme (light base, dark override)', async () => {
    const l = await layoutDiagram(cicd);
    const svg = diagramSvg(cicd, l, 'light', undefined, true);
    expect(svg).toContain('@media (prefers-color-scheme: dark)');
    expect(svg).toContain(`[fill="${diagramPalettes.light.paper}"]{fill:${diagramPalettes.dark.paper}}`);
    expect(svg).toContain(`[stroke="${diagramPalettes.light.border}"]{stroke:${diagramPalettes.dark.border}}`);
    expect(svg).not.toMatch(/<script|<image|href=|javascript:|data:/i);
  });
  it('a dark base gets the light override', async () => {
    const l = await layoutDiagram(cicd);
    expect(diagramSvg(cicd, l, 'dark', undefined, true)).toContain('@media (prefers-color-scheme: light)');
  });
  it('text on its own background passes AA in both schemes, so it never depends on the page colour', () => {
    for (const p of [diagramPalettes.light, diagramPalettes.dark]) {
      expect(ratio(p.ink, p.paper)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(p.muted, p.paper)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(p.ink, p.focus)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
