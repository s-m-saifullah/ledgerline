import { describe, expect, it } from "vitest";
import {
  dueNow,
  everySentence,
  formatDate,
  ledgerToday,
  upcomingDates,
} from "./schedule";

const monthly = (startDate: string, endDate: string | null = null) => ({
  frequency: "month" as const,
  interval: 1,
  startDate,
  endDate,
});

describe("recurring schedule text", () => {
  it("words the repeat and formats dates without a time zone shift", () => {
    expect(everySentence("month", 1)).toBe("Every month");
    expect(everySentence("week", 2)).toBe("Every 2 weeks");
    expect(formatDate("2026-11-01")).toBe("1 Nov 2026");
    expect(formatDate("0099-02-03")).toBe("3 Feb 99");
  });

  it("knows the ledger's today", () => {
    const instant = new Date("2026-10-11T03:30:00Z");
    expect(ledgerToday("America/Chicago", instant)).toBe("2026-10-10");
    expect(ledgerToday("Asia/Dhaka", instant)).toBe("2026-10-11");
    expect(ledgerToday(null, instant)).toBe("2026-10-11");
  });

  it("previews upcoming dates and honors the end date", () => {
    expect(upcomingDates(monthly("2026-01-31"), "2026-02-01")).toEqual([
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
    ]);
    expect(upcomingDates(monthly("2026-11-01"), "2026-10-11")[0]).toBe(
      "2026-11-01",
    );
    expect(
      upcomingDates(monthly("2026-11-01", "2026-12-15"), "2026-10-11"),
    ).toEqual(["2026-11-01", "2026-12-01"]);
  });

  it("counts what is already due when saving", () => {
    expect(dueNow(monthly("2026-11-01"), "2026-10-11")).toBe(0);
    expect(dueNow(monthly("2026-08-31"), "2026-10-11")).toBe(2);
    expect(dueNow(monthly("2026-08-31", "2026-09-30"), "2026-10-11")).toBe(2);
    expect(dueNow(monthly("2026-08-31", "2026-08-31"), "2026-10-11")).toBe(1);
  });
});
