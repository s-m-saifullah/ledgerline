import { describe, expect, it } from "vitest";
import { localDate } from "./dates";

describe("localDate", () => {
  const now = new Date("2026-10-07T03:30:00Z");
  it("reads the calendar date in the given time zone", () => {
    expect(localDate(now, "America/Chicago")).toBe("2026-10-06");
    expect(localDate(now, "Asia/Dhaka")).toBe("2026-10-07");
  });
  it("uses UTC when no zone is set", () => {
    expect(localDate(now, null)).toBe("2026-10-07");
  });
});
