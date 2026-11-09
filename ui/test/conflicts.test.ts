import { describe, it, expect } from "vitest";
import { markChanged } from "../src/editor/conflicts.ts";

const join = (p: { text: string }[]) => p.map((x) => x.text).join("");

describe("markChanged (display only)", () => {
  it("keeps shared words plain and marks only the words in between", () => {
    const r = markChanged("Reloading keeps the status. I am adding a question.", "Reloading keeps the status. A note about cookies was appended.");
    expect(r.a.filter((p) => p.changed).map((p) => p.text)).toEqual(["I am adding a question."]);
    expect(r.b.filter((p) => p.changed).map((p) => p.text)).toEqual(["A note about cookies was appended."]);
  });
  it("joining the pieces gives the original text back, whitespace included", () => {
    for (const [a, b] of [["a  b\tc", "a  x\tc"], ["", "gone"], ["same", "same"], ["one two", ""], ["x y z", "x y z w"]]) {
      const r = markChanged(a, b);
      expect(join(r.a)).toBe(a);
      expect(join(r.b)).toBe(b);
    }
  });
  it("identical text has no changed words", () => {
    const r = markChanged("same words", "same words");
    expect(r.a.some((p) => p.changed)).toBe(false);
    expect(r.b.some((p) => p.changed)).toBe(false);
  });
  it("a removed paragraph marks all of yours as changed", () => {
    const r = markChanged("only mine", "");
    expect(r.a).toEqual([{ text: "only mine", changed: true }]);
    expect(r.b).toEqual([]);
  });
});
