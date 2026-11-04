import { describe, expect, it } from "vitest";
import { dragSpeed, releaseOutcome } from "./sheet-drag";

// What lifting a finger does after a drag down the sheet (a sheet 300 px tall in these cases).
describe("releaseOutcome", () => {
  it("closes a sheet dragged 40% of its height or more, even slowly", () => {
    expect(releaseOutcome({ dy: 120, height: 300, speed: 0 })).toBe("close");
    expect(releaseOutcome({ dy: 250, height: 300, speed: 0.01 })).toBe("close");
  });
  it("springs back a short, slow drag", () => {
    expect(releaseOutcome({ dy: 119, height: 300, speed: 0.2 })).toBe("back");
    expect(releaseOutcome({ dy: 60, height: 300, speed: 0.49 })).toBe("back");
    expect(releaseOutcome({ dy: 0, height: 300, speed: 0 })).toBe("back");
  });
  it("closes on a flick: quick and at least 24 px", () => {
    expect(releaseOutcome({ dy: 24, height: 300, speed: 0.5 })).toBe("close");
    expect(releaseOutcome({ dy: 70, height: 300, speed: 1.2 })).toBe("close");
  });
  it("does not close on a twitch, however fast", () => {
    expect(releaseOutcome({ dy: 23, height: 300, speed: 5 })).toBe("back");
  });
  it("a drag back up is never a close", () => {
    expect(releaseOutcome({ dy: -80, height: 300, speed: -2 })).toBe("back");
  });
});

describe("dragSpeed", () => {
  it("is the downward speed over the last 150 ms", () => {
    // 10 px in the last 50 ms; the first sample is older than the window.
    expect(
      dragSpeed([
        [0, 0],
        [900, 100],
        [950, 110],
      ]),
    ).toBeCloseTo(0.2, 5);
  });
  it("is zero with no movement in time, or no samples", () => {
    expect(dragSpeed([])).toBe(0);
    expect(dragSpeed([[10, 5]])).toBe(0);
    expect(
      dragSpeed([
        [10, 5],
        [10, 50],
      ]),
    ).toBe(0);
  });
  it("is negative for an upward drag", () => {
    expect(
      dragSpeed([
        [0, 100],
        [50, 60],
      ]),
    ).toBeLessThan(0);
  });
});
