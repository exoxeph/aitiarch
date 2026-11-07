import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { captureAnchor, resolveAnchor } from "../shared/anchors.ts";
import { mapAnchor } from "../shared/anchor-mapping.ts";

// The model tracks paragraph identity outside Markdown. This lets the oracle
// distinguish an original paragraph from an identical duplicate.
const SEED = 0x2a17c0de;
const EDITS = 1000;
type Paragraph = { id: number; text: string };
function random(seed: number) {
  let state = seed >>> 0;
  return (n: number) => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return (state >>> 0) % n;
  };
}
const sentences = [
  "The service uses Redis for temporary session storage.",
  "The service uses SQLite for temporary session storage.",
  "Cache invalidation follows the deployment boundary.",
  "The migration waits for a human review of the evidence.",
  "The notebook keeps every decision near its supporting quote.",
  "A short answer should cite the selected project evidence.",
];
function render(paragraphs: Paragraph[]) {
  let text = "";
  const ranges = new Map<number, { from: number; to: number }>();
  paragraphs.forEach((p, i) => {
    if (i) text += "\n\n";
    const from = text.length;
    text += p.text;
    ranges.set(p.id, { from, to: text.length });
  });
  return { text, ranges };
}

function runCorpus(label: string, seed: number, source: (rnd: ReturnType<typeof random>) => string[], mix: "balanced" | "realistic" = "balanced", mapping = false) {
  const rnd = random(seed);
  const ops = ["insert", "delete", "move", "duplicate", "partial rewrite"] as const;
  const counts = Object.fromEntries(ops.map(op => [op, 0])) as Record<typeof ops[number], number>;
  let wrongAttachments = 0, orphans = 0, unnecessaryOrphans = 0, recoverable = 0;
  let unchanged = 0, unchangedOrphans = 0;
  const unchangedOrphansByOp = Object.fromEntries(ops.map(op => [op, 0])) as Record<typeof ops[number], number>;
  const orphansByOp = { ...unchangedOrphansByOp };
  const unchangedByOp = { ...unchangedOrphansByOp };
  const unchangedOrphansByCapture = { repeatedAtCapture: 0, uniqueAtCapture: 0 };
  const wrongAttachmentsByCapture = { repeatedAtCapture: 0, uniqueAtCapture: 0 };
  const failures: unknown[] = [];
  const unchangedOrphanExamples: unknown[] = [];
  for (let iteration = 0; iteration < EDITS; iteration++) {
    let nextId = 0;
    const paragraphs: Paragraph[] = source(rnd).map(text => ({ id: nextId++, text }));
    const target = paragraphs[rnd(paragraphs.length)].id;
    const before = render(paragraphs);
    const initial = before.ranges.get(target)!;
    const originalText = paragraphs.find(p => p.id === target)!.text;
    const anchor = captureAnchor(before.text, initial.from, initial.to);
    // 37 permutes the 200 slots: exactly 70/15/10/5%, with moves/copies split equally.
    const slot = (iteration * 37) % 200;
    const op = mix === "balanced" ? ops[iteration % ops.length]
      : slot < 140 ? "insert" : slot < 170 ? "delete" : slot < 190 ? "partial rewrite" : slot % 2 ? "move" : "duplicate";
    counts[op]++;
    let affected: number | null = null;
    if (op === "insert") {
      const text = mix === "realistic" ? `New observation ${seed}-${iteration} records an independent deployment constraint.`
        : rnd(2) ? paragraphs.find(p => p.id === target)!.text : sentences[rnd(sentences.length)];
      paragraphs.splice(rnd(paragraphs.length + 1), 0, { id: nextId++, text });
    } else if (op === "delete") {
      const at = rnd(3) ? paragraphs.findIndex(p => p.id === target) : rnd(paragraphs.length);
      affected = paragraphs[at].id;
      paragraphs.splice(at, 1);
    } else if (op === "move") {
      const at = rnd(3) ? paragraphs.findIndex(p => p.id === target) : rnd(paragraphs.length);
      affected = paragraphs[at].id;
      const [p] = paragraphs.splice(at, 1);
      paragraphs.splice(rnd(paragraphs.length + 1), 0, p);
    } else if (op === "duplicate") {
      const at = rnd(3) ? paragraphs.findIndex(p => p.id === target) : rnd(paragraphs.length);
      affected = paragraphs[at].id;
      const copied = paragraphs[at].text;
      paragraphs.splice(rnd(paragraphs.length + 1), 0, { id: nextId++, text: copied });
    } else {
      const at = rnd(3) ? paragraphs.findIndex(p => p.id === target) : rnd(paragraphs.length);
      affected = paragraphs[at].id;
      const p = paragraphs[at];
      const words = p.text.split(" ");
      words[Math.min(3, words.length - 1)] = ["brief", "lasting", "careful", "reviewed"][rnd(4)];
      p.text = words.join(" ");
    }
    const after = render(paragraphs);
    const expected = after.ranges.get(target) ?? null;
    if (expected) recoverable++;
    const stillUnchanged = !!expected && paragraphs.find(p => p.id === target)?.text === originalText;
    if (stillUnchanged) { unchanged++; unchangedByOp[op]++; }
    const result = mapping ? mapAnchor(before.text, after.text, anchor) : resolveAnchor(after.text, anchor);
    if (result.status === "orphaned") {
      orphans++;
      orphansByOp[op]++;
      if (expected) unnecessaryOrphans++;
      if (stillUnchanged) {
        unchangedOrphans++;
        unchangedOrphansByOp[op]++;
        unchangedOrphansByCapture[anchor.quoteCount > 1 ? "repeatedAtCapture" : "uniqueAtCapture"]++;
        if (unchangedOrphanExamples.length < (label.includes("additional seed") ? 3 : 1000)) unchangedOrphanExamples.push({ seed, iteration, op, quote: anchor.quote,
          before: before.text, after: after.text, expected, reason: result.reason });
      }
    } else if (!expected || result.from !== expected.from || result.to !== expected.to) {
      wrongAttachments++;
      wrongAttachmentsByCapture[anchor.quoteCount > 1 ? "repeatedAtCapture" : "uniqueAtCapture"]++;
      if (failures.length < 3) failures.push({ seed, iteration, op, affected, before: before.text, after: after.text,
        original: initial, expected, actual: result, anchor });
    }
  }
  const report = { label, path: mapping ? "mapping" : "search", mix, seed, edits: EDITS, counts, orphansByOp, wrongAttachments, wrongAttachmentsByCapture, orphans, orphanRate: orphans / EDITS,
    recoverable, unnecessaryOrphans, recoverableOrphanRate: unnecessaryOrphans / recoverable,
    unchanged, unchangedByOp, unchangedOrphans, unchangedOrphanRate: unchangedOrphans / unchanged, unchangedOrphansByOp, unchangedOrphansByCapture,
    unchangedOrphanExamples, failures };
  console.log(JSON.stringify(report));
  expect(wrongAttachments, JSON.stringify(failures, null, 2)).toBe(0);
  return report;
}

