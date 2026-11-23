import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  convertMinor,
  deriveRate,
  invertRate,
  rateFromInverse,
} from "./currency";
import { hourlyTotal, hoursToHundredths } from "./receivables";
import { hoursFromTyped, rateFromTyped } from "./typed";

/**
 * The phone's money maths is a Kotlin port of this package. The Android unit tests read two JSON files of cases, and this
 * test builds the same files from the code in this package and fails when they differ, so a change here cannot leave
 * the phone behind without a failing run (the unit job runs it; the Android job runs the files).
 *
 * The files are synthetic numbers only. A deliberate change is made visible with `pnpm parity:update`, which rewrites
 * them (the Android suite then runs against the new answers). Each file's inputs are fixed here or, for the two lists
 * the phone checks one by one (`derive` and `invert`), kept in the file itself while the answers are worked out again.
 */
const resources = "../../../apps/android/app/src/test/resources/";
const update = process.env.UPDATE_PARITY === "1";

function readFixture(name: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(new URL(resources + name, import.meta.url), "utf8"),
  );
}

/** Compares the committed file with what the code gives now; with UPDATE_PARITY=1 it writes the file instead. */
function expectFixture(name: string, built: Record<string, unknown>) {
  if (update) {
    writeFileSync(
      new URL(resources + name, import.meta.url),
      `${JSON.stringify(built, null, 1)}\n`,
    );
    return;
  }
  expect(
    built,
    `${name} is out of date with packages/shared. If the change is meant, run \`pnpm parity:update\` and review the diff.`,
  ).toEqual(readFixture(name));
}

/** A small deterministic generator, so a fixture is the same every run. */
function sequence(start: number) {
  let seed = start;
  const next = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const digits = (n: number) =>
    Array.from({ length: n }, () => Math.floor(next() * 10)).join("");
  const pick = <T>(xs: T[]): T => xs[Math.floor(next() * xs.length)] as T;
  return { next, digits, pick };
}

function convertCase(amount: number, rate: string, from: string, to: string) {
  let result: number | string;
  try {
    result = convertMinor(amount, rate, from, to);
  } catch {
    result = "error";
  }
  return { amount, rate, from, to, result };
}

function rateParity(committed: Record<string, unknown>) {
  const { next, digits, pick } = sequence(20261111);
  const typed: string[] = [
    "122.5",
    "1",
    "0.5",
    "16300",
    "1.0869565217",
    "abc",
    "",
    " ",
    "0",
    "0.0",
    "0.00",
    "-1",
    "1e3",
    "12,5",
    " 122.5 ",
    "0.0000000001",
    "0.00000001",
    "0.000001",
    "1.12345678901",
    "00122.5",
    "122.",
    ".5",
    "100000",
    "0.001",
    "7.123456789",
    "9999999999",
    "99999999999",
    "10000000000",
    "152.1",
    "0.92",
    "1.086957",
    "3.14159265358979",
    "50000000",
    "0.00000000001",
  ];
  for (let i = 0; i < 60; i++) {
    const whole = digits(1 + Math.floor(next() * 10)).replace(/^0+(?=\d)/, "");
    const decimals = Math.floor(next() * 11);
    typed.push(decimals ? `${whole}.${digits(decimals)}` : whole);
  }
  const fromInverse = typed.map((text) => ({
    text,
    rate: rateFromInverse(text),
  }));

  // What a person types in the rate box (WP-15): ".8" and "8." are read as meant; everything else as before.
  const typedExtras = [
    ".8",
    "8.",
    " .05 ",
    ".",
    "0.",
    ".0",
    " 0. ",
    "..5",
    "5..",
    "1.2.3",
    "-.8",
    "+.8",
    ".8.",
    "8 .",
    "0.8",
    "08.",
    ".00000000001",
    ".5000000000",
    "12345678901.",
    "99999999999.",
    "122.5",
    "",
  ];
  const fromTyped = [...typed, ...typedExtras].map((text) => ({
    text,
    rate: rateFromTyped(text),
  }));

  const currencies = ["USD", "EUR", "GBP", "JPY", "BHD", "BDT"];
  const rates = [
    "1",
    "0.92",
    "1.0869565217",
    "0.0065746219",
    "122.5",
    "0.0000000001",
    "9999999999.9999999999",
    "0.5",
    "2",
    "1.2658227848",
  ];
  const amounts = [
    1, 2, 99, 100, 101, 12345, 99999, 1_000_000, 123_456_789,
    9_007_199_254_740_991, -1, -250, -123456,
  ];
  const convert: object[] = [];
  for (const amount of amounts)
    for (const rate of rates)
      convert.push(
        convertCase(amount, rate, pick(currencies), pick(currencies)),
      );
  for (let i = 0; i < 80; i++) {
    const amount =
      Math.floor(next() * 10 ** (1 + Math.floor(next() * 11))) *
      (next() < 0.1 ? -1 : 1);
    const rate =
      `${Math.floor(next() * 1000)}.${digits(Math.floor(next() * 11) % 11)}`.replace(
        /\.$/,
        "",
      );
    convert.push(convertCase(amount, rate, pick(currencies), pick(currencies)));
  }

  // The two lists the phone checks one case at a time: their inputs stay in the file, the answers are worked out again.
  const derive = (
    committed.derive as { base: number; amount: number; code: string }[]
  ).map(({ base, amount, code }) => ({
    base,
    amount,
    code,
    rate: deriveRate(base, amount, code, "USD"),
  }));
  const invert = (committed.invert as { rate: string }[]).map(({ rate }) => ({
    rate,
    inverted: invertRate(rate),
  }));

  return {
    note: "Generated from packages/shared/src/currency.ts (deriveRate with base USD, invertRate, rateFromInverse, convertMinor) and typed.ts (rateFromTyped) by android-parity.test.ts; synthetic numbers.",
    derive,
    invert,
    fromInverse,
    convert,
    fromTyped,
  };
}

