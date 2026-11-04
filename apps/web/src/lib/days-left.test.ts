import { expect, it } from "vitest";
import {
  daysLeft,
  daysLeftText,
  isUrgent,
  undoDays,
  undoEndsAt,
} from "./days-left";

const DAY = 24 * 60 * 60 * 1000;
const now = new Date("2026-11-10T12:00:00.000Z");
const inMs = (ms: number) => new Date(now.getTime() + ms).toISOString();

it("counts whole days exactly", () => {
  expect(daysLeft(inMs(23 * DAY), now)).toBe(23);
  expect(daysLeft(inMs(DAY), now)).toBe(1);
});

it("counts a part of a day as a whole one", () => {
  expect(daysLeft(inMs(22 * DAY + 1), now)).toBe(23);
  expect(daysLeft(inMs(22.5 * DAY), now)).toBe(23);
  expect(daysLeft(inMs(DAY + 1), now)).toBe(2);
  expect(daysLeft(inMs(3 * DAY - 1), now)).toBe(3);
});

it("never says 0 days: the last hour, the moment itself and a moment already past are all 1", () => {
  expect(daysLeft(inMs(60 * 60 * 1000), now)).toBe(1);
  expect(daysLeft(inMs(1), now)).toBe(1);
  expect(daysLeft(inMs(0), now)).toBe(1);
  expect(daysLeft(inMs(-5 * DAY), now)).toBe(1);
});

it("reads the current time when none is given", () => {
  expect(daysLeft(new Date(Date.now() + 5 * DAY - 60_000).toISOString())).toBe(
    5,
  );
});

it("says '1 day left' for one and 'N days left' for the rest", () => {
  expect(daysLeftText(1)).toBe("1 day left");
  expect(daysLeftText(2)).toBe("2 days left");
  expect(daysLeftText(30)).toBe("30 days left");
});

it("is urgent at 3 days or fewer, and not at 4", () => {
  expect(isUrgent(1)).toBe(true);
  expect(isUrgent(3)).toBe(true);
  expect(isUrgent(4)).toBe(false);
});

it("gives a cleared ledger 30 days, to the millisecond", () => {
  expect(undoDays).toBe(30);
  expect(undoEndsAt("2026-11-04T10:00:00.123Z")).toBe(
    "2026-12-04T10:00:00.123Z",
  );
});
