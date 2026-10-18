import { describe, expect, it } from "vitest";
import { parseCsv, unguardText } from "./csv-parse";

describe("parseCsv", () => {
  it("reads plain, quoted and empty cells with CRLF or LF", () => {
    expect(parseCsv("a,b,c\r\n1,,3\r\n")).toEqual([
      ["a", "b", "c"],
      ["1", "", "3"],
    ]);
    expect(parseCsv("a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
    expect(parseCsv('"x,y","say ""hi""","two\nlines"\r\n')).toEqual([
      ["x,y", 'say "hi"', "two\nlines"],
    ]);
  });
  it("ignores a byte-order mark and keeps a trailing empty cell", () => {
    expect(parseCsv("﻿id,note\r\n1,\r\n")).toEqual([
      ["id", "note"],
      ["1", ""],
    ]);
    expect(parseCsv("a,\n")).toEqual([["a", ""]]);
  });
  it("returns no rows for empty text and keeps blank lines as one empty cell", () => {
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("a\n\nb\n")).toEqual([["a"], [""], ["b"]]);
  });
  it("rejects an unclosed quote", () => {
    expect(() => parseCsv('a,"b\n')).toThrow();
  });
  it("reads a quote in the middle of an unquoted cell as text", () => {
    expect(parseCsv('5" pipe,x\n')).toEqual([['5" pipe', "x"]]);
  });
});

describe("unguardText", () => {
  it("removes only the apostrophe an export adds", () => {
    for (const text of ["=1+1", "+1", "-1", "@SUM(A1)"])
      expect(unguardText(`'${text}`)).toBe(text);
    expect(unguardText("'quoted")).toBe("'quoted");
    expect(unguardText("it's")).toBe("it's");
    expect(unguardText("plain")).toBe("plain");
  });
});
