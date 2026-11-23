import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { amountMinor } from "../lib/amount-input";
import {
  amountPlaceholder,
  centsFirstValue,
  pastedValue,
} from "./amount-entry";

/**
 * The phone types and reads an amount the way the web does (ADR 0028, ADR 0045): `CentsFirst.kt` and `parseAmount` are
 * Kotlin ports of `amount-entry.ts` and the typed-amount reader. The Android unit tests read `amount-parity.json`, and this
 * test builds the same file from the web's code and fails when they differ, so a change to the web's entry rules cannot
 * leave the phone behind. A deliberate change is made visible with `pnpm parity:update`, which rewrites the file.
 *
 * What the two read differently on purpose is left out of `typed` (the phone reads a comma as the decimal point and has no
 * "$"; the web strips "$" and thousands commas; the phone accepts zeros beyond the currency's decimals), so every case
 * here is one both must read the same.
 */
const file = resolve(
  __dirname,
  "../../../../apps/android/app/src/test/resources/amount-parity.json",
);
const update = process.env.UPDATE_PARITY === "1";

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

const digitsOf: Record<string, number> = { USD: 2, EUR: 2, JPY: 0, BHD: 3 };

function build() {
  const { next, digits, pick } = sequence(20261122);
  const places = [0, 2, 3];

  // One edit as the keyboard reports it: what the box held and what it shows now.
  const cents: {
    previous: string;
    next: string;
    digits: number;
    value: string;
  }[] = [];
  const edit = (previous: string, shown: string, decimals: number) =>
    cents.push({
      previous,
      next: shown,
      digits: decimals,
      value: centsFirstValue(previous, shown, decimals),
    });

  // Typing, character by character, from an empty box and from a value that was saved or pasted.
  for (const decimals of places)
    for (const start of ["", "0", "12.5", "100", "7", "12.34", "0.05"]) {
      let value = start;
      for (const key of "1203045960") {
        const shown = value + key;
        edit(value, shown, decimals);
        value = centsFirstValue(value, shown, decimals);
      }
      // ...and deleting back to nothing.
      while (value !== "") {
        const shown = value.slice(0, -1);
        edit(value, shown, decimals);
        value = centsFirstValue(value, shown, decimals);
      }
    }
  // Random typed runs, so odd lengths and leading zeros are covered.
  for (let i = 0; i < 40; i++) {
    const decimals = pick(places);
    let value = "";
    for (const key of digits(1 + Math.floor(next() * 14))) {
      const shown = value + key;
      edit(value, shown, decimals);
      value = centsFirstValue(value, shown, decimals);
    }
  }
  // Edits that are not one character at the end: the box replaced, a middle edit, characters that are not digits, an
  // amount beyond what the server stores exactly, a box that held text that is not an amount.
  const odd: [string, string][] = [
    ["12.34", "5"],
    ["12.34", "99"],
    ["12.34", "1x2"],
    ["12.34", "x"],
    ["12.34", "12.3"],
    ["12.34", "12.345"],
    ["12.34", "2.34"],
    ["12.34", "1.34"],
    ["12.34", "12.4"],
    ["12.34", ""],
    ["", "  "],
    ["", "abc"],
    ["", "1.5"],
    ["", "0.00"],
    ["1", "1 "],
    ["12.34", "12.34a"],
    ["12.34", "12.34 5"],
    ["abc", "abc1"],
    ["abc", "ab"],
    ["1.2.3", "1.2.34"],
    ["90071992547409.91", "90071992547409.911"],
    ["90071992547409.90", "90071992547409.901"],
    ["9007199254740991", "90071992547409910"],
    ["9007199254740990", "90071992547409901"],
    ["9007199254740", "90071992547409"],
    ["0.00", "0.001"],
    ["0.01", "0.0"],
    ["0.01", ""],
    ["5", "50"],
    ["50", "5"],
  ];
  for (const decimals of places)
    for (const [previous, shown] of odd) edit(previous, shown, decimals);

  const pasted: { text: string; digits: number; value: string | null }[] = [];
  const pastedTexts = [
    "12.50",
    "1250",
    "$1,200.50",
    "1,200",
    "1,200.5",
    " 12.5 ",
    "12.",
    ".5",
    "0",
    "0.0",
    "",
    "abc",
    "1e3",
    "-5",
    "1.2.3",
    "12,5",
    "$ 5",
    "$5.5",
    "1 000",
    "1,23",
    "1,2345",
    "00012.50",
    "9007199254740991",
    "90071992547409.91",
    "90071992547409.92",
    "9007199254740992",
    "0.001",
    "1.234",
    "1.2345",
  ];
  for (const decimals of places)
    for (const text of pastedTexts)
      pasted.push({
        text,
        digits: decimals,
        value: pastedValue(text, decimals),
      });

  const placeholder = places.map((decimals) => ({
    digits: decimals,
    text: amountPlaceholder(decimals),
  }));

  // An amount typed in an ordinary box, as exact minor units (null when it is not one amount that fits the currency).
  const typedTexts = [
    "12.5",
    "12.50",
    "0.5",
    ".5",
    "5.",
    "5",
    "0",
    "0.0",
    "00",
    "0.00",
    "0.001",
    "1.234",
    "1.2345",
    "12.345",
    " 12.5 ",
    "",
    " ",
    ".",
    "abc",
    "-1",
    "+1",
    "1e3",
    "1..2",
    "1.2.3",
    "007",
    "0012.5",
    "100000",
    "9999999",
    "99999999999",
    "90071992547409.91",
    "90071992547409.92",
    "9007199254740991",
    "9007199254740992",
    "9007199254740990.5",
    "123456789.123",
    "0.01",
    "0.1",
    "1.0",
    "1.",
    "0.999",
    "999.999",
    "1000.000",
    "7.5",
    "12.",
    "0.",
    ".05",
    ".005",
    "1 234.56",
    "1\u00a0234.56",
    "12 .5",
    "1 2",
  ];
  const typed: { text: string; currency: string; minor: number | null }[] = [];
  // The phone also reads zeros beyond the currency's decimals ("1000.000" in USD, "1.0" in JPY): the value is exact, so
  // it is never rounded, and a person who types them is not refused. The web refuses them. `AmountParityTest` pins the
  // phone's reading, and the cases are left out here.
  const zerosBeyond = (text: string, currency: string) => {
    const decimals = /\.(\d+)\s*$/.exec(text)?.[1] ?? "";
    return (
      decimals.length > (digitsOf[currency] ?? 2) &&
      decimals.replace(/0+$/, "").length <= (digitsOf[currency] ?? 2)
    );
  };
  const typedAs = (text: string, currency: string) => {
    if (zerosBeyond(text, currency)) return;
    typed.push({ text, currency, minor: amountMinor(text, currency) });
  };
  for (const currency of Object.keys(digitsOf))
    for (const text of typedTexts) typedAs(text, currency);
  for (let i = 0; i < 80; i++) {
    const currency = pick(Object.keys(digitsOf));
    const whole = digits(1 + Math.floor(next() * 12)).replace(/^0+(?=\d)/, "");
    const decimals = Math.floor(next() * 5);
    typedAs(decimals ? `${whole}.${digits(decimals)}` : whole, currency);
  }

  return {
    note: "Generated from apps/web/src/components/amount-entry.ts (centsFirstValue, pastedValue, amountPlaceholder) and lib/amount-input.ts (amountMinor) by android-parity.test.ts; synthetic numbers.",
    cents,
    pasted,
    placeholder,
    typed,
  };
}

describe("the phone's amount fixture follows the web's entry rules", () => {
  it("amount-parity.json holds what the web gives", () => {
    const built = build();
    if (update) {
      writeFileSync(file, `${JSON.stringify(built, null, 1)}\n`);
      return;
    }
    expect(
      built,
      "amount-parity.json is out of date with the web's amount entry. If the change is meant, run `pnpm parity:update` and review the diff.",
    ).toEqual(JSON.parse(readFileSync(file, "utf8")));
  });

  it("the cases include amounts and refusals, so neither side can pass by returning one kind", () => {
    const built = build();
    expect(built.cents.length).toBeGreaterThan(300);
    expect(built.pasted.some((c) => c.value === null)).toBe(true);
    expect(built.pasted.some((c) => c.value !== null)).toBe(true);
    expect(built.typed.some((c) => c.minor === null)).toBe(true);
    expect(built.typed.some((c) => c.minor !== null)).toBe(true);
    expect(
      built.typed.filter((c) => c.currency === "JPY" && c.minor !== null)
        .length,
    ).toBeGreaterThan(5);
  });
});
