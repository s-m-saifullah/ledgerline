import { describe, expect, it } from "vitest";
import { testConfig } from "./test-support/harness";

const url = "postgres://user:pass@127.0.0.1:5432/example";

describe("the rate fetch switch", () => {
  it("is on unless it is turned off", () => {
    expect(testConfig(url, "config").RATES_ENABLED).toBe(true);
    expect(
      testConfig(url, "config", { RATES_ENABLED: "true" }).RATES_ENABLED,
    ).toBe(true);
    expect(
      testConfig(url, "config", { RATES_ENABLED: "false" }).RATES_ENABLED,
    ).toBe(false);
  });

  it("refuses anything else, so a typo cannot leave the fetch on by mistake", () => {
    for (const value of ["no", "0", "off", "", "FALSE"])
      expect(() => testConfig(url, "config", { RATES_ENABLED: value })).toThrow(
        /RATES_ENABLED/,
      );
  });

  it("is separate from the background jobs switch", () => {
    const config = testConfig(url, "config", {
      RATES_ENABLED: "false",
      JOBS_ENABLED: "true",
    });
    expect(config.RATES_ENABLED).toBe(false);
    expect(config.JOBS_ENABLED).toBe(true);
    const jobsOff = testConfig(url, "config", { JOBS_ENABLED: "false" });
    expect(jobsOff.RATES_ENABLED).toBe(true);
  });
});