it("keeps identity across 1000 seeded repeated-sentence fixture edits", () => {
  runCorpus("repeated synthetic", SEED, rnd => {
    const texts = Array.from({ length: 4 + rnd(6) }, () => sentences[rnd(sentences.length)]);
    if (rnd(2) === 0) texts.splice(rnd(texts.length + 1), 0, texts[rnd(texts.length)]);
    return texts;
  });
});

const actors = ["gateway", "editor", "notebook", "indexer", "session", "ledger", "reviewer", "watcher"];
const verbs = ["checks", "records", "restores", "compares", "displays", "groups", "quotes", "tracks"];
const objects = ["a selected paragraph", "the local draft", "a version stamp", "a cited decision", "an orphaned note", "the active tab", "the source excerpt", "a saved answer"];
const moments = ["before display", "after reload", "during a move", "while typing", "after a conflict", "on request", "before saving", "during review"];
it("keeps identity across 1000 seeded mostly unique sentence edits", () => {
  runCorpus("mostly unique synthetic", SEED ^ 0x5eed, rnd => {
    const texts = Array.from({ length: 4 + rnd(6) }, () =>
      `The ${actors[rnd(actors.length)]} ${verbs[rnd(verbs.length)]} ${objects[rnd(objects.length)]} ${moments[rnd(moments.length)]}.`);
    if (rnd(10) === 0) texts.splice(rnd(texts.length + 1), 0, texts[rnd(texts.length)]);
    return texts;
  });
});

