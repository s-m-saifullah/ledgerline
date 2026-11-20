import { describe, expect, it } from "vitest";
import {
  hoursFromTyped,
  hoursToHundredths,
  rateFromInverse,
  rateFromTyped,
  typedDecimal,
} from "./index";

describe("typedDecimal", () => {
  it("reads .8 as 0.8 and 8. as 8, and leaves everything else as typed", () => {
    expect(typedDecimal(".8")).toBe("0.8");
    expect(typedDecimal(" .05 ")).toBe("0.05");
    expect(typedDecimal("8.")).toBe("8");
    expect(typedDecimal("0.8")).toBe("0.8");
    expect(typedDecimal("12.50")).toBe("12.50");
    expect(typedDecimal("")).toBe("");
    expect(typedDecimal(".")).toBe(".");
    expect(typedDecimal("1.2.3")).toBe("1.2.3");
    expect(typedDecimal("-.8")).toBe("-.8");
    expect(typedDecimal("abc")).toBe("abc");
  });
});

describe("rateFromTyped", () => {
  it("stores .8 and 8. the way 0.8 and 8 are stored", () => {
    expect(rateFromTyped(".8")).toBe("1.25");
    expect(rateFromTyped(".8")).toBe(rateFromInverse("0.8"));
    expect(rateFromTyped("8.")).toBe(rateFromInverse("8"));
    expect(rateFromTyped(" .05 ")).toBe(rateFromInverse("0.05"));
    expect(rateFromTyped("122.5")).toBe(rateFromInverse("122.5"));
  });
  it("still refuses what is not one positive number", () => {
    for (const text of ["", ".", "0", "0.", ".0", "1.2.3", "abc", "-1", "1e3"])
      expect(rateFromTyped(text), JSON.stringify(text)).toBeNull();
  });
});

describe("hoursFromTyped", () => {
  it("reads .5 and 3. as meant", () => {
    expect(hoursFromTyped(".5")).toBe(50);
    expect(hoursFromTyped(".25")).toBe(25);
    expect(hoursFromTyped("3.")).toBe(300);
    expect(hoursFromTyped("3.5")).toBe(hoursToHundredths("3.5"));
  });
  it("still refuses what is not hours", () => {
    for (const text of ["", ".", "0", ".0", "1.234", "1.2.3", "abc", "12345"])
      expect(hoursFromTyped(text), JSON.stringify(text)).toBeNull();
  });
});
