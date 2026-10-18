import { describe, expect, it } from "vitest";
import { csvCell, csvLine, guardedText } from "./csv";

describe("csv helpers", () => {
  it("quotes only where needed and doubles quotes", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("two\nlines")).toBe('"two\nlines"');
    expect(csvCell("")).toBe("");
    expect(csvLine(["a", "b,c", ""])).toBe('a,"b,c",\r\n');
  });
  it("neutralizes spreadsheet formulas", () => {
    for (const text of ["=1+1", "+1", "-1", "@SUM(A1)", "\tx", "\rx"])
      expect(guardedText(text)).toBe(`'${text}`);
    expect(guardedText("Coffee")).toBe("Coffee");
    expect(guardedText("it's -fine")).toBe("it's -fine");
    expect(guardedText(null)).toBe("");
  });
});