it.each(["repeated", "mostly unique"] as const)("evaluates a realistic edit mix on the %s corpus", kind => {
  const report = runCorpus(`${kind} synthetic; realistic mix`, kind === "repeated" ? SEED : SEED ^ 0x5eed, rnd => {
    if (kind === "repeated") {
      const texts = Array.from({ length: 4 + rnd(6) }, () => sentences[rnd(sentences.length)]);
      if (rnd(2) === 0) texts.splice(rnd(texts.length + 1), 0, texts[rnd(texts.length)]);
      return texts;
    }
    const texts = Array.from({ length: 4 + rnd(6) }, () =>
      `The ${actors[rnd(actors.length)]} ${verbs[rnd(verbs.length)]} ${objects[rnd(objects.length)]} ${moments[rnd(moments.length)]}.`);
    if (rnd(10) === 0) texts.splice(rnd(texts.length + 1), 0, texts[rnd(texts.length)]);
    return texts;
  }, "realistic");
  expect(report.counts).toEqual({ insert: 700, delete: 150, move: 25, duplicate: 25, "partial rewrite": 100 });
});

// New fixed seeds, separate from the previously explored SEED + 1..10.
const regularSeeds = [143137, 804221, 1730159, 3674107, 706201011, 706202027, 987631, 1224523, 2204909, 314159265];
const extraSweep = Number(process.env.AITIARCH_ANCHOR_SWEEP ?? 0);
const evaluatedSeeds = [...regularSeeds, ...Array.from({ length: extraSweep }, (_, i) => SEED + 1 + i)];
it("checks both paths on ten fixed new seeds, plus an explicitly requested larger sweep", () => {
  for (const mapping of [false, true]) for (const seed of evaluatedSeeds) {
    runCorpus(`repeated synthetic; additional seed ${seed}`, seed, rnd => {
      const texts = Array.from({ length: 4 + rnd(6) }, () => sentences[rnd(sentences.length)]);
      if (rnd(2) === 0) texts.splice(rnd(texts.length + 1), 0, texts[rnd(texts.length)]);
      return texts;
    }, "balanced", mapping);
    runCorpus(`mostly unique synthetic; additional seed ${seed}`, seed ^ 0x5eed, rnd => {
      const texts = Array.from({ length: 4 + rnd(6) }, () =>
        `The ${actors[rnd(actors.length)]} ${verbs[rnd(verbs.length)]} ${objects[rnd(objects.length)]} ${moments[rnd(moments.length)]}.`);
      if (rnd(10) === 0) texts.splice(rnd(texts.length + 1), 0, texts[rnd(texts.length)]);
      return texts;
    }, "balanced", mapping);
  }
});

it.each(["balanced", "realistic"] as const)("maps both synthetic corpora with the %s edit mix", mix => {
  runCorpus("repeated synthetic", SEED, rnd => {
    const texts = Array.from({ length: 4 + rnd(6) }, () => sentences[rnd(sentences.length)]);
    if (rnd(2) === 0) texts.splice(rnd(texts.length + 1), 0, texts[rnd(texts.length)]);
    return texts;
  }, mix, true);
  runCorpus("mostly unique synthetic", SEED ^ 0x5eed, rnd => {
    const texts = Array.from({ length: 4 + rnd(6) }, () =>
      `The ${actors[rnd(actors.length)]} ${verbs[rnd(verbs.length)]} ${objects[rnd(objects.length)]} ${moments[rnd(moments.length)]}.`);
    if (rnd(10) === 0) texts.splice(rnd(texts.length + 1), 0, texts[rnd(texts.length)]);
    return texts;
  }, mix, true);
});

// Only a user-supplied, already redacted copy may be passed here. The test
// never opens or locates the personal notebook on its own.
const redactedFixture = process.env.AITIARCH_REDACTED_NOTEBOOK_FIXTURE;
it.skipIf(!redactedFixture)("keeps identity across 1000 seeded redacted-notebook fixture edits", () => {
  const raw = readFileSync(redactedFixture!, "utf8").replace(/^\ufeff/, "").replace(/\r\n?/g, "\n");
  const paragraphs = raw.split(/\n\s*\n/).map(s => s.trim()).filter(s => s.length >= 20 && s.length <= 1500);
  expect(paragraphs.length).toBeGreaterThanOrEqual(4);
  runCorpus("redacted notebook fixture", SEED ^ 0x5eed, rnd => {
    const start = rnd(Math.max(1, paragraphs.length - 4));
    return paragraphs.slice(start, start + 4 + rnd(6));
  });
});
