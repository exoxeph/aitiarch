// Where an anchored popover goes, and when its anchor is no longer in view. Pure: callers read the rects and apply the result.
export interface Rect {top: number; bottom: number; left: number; right: number}
export interface Placement {belowChip: boolean; top: number | null; bottom: number | null; right: number; room: number}

const GAP = 6, MARGIN = 18, EDGE = 12, KEEP = 8, MIN_ROOM = 96;
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

/** Open upward when there is room above (or little more below), else below; right-aligned to the chip and clamped to the viewport. */
export function placePopover(chip: Rect, view: {width: number; height: number}, popupWidth: number): Placement {
 const above = chip.top - MARGIN, below = view.height - chip.bottom - MARGIN;
 const belowChip = above < 240 && below > above;
 return {
  belowChip,
  top: belowChip ? clamp(chip.bottom + GAP, KEEP, view.height - MIN_ROOM) : null,
  bottom: belowChip ? null : clamp(view.height - chip.top + GAP, KEEP, view.height - MIN_ROOM),
  right: Math.max(EDGE, Math.min(view.width - chip.right, view.width - popupWidth - EDGE)),
  room: Math.max(0, belowChip ? below : above),
 };
}

/** The chip is out of view once it lies entirely outside any scrolling container it sits in. Partly visible still counts as in view. */
export function outOfView(chip: Rect, containers: readonly Rect[]): boolean {
 return containers.some(c => chip.bottom <= c.top || chip.top >= c.bottom || chip.right <= c.left || chip.left >= c.right);
}
