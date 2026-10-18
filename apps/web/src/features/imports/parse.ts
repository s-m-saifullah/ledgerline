import type { DateFormat, DecimalStyle } from "./mapping";

/** A calendar date as YYYY-MM-DD, or null when the text is not a real date in this format. */
export function parseDate(text: string, format: DateFormat): string | null {
  const match = /^\s*(\d{1,4})[-/.](\d{1,2})[-/.](\d{1,4})(?:[T\s].*)?$/.exec(
    text,
  );
  if (!match) return null;
  const [a, b, c] = [
    match[1] as string,
    match[2] as string,
    match[3] as string,
  ];
  let year: number;
  let month: number;
  let day: number;
  if (format === "iso") {
    if (a.length !== 4) return null;
    [year, month, day] = [Number(a), Number(b), Number(c)];
  } else {
    if (c.length !== 4 && c.length !== 2) return null;
    year = c.length === 2 ? 2000 + Number(c) : Number(c);
    [month, day] =
      format === "mdy" ? [Number(a), Number(b)] : [Number(b), Number(a)];
  }
  if (year < 1 || month < 1 || month > 12 || day < 1) return null;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][
    month - 1
  ] as number;
  if (day > days) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** HH:MM from "9:05", "09:05:30" or "9:05 PM"; null for anything else. */
export function parseTime(text: string): string | null {
  const match = /^\s*(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap]m)?\s*$/i.exec(text);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const meridiem = match[3]?.toLowerCase();
  if (minute > 59) return null;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (meridiem === "pm" ? 12 : 0);
  } else if (hour > 23) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/**
 * Signed minor units from text such as "1,234.56", "(12.50)", "-$7", "12.50-" or "€ 1.234,56",
 * by integer math (never floating point). Null when it is not an amount in at most `digits`
 * decimals.
 */
export function parseAmount(
  text: string,
  decimal: DecimalStyle,
  digits: number,
): number | null {
  let value = text.trim();
  if (!value) return null;
  let negative = false;
  if (/^\(.*\)$/.test(value)) {
    negative = true;
    value = value.slice(1, -1);
  }
  // A three-letter currency code before or after the number, then symbols and spaces.
  value = value
    .replace(/^\s*[A-Za-z]{3}(?![A-Za-z])/, "")
    .replace(/(?<![A-Za-z])[A-Za-z]{3}\s*$/, "")
    .replace(/[$€£¥₹\s\u00a0']/g, "");
  if (value.endsWith("-")) {
    negative = !negative;
    value = value.slice(0, -1);
  }
  if (value.startsWith("-")) {
    negative = !negative;
    value = value.slice(1);
  } else if (value.startsWith("+")) value = value.slice(1);
  const point = decimal === "dot" ? "." : ",";
  const group = decimal === "dot" ? "," : ".";
  const parts = value.split(point);
  if (parts.length > 2) return null;
  const whole = (
    parts[0] === "" && parts.length === 2 ? "0" : (parts[0] ?? "")
  ).split(group);
  if (
    whole.some(
      (chunk, i) => !/^\d+$/.test(chunk) || (i > 0 && chunk.length !== 3),
    ) ||
    ((whole[0] as string).length > 3 && whole.length > 1)
  )
    return null;
  const fraction = parts[1] ?? "";
  if (parts.length === 2 && !/^\d*$/.test(fraction)) return null;
  if (fraction.length > digits) return null;
  const units =
    BigInt(whole.join("")) * 10n ** BigInt(digits) +
    BigInt(fraction.padEnd(digits, "0") || "0");
  if (units > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(negative ? -units : units);
}
