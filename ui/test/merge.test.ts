import { ChangeSet, Text } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { applyHunks, diffText, paragraphSpan } from "../shared/diff.ts";
import { planMerge } from "../shared/merge.ts";

describe("diffText", () => {
  it("fuzz: applying the hunks to a always yields b", () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    const lines = ["alpha", "beta", "", "gamma delta", "😀 emoji", "# head", "", "tail"];
    const gen = () => {
      let s = "";
      for (let k = Math.floor(rnd() * 12); k > 0; k--) s += lines[Math.floor(rnd() * lines.length)] + (rnd() < 0.9 ? "\n" : "");
      return s;
    };
    for (let i = 0; i < 400; i++) {
      const a = gen();
      const b = rnd() < 0.5 ? gen() : a.replace("beta", "BETA!").replace("tail", "");
      expect(applyHunks(a, diffText(a, b))).toBe(b);
    }
  });
  it("trims to the exact changed characters", () => {
    expect(diffText("hello world\n", "hello brave world\n")).toEqual([{ from: 6, to: 6, insert: "brave " }]);
  });
  it("does not split surrogate pairs", () => {
    const h = diffText("a😀b", "a😁b");
    expect(applyHunks("a😀b", h)).toBe("a😁b");
  });
});

describe("paragraphSpan", () => {
  const t = "# H\n\nline1\nline2\n\nsecond\n";
  it("expands to the whole block", () => {
    expect(paragraphSpan(t, 7, 8)).toEqual([5, 16]);
  });
  it("a blank line is its own block", () => {
    expect(paragraphSpan(t, 4, 4)).toEqual([4, 4]);
  });
});

const base = "# Plan\n\nPara A original.\n\nPara B original.\n\nPara C original.\n";

/** Apply a merge plan the way the editor does and return the resulting document. */
function merged(mine: string, theirs: string) {
  const plan = planMerge(base, mine, theirs);
  const L = ChangeSet.of(diffText(base, mine), base.length);
  const T = ChangeSet.of(plan.apply, base.length).map(L);
  const doc = T.apply(L.apply(Text.of(base.split("\n"))));
  return { plan, text: doc.toString() };
}

describe("planMerge", () => {
  it("non-overlapping edits merge silently and keep both", () => {
    const mine = base.replace("Para A original.", "Para A original. I am typing here");
    const theirs = base.replace("Para C original.", "Para C rewritten by agent.");
    const { plan, text } = merged(mine, theirs);
    expect(plan.conflicts).toEqual([]);
    expect(text).toBe(base.replace("Para A original.", "Para A original. I am typing here").replace("Para C original.", "Para C rewritten by agent."));
  });

  it("an edit to the paragraph you are typing in is a conflict and is NOT applied", () => {
    const mine = base.replace("Para B original.", "Para B original. mine");
    const theirs = base.replace("Para B original.", "Para B original. theirs");
    const { plan, text } = merged(mine, theirs);
    expect(plan.conflicts).toHaveLength(1);
    expect(plan.apply).toEqual([]);
    expect(text).toBe(mine);
  });

  it("applies the safe edit and flags only the conflicting one", () => {
    const mine = base.replace("Para B original.", "Para B mine");
    const theirs = base.replace("Para B original.", "Para B theirs").replace("Para C original.", "Para C theirs");
    const { plan, text } = merged(mine, theirs);
    expect(plan.conflicts).toHaveLength(1);
    expect(text).toBe(base.replace("Para B original.", "Para B mine").replace("Para C original.", "Para C theirs"));
  });

  it("mine unchanged -> theirs applies entirely; theirs unchanged -> nothing to do", () => {
    const theirs = base.replace("Para A original.", "NEW");
    expect(merged(base, theirs).text).toBe(theirs);
    expect(planMerge(base, base + "x", base).apply).toEqual([]);
  });

  it("insertions at opposite ends of the document do not conflict", () => {
    const mine = "Intro typed by me.\n\n" + base;
    const theirs = base + "\nAppended by agent.\n";
    const { plan, text } = merged(mine, theirs);
    expect(plan.conflicts).toEqual([]);
    expect(text).toBe("Intro typed by me.\n\n" + base + "\nAppended by agent.\n");
  });

  it("fuzz: with no conflicts, the merge equals applying both edit sets", () => {
    let seed = 99;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    const paras = Array.from({ length: 8 }, (_, i) => `Paragraph ${i} text.`);
    const doc = (ps: string[]) => ps.join("\n\n") + "\n";
    for (let i = 0; i < 300; i++) {
      const b = doc(paras);
      const mineP = [...paras];
      const theirP = [...paras];
      mineP[Math.floor(rnd() * 8)] += " mine";
      theirP[Math.floor(rnd() * 8)] += " theirs";
      const mine = doc(mineP);
      const theirs = doc(theirP);
      const plan = planMerge(b, mine, theirs);
      const L = ChangeSet.of(diffText(b, mine), b.length);
      const T = ChangeSet.of(plan.apply, b.length).map(L);
      const out = T.apply(L.apply(Text.of(b.split("\n")))).toString();
      if (plan.conflicts.length === 0) {
        const expected = paras.map((p, k) => p + (mineP[k] !== p ? " mine" : "") + (theirP[k] !== p ? " theirs" : ""));
        expect(out).toBe(doc(expected));
      } else {
        expect(out).toBe(mine); // conflicting edits are never applied silently
      }
    }
  });
});
