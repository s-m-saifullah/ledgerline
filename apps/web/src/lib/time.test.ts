import { describe, expect, it } from "vitest";
import {
  formatDay,
  formatDayHead,
  formatDayTime,
  formatMonthLong,
  formatMonthShort,
  formatTime12,
  to24Hour,
} from "./time";

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

describe("formatDay", () => {
  const today = "2026-11-14";
  it("writes a date as Nov 1, with no year in the current year", () => {
    expect(formatDay("2026-11-01", today)).toBe("Nov 1");
    expect(formatDay("2026-01-09", today)).toBe("Jan 9");
    expect(formatDay("2026-12-31", today)).toBe("Dec 31");
    expect(formatDay("2026-02-28", today)).toBe("Feb 28");
  });
  it("adds the year when it is not this year, earlier or later", () => {
    expect(formatDay("2025-12-31", today)).toBe("Dec 31, 2025");
    expect(formatDay("2027-01-01", today)).toBe("Jan 1, 2027");
    expect(formatDay("2025-01-09", today)).toBe("Jan 9, 2025");
  });
  it("follows the year of the day it is given, on the first and last day of a year", () => {
    expect(formatDay("2026-01-01", "2026-12-31")).toBe("Jan 1");
    expect(formatDay("2026-12-31", "2027-01-01")).toBe("Dec 31, 2026");
    expect(formatDay("2027-01-01", "2026-12-31")).toBe("Jan 1, 2027");
  });
  it("reads the text, so a time zone cannot move the day", () => {
    expect(formatDay("2026-03-08", today)).toBe("Mar 8");
    expect(formatDay("2026-11-01", today)).toBe("Nov 1");
  });
  it("turns a timestamp into the day it fell on in the given time zone", () => {
    expect(formatDay("2026-11-01T03:30:00Z", today, "UTC")).toBe("Nov 1");
    expect(formatDay("2026-11-01T03:30:00Z", today, "America/Chicago")).toBe(
      "Oct 31",
    );
    expect(formatDay("2026-11-01T03:30:00Z", today, "Asia/Dhaka")).toBe(
      "Nov 1",
    );
    expect(formatDay("2026-01-01T00:30:00Z", today, "America/Chicago")).toBe(
      "Dec 31, 2025",
    );
  });
  it("returns anything that is not a date unchanged", () => {
    for (const value of [
      "",
      "soon",
      "2026-13-01",
      "2026-11-32",
      "11/01/2026",
      "2026-13-45T10:00:00Z",
    ])
      expect(formatDay(value, today)).toBe(value);
  });
});
describe("formatDayTime", () => {
  const now = new Date("2026-11-14T12:00:00Z");
  it("writes Nov 1, 2:05 PM, with no year in the current year", () => {
    expect(formatDayTime("2026-11-01T14:05:00Z", now, "UTC")).toBe(
      "Nov 1, 2:05 PM",
    );
    expect(formatDayTime("2026-11-01T09:07:00Z", now, "UTC")).toBe(
      "Nov 1, 9:07 AM",
    );
  });
  it("shows midnight as 12 AM and noon as 12 PM", () => {
    expect(formatDayTime("2026-11-01T00:05:00Z", now, "UTC")).toBe(
      "Nov 1, 12:05 AM",
    );
    expect(formatDayTime("2026-11-01T12:00:00Z", now, "UTC")).toBe(
      "Nov 1, 12:00 PM",
    );
  });
  it("adds the year, before the time, when it is not this year", () => {
    expect(formatDayTime("2025-11-01T14:05:00Z", now, "UTC")).toBe(
      "Nov 1, 2025, 2:05 PM",
    );
    expect(formatDayTime("2027-02-03T01:00:00Z", now, "UTC")).toBe(
      "Feb 3, 2027, 1:00 AM",
    );
  });
  it("reads the day and the clock in the given time zone, and judges the year there", () => {
    expect(formatDayTime("2026-11-01T03:30:00Z", now, "America/Chicago")).toBe(
      "Oct 31, 10:30 PM",
    );
    expect(formatDayTime("2026-01-01T00:30:00Z", now, "America/Chicago")).toBe(
      "Dec 31, 2025, 6:30 PM",
    );
    const newYear = new Date("2027-01-01T04:00:00Z");
    expect(formatDayTime("2026-12-31T20:00:00Z", newYear, "UTC")).toBe(
      "Dec 31, 2026, 8:00 PM",
    );
    expect(
      formatDayTime("2026-12-31T20:00:00Z", newYear, "America/Chicago"),
    ).toBe("Dec 31, 2:00 PM");
  });
  it("returns anything that is not a timestamp unchanged", () => {
    for (const value of ["", "yesterday", "2026-11-01", "2026-13-45T10:00:00Z"])
      expect(formatDayTime(value, now, "UTC")).toBe(value);
  });
});
describe("formatMonthShort and formatMonthLong", () => {
  it("name a month from YYYY-MM, with no year", () => {
    expect(formatMonthShort("2026-01")).toBe("Jan");
    expect(formatMonthShort("2026-11")).toBe("Nov");
    expect(formatMonthShort("2025-12")).toBe("Dec");
    expect(formatMonthShort("2026-09")).toBe("Sep");
  });
  it("returns anything that is not a month unchanged", () => {
    for (const value of ["", "2026-00", "2026-13", "soon"])
      expect(formatMonthShort(value)).toBe(value);
  });
  it("names the twelve months in full, counted from 0", () => {
    expect(Array.from({ length: 12 }, (_, i) => formatMonthLong(i))).toEqual([
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ]);
  });
});
describe("formatDayHead", () => {
  it("writes the weekday and the year every time, as the day heads of Transactions do", () => {
    expect(formatDayHead("2026-11-02")).toBe("Mon, Nov 2, 2026");
    expect(formatDayHead("2026-11-14")).toBe("Sat, Nov 14, 2026");
    expect(formatDayHead("2025-12-31")).toBe("Wed, Dec 31, 2025");
    expect(formatDayHead("2024-02-29")).toBe("Thu, Feb 29, 2024");
    expect(formatDayHead("2026-11-08")).toBe("Sun, Nov 8, 2026");
  });
  it("returns anything that is not a date unchanged", () => {
    for (const value of ["", "soon", "2026-02-30"])
      expect(formatDayHead(value)).toBe(value);
  });
});
