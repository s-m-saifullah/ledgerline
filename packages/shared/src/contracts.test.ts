import { describe, expect, it } from "vitest";
import { isTimeZone, timeZoneSchema } from "./contracts";

describe("time zone names", () => {
  it("accepts IANA names and UTC", () => {
    for (const name of ["UTC", "America/Chicago", "Asia/Dhaka", "Etc/GMT+5"])
      expect(isTimeZone(name)).toBe(true);
  });
  it("rejects offsets, unknown names and junk", () => {
    for (const name of ["", "+05:00", "Mars/Base", "america chicago", "../x"])
      expect(timeZoneSchema.safeParse(name).success).toBe(false);
  });
});
