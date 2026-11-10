import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {DWELL_MS,EdgeMenuController,LEAVE_MS} from '../src/menu/edge-menu.ts';

// The left menu's pointer rules, without a browser: a short dwell at the edge opens it, a longer grace closes it, a held button or a pin changes both.
const make=()=>{const states:{open:boolean;pinned:boolean}[]=[],c=new EdgeMenuController(s=>states.push(s));return {c,states};};
beforeEach(()=>{vi.useFakeTimers();});
afterEach(()=>{vi.useRealTimers();});

describe('opening from the edge',()=>{
 it('opens only after the pointer has dwelled in the edge zone',()=>{
  const {c}=make();c.enterZone(0);vi.advanceTimersByTime(DWELL_MS-1);expect(c.open).toBe(false);vi.advanceTimersByTime(1);expect(c.open).toBe(true);expect(c.pinned).toBe(false);
 });
 it('does not open when the pointer only brushes the edge',()=>{
  const {c}=make();c.enterZone(0);vi.advanceTimersByTime(60);c.leaveZone();vi.advanceTimersByTime(1000);expect(c.open).toBe(false);
 });
 it('does not open while a mouse button is held, as in a text selection drag',()=>{
  const {c}=make();c.enterZone(1);vi.advanceTimersByTime(1000);expect(c.open).toBe(false);
  const d=make();d.c.pointerDown();d.c.enterZone(0);vi.advanceTimersByTime(1000);expect(d.c.open).toBe(false);
 });
 it('a button pressed during the dwell cancels the opening',()=>{
  const {c}=make();c.enterZone(0);vi.advanceTimersByTime(60);c.pointerDown();vi.advanceTimersByTime(1000);expect(c.open).toBe(false);
 });
 it('releasing a drag at the edge does not pop the menu open; the pointer has to come back',()=>{
  const {c}=make();c.pointerDown();c.enterZone(1);c.pointerUp();vi.advanceTimersByTime(1000);expect(c.open).toBe(false);
  c.leaveZone();c.enterZone(0);vi.advanceTimersByTime(DWELL_MS);expect(c.open).toBe(true);
 });
});

describe('closing',()=>{
 const opened=()=>{const m=make();m.c.enterZone(0);vi.advanceTimersByTime(DWELL_MS);m.c.leaveZone();m.c.enterMenu();return m;};
 it('closes a grace period after the pointer has left both the zone and the menu',()=>{
  const {c}=opened();c.leaveMenu();vi.advanceTimersByTime(LEAVE_MS-1);expect(c.open).toBe(true);vi.advanceTimersByTime(1);expect(c.open).toBe(false);
 });
 it('stays open while the pointer is inside the menu, and when it comes back within the grace period',()=>{
  const {c}=opened();vi.advanceTimersByTime(5000);expect(c.open).toBe(true);
  c.leaveMenu();vi.advanceTimersByTime(200);c.enterMenu();vi.advanceTimersByTime(5000);expect(c.open).toBe(true);
 });
 it('moving back to the edge zone keeps it open too',()=>{
  const {c}=opened();c.leaveMenu();vi.advanceTimersByTime(100);c.enterZone(0);vi.advanceTimersByTime(5000);expect(c.open).toBe(true);
 });
});

describe('pinning and Escape',()=>{
 it('a click on the hamburger pins it open; the pointer leaving does not close it',()=>{
  const {c}=make();c.toggle();expect(c.open&&c.pinned).toBe(true);c.enterMenu();c.leaveMenu();vi.advanceTimersByTime(5000);expect(c.open).toBe(true);
 });
 it('a second click unpins and closes it',()=>{const {c}=make();c.toggle();c.toggle();expect(c.open).toBe(false);expect(c.pinned).toBe(false);});
 it('a click while it is hover-open pins it instead of closing it',()=>{
  const {c}=make();c.enterZone(0);vi.advanceTimersByTime(DWELL_MS);c.leaveZone();c.toggle();c.leaveMenu();vi.advanceTimersByTime(5000);expect(c.open&&c.pinned).toBe(true);
 });
 it('Escape closes a pinned or a hover-open menu, and reports whether it did anything',()=>{
  const a=make();a.c.toggle();expect(a.c.escape()).toBe(true);expect(a.c.open).toBe(false);expect(a.c.pinned).toBe(false);
  const b=make();b.c.enterZone(0);vi.advanceTimersByTime(DWELL_MS);expect(b.c.escape()).toBe(true);expect(b.c.open).toBe(false);
  expect(b.c.escape()).toBe(false);
 });
 it('reports every change to the owner exactly once',()=>{
  const {c,states}=make();c.toggle();c.toggle();expect(states).toEqual([{open:true,pinned:true},{open:false,pinned:false}]);
 });
});
