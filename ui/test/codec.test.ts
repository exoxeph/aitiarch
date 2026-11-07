import { describe, expect, it } from "vitest";
import { decode, encode, eolLabel, NotUtf8Error } from "../server/codec.ts";

const buf = (s: string, bom = false) => Buffer.concat([bom ? Buffer.from([0xef, 0xbb, 0xbf]) : Buffer.alloc(0), Buffer.from(s, "utf8")]);
const roundTrip = (b: Buffer) => {
  const d = decode(b);
  return encode(d.text, d);
};

describe("byte-exact round trip (load then save unchanged)", () => {
  const cases: Record<string, Buffer> = {
    empty: buf(""),
    "LF": buf("# T\n\nPara one.\n\nPara two.\n"),
    "CRLF": buf("# T\r\n\r\nPara one.\r\n\r\nPara two.\r\n"),
    "CR only": buf("a\rb\rc\r"),
    "mixed": buf("one\r\ntwo\nthree\rfour\r\n\nfive"),
    "no trailing newline": buf("last line without newline"),
    "BOM + LF": buf("# T\n\nx\n", true),
    "BOM + CRLF": buf("# T\r\n\r\nx\r\n", true),
    "astral + combining + U+2028": buf("emoji 😀 é line sep\n nbsp\n"),
    "lone trailing CR": buf("x\r"),
    "blank lines only": buf("\r\n\r\n\n"),
  };
  for (const [name, b] of Object.entries(cases)) {
    it(name, () => expect(roundTrip(b).equals(b)).toBe(true));
  }

  it("fuzz: 400 random documents round-trip byte for byte", () => {
    let seed = 12345;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    const pieces = ["a", "bc", " ", "\n", "\r\n", "\r", "é", "😀", " ", "# ", "~~", "x\n\n"];
    for (let n = 0; n < 400; n++) {
      let s = "";
      for (let k = Math.floor(rnd() * 40); k > 0; k--) s += pieces[Math.floor(rnd() * pieces.length)];
      const b = buf(s, rnd() < 0.3);
      expect(roundTrip(b).equals(b)).toBe(true);
    }
  });
});

describe("editor text is LF-normalised; file endings are re-emitted", () => {
  it("never shows \\r to the editor", () => {
    expect(decode(buf("a\r\nb\rc\nd")).text).toBe("a\nb\nc\nd");
  });
  it("labels", () => {
    expect(eolLabel(decode(buf("a\nb")))).toBe("LF");
    expect(eolLabel(decode(buf("a\r\nb")))).toBe("CRLF");
    expect(eolLabel(decode(buf("a\rb")))).toBe("CR");
    expect(eolLabel(decode(buf("a\r\nb\nc")))).toBe("mixed");
    expect(eolLabel(decode(buf("abc")))).toBe("none");
  });
  it("CRLF file stays CRLF after an edit that adds lines", () => {
    const d = decode(buf("one\r\ntwo\r\n"));
    expect(encode("one\nINSERTED\nnew\ntwo\n", d).toString()).toBe("one\r\nINSERTED\r\nnew\r\ntwo\r\n");
  });
  it("BOM is kept, and a BOM-less file does not gain one", () => {
    const d = decode(buf("x\n", true));
    expect(encode("y\n", d)[0]).toBe(0xef);
    expect(encode("y\n", decode(buf("x\n")))[0]).toBe("y".charCodeAt(0));
  });
  it("mixed file: untouched lines keep their own ending, new lines use the dominant one", () => {
    const d = decode(buf("a\r\nb\r\nc\nd\r\n")); // dominant CRLF
    const out = encode("a\nB edited\nc\nnew line\nd\n", d).toString();
    expect(out).toBe("a\r\nB edited\r\nc\nnew line\r\nd\r\n");
  });
  it("mixed file: editing inside a line that ends in a lone LF keeps that LF", () => {
    const d = decode(buf("keep\r\nchange me\nlast\r\n"));
    expect(encode("keep\nchanged!\nlast\n", d).toString()).toBe("keep\r\nchanged!\nlast\r\n");
  });
});

describe("invalid input", () => {
  it("refuses non-UTF-8 instead of corrupting it", () => {
    expect(() => decode(Buffer.from([0x66, 0xff, 0xfe, 0x6f]))).toThrow(NotUtf8Error);
  });
});