function hourlyParity() {
  const { next, digits } = sequence(20261112);
  const typed: string[] = [
    "3.5",
    "0.25",
    "1",
    "0",
    "0.0",
    "0.00",
    "0.01",
    "00.5",
    "9999.99",
    "10000",
    "10000.5",
    "1.234",
    "-1",
    "abc",
    "",
    " ",
    " 2.5 ",
    "2.",
    ".5",
    "1,5",
    "1e2",
    "12345",
    "0.1",
    "7.05",
    "100",
    "99.9",
    "1.50",
    "01",
    "0001.5",
  ];
  for (let i = 0; i < 60; i++) {
    const whole = digits(1 + Math.floor(next() * 5));
    const decimals = Math.floor(next() * 4);
    typed.push(decimals ? `${whole}.${digits(decimals)}` : whole);
  }
  const hours = typed.map((text) => ({
    text,
    hundredths: hoursToHundredths(text),
  }));

  // What a person types in the hours box (WP-15): ".5" and "3." are read as meant. A comma as the point ("1,5") is read
  // on the phone only, so it is left out of what the two are compared on.
  const typedExtras = [
    ".5",
    ".25",
    "3.",
    "3.5",
    " .5 ",
    ".",
    "",
    "0.",
    ".0",
    ".00",
    ".001",
    ".999",
    "9999.",
    "10000.",
    "1.2.3",
    "..5",
    "-.5",
  ];
  const hoursTyped = [
    ...typed.filter((text) => !text.includes(",")),
    ...typedExtras,
  ].map((text) => ({
    text,
    hundredths: hoursFromTyped(text),
  }));

  const rates = [
    1, 2, 99, 100, 4000, 4050, 12345, 999999, 1_000_000_000,
    9_007_199_254_740_991, 1234567890123,
  ];
  const counts = [1, 2, 25, 50, 100, 350, 999999, 1_000_000];
  const total: object[] = [];
  for (const rate of rates)
    for (const hundredths of counts)
      total.push({ rate, hundredths, total: hourlyTotal(rate, hundredths) });
  for (let i = 0; i < 80; i++) {
    const rate = Math.floor(next() * 10 ** (1 + Math.floor(next() * 14))) + 1;
    const hundredths =
      Math.floor(next() * 10 ** (1 + Math.floor(next() * 6))) + 1;
    total.push({ rate, hundredths, total: hourlyTotal(rate, hundredths) });
  }
  return {
    note: "Generated from packages/shared/src/receivables.ts (hoursToHundredths, hourlyTotal) and typed.ts (hoursFromTyped) by android-parity.test.ts; synthetic numbers.",
    hours,
    hoursTyped,
    total,
  };
}

describe("the phone's fixtures follow the shared code", () => {
  it("rate-parity.json holds what currency.ts and typed.ts give", () => {
    expectFixture(
      "rate-parity.json",
      rateParity(readFixture("rate-parity.json")),
    );
  });

  it("hourly-parity.json holds what receivables.ts and typed.ts give", () => {
    expectFixture("hourly-parity.json", hourlyParity());
  });

  it("the cases include answers and refusals, so neither side can pass by returning one kind", () => {
    const rates = rateParity(readFixture("rate-parity.json"));
    expect(rates.fromInverse.some((c) => c.rate === null)).toBe(true);
    expect(rates.fromInverse.some((c) => c.rate !== null)).toBe(true);
    expect(rates.fromTyped.some((c) => c.rate === null)).toBe(true);
    expect(
      rates.convert.some((c) => (c as { result: unknown }).result === "error"),
    ).toBe(true);
    const hourly = hourlyParity();
    expect(hourly.hours.some((c) => c.hundredths === null)).toBe(true);
    expect(hourly.hoursTyped.some((c) => c.hundredths !== null)).toBe(true);
    expect(
      hourly.total.some((c) => (c as { total: unknown }).total === null),
    ).toBe(true);
  });
});
