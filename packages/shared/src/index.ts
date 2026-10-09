import { v7 } from "uuid";
import { calendarDateSchema, type Money, moneySchema } from "./contracts";

export * from "./accounts";
export * from "./categories";
export * from "./contracts";
export * from "./transactions";

export const newId = v7;

/** Parse decimal text without ever rounding through floating-point arithmetic. */
export function parseMinorUnits(value: string, decimals = 2): number {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 6)
    throw new RangeError("Invalid decimal precision");
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) throw new Error("Invalid amount");
  const fraction = match[3] ?? "";
  if (fraction.length > decimals) throw new Error("Too many decimal places");
  const amount =
    BigInt(match[2] ?? "0") * 10n ** BigInt(decimals) +
    BigInt(fraction.padEnd(decimals, "0") || "0");
  const signed = match[1] ? -amount : amount;
  if (
    signed > BigInt(Number.MAX_SAFE_INTEGER) ||
    signed < BigInt(Number.MIN_SAFE_INTEGER)
  )
    throw new RangeError("Amount exceeds safe integer range");
  return Number(signed);
}

export function addMoney(a: Money, b: Money): Money {
  moneySchema.parse(a);
  moneySchema.parse(b);
  if (a.currency !== b.currency) throw new Error("Currency mismatch");
  return moneySchema.parse({
    amount: a.amount + b.amount,
    currency: a.currency,
  });
}

export function isoDate(value: string): string {
  return calendarDateSchema.parse(value);
}

export * from "./home";
export * from "./receipts";
export * from "./receivables";
export * from "./transfers";
