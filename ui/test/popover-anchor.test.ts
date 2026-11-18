import {expect, it} from 'vitest';
import {outOfView, placePopover, type Rect} from '../shared/popover-anchor.ts';

const rect = (top: number, bottom: number, left = 600, right = 760): Rect => ({top, bottom, left, right});
const view = {width: 1280, height: 800};

it('opens upward when there is room above the chip, anchored 6px over it', () => {
 const place = placePopover(rect(500, 530), view, 416);
 expect(place.belowChip).toBe(false);
 expect(place.top).toBeNull();
 expect(place.bottom).toBe(800 - 500 + 6);
 expect(place.room).toBe(500 - 18);
});

it('opens below when there is little room above and more below', () => {
 const place = placePopover(rect(120, 150), view, 416);
 expect(place.belowChip).toBe(true);
 expect(place.bottom).toBeNull();
 expect(place.top).toBe(150 + 6);
 expect(place.room).toBe(800 - 150 - 18);
});

it('keeps the popover on screen horizontally: right-aligned to the chip, at least 12px from either edge', () => {
 expect(placePopover(rect(500, 530, 100, 160), view, 416).right).toBe(1280 - 416 - 12);
 expect(placePopover(rect(500, 530, 1100, 1275), view, 416).right).toBe(12);
 expect(placePopover(rect(500, 530, 600, 760), view, 416).right).toBe(1280 - 760);
});

it('never lets a partly visible chip push the popover off screen', () => {
 const nearTop = placePopover(rect(-30, 0), view, 416);
 expect(nearTop.top).toBeGreaterThanOrEqual(8);
 const nearBottom = placePopover(rect(790, 840), view, 416);
 expect(nearBottom.bottom!).toBeGreaterThanOrEqual(8);
 expect(nearBottom.bottom!).toBeLessThanOrEqual(view.height - 96);
});

it('does not cover a chip that is fully on screen', () => {
 for (const top of [60, 150, 300, 500, 700]) {
  const chip = rect(top, top + 30), place = placePopover(chip, view, 416);
  if (place.belowChip) expect(place.top!).toBeGreaterThanOrEqual(chip.bottom);
  else expect(view.height - place.bottom!).toBeLessThanOrEqual(chip.top);
 }
});

it('is pure: the inputs are not changed', () => {
 const chip = Object.freeze(rect(500, 530)), size = Object.freeze({...view});
 expect(() => placePopover(chip, size, 416)).not.toThrow();
});

it('a chip fully inside every scrolling container is in view; fully outside any one is out of view', () => {
 const pane = rect(100, 500, 0, 800), dialog = rect(60, 760, 0, 900);
 expect(outOfView(rect(200, 230), [pane, dialog])).toBe(false);
 expect(outOfView(rect(500, 530), [pane, dialog])).toBe(true);
 expect(outOfView(rect(40, 100), [pane, dialog])).toBe(true);
 expect(outOfView(rect(200, 230, 900, 960), [pane, dialog])).toBe(true);
 expect(outOfView(rect(200, 230), [])).toBe(false);
});

it('a chip that is only partly inside the container is still in view', () => {
 const pane = rect(100, 500, 0, 800);
 expect(outOfView(rect(480, 520), [pane])).toBe(false);
 expect(outOfView(rect(80, 120), [pane])).toBe(false);
});
