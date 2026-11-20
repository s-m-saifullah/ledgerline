import { describe, expect, it } from "vitest";
import { typedMinor } from "./amount-input";

describe("typedMinor", () => {
  it("reads typed text as it is meant, then as exact minor units", () => {
    expect(typedMinor(".8", 2)).toBe(80);
    expect(typedMinor("8.", 2)).toBe(800);
    expect(typedMinor("1,000.5", 2)).toBe(100050);
    expect(typedMinor("$12", 2)).toBe(1200);
    expect(typedMinor("12.34", 2)).toBe(1234);
    expect(typedMinor("5.", 0)).toBe(5);
    expect(typedMinor(".125", 3)).toBe(125);
  });
  it("still refuses what is not one amount", () => {
    for (const text of ["", ".", "abc", "1.2.3", "1.234"])
      expect(() => typedMinor(text, 2), JSON.stringify(text)).toThrow();
    expect(() => typedMinor("1.5", 0)).toThrow();
  });
});
