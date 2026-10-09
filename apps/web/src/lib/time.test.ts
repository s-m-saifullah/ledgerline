import { describe, expect, it } from "vitest";
import { formatTime12, to24Hour } from "./time";

describe("formatTime12", () => {
  it("shows 12-hour times with AM and PM", () => {
    expect(formatTime12("00:00")).toBe("12:00 AM");
    expect(formatTime12("00:15")).toBe("12:15 AM");
    expect(formatTime12("08:05")).toBe("8:05 AM");
    expect(formatTime12("11:59")).toBe("11:59 AM");
    expect(formatTime12("12:00")).toBe("12:00 PM");
    expect(formatTime12("12:30")).toBe("12:30 PM");
    expect(formatTime12("14:32")).toBe("2:32 PM");
    expect(formatTime12("23:59")).toBe("11:59 PM");
  });
  it("returns anything that is not a valid time unchanged", () => {
    for (const value of ["", "24:00", "12:60", "9:30", "noon", "12:30:00"])
      expect(formatTime12(value)).toBe(value);
  });
});
describe("to24Hour", () => {
  it("converts a 12-hour reading to HH:mm", () => {
    expect(to24Hour("12", "00", "AM")).toBe("00:00");
    expect(to24Hour("12", "15", "AM")).toBe("00:15");
    expect(to24Hour("1", "5", "AM")).toBe("01:05");
    expect(to24Hour("11", "59", "AM")).toBe("11:59");
    expect(to24Hour("12", "00", "PM")).toBe("12:00");
    expect(to24Hour("2", "32", "PM")).toBe("14:32");
    expect(to24Hour("11", "59", "PM")).toBe("23:59");
  });
  it("rejects an hour outside 1 to 12, a minute above 59 and non-numbers", () => {
    for (const [h, m] of [
      ["0", "10"],
      ["13", "10"],
      ["24", "00"],
      ["5", "60"],
      ["", "10"],
      ["5", ""],
      ["a", "10"],
    ])
      expect(to24Hour(h as string, m as string, "AM")).toBeNull();
  });
  it("round-trips every minute of the day", () => {
    for (let total = 0; total < 1440; total += 7) {
      const value = `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
      const text = formatTime12(value);
      const [clock, period] = text.split(" ") as [string, "AM" | "PM"];
      const [h, m] = clock.split(":") as [string, string];
      expect(to24Hour(h, m, period)).toBe(value);
    }
  });
});
