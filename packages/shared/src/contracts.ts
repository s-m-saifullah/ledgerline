import { z } from "zod";

export const idSchema = z.uuid({ version: "v7" });
export const currencySchema = z
  .string()
  .regex(/^[A-Z]{3}$/)
  .refine(
    (code) => Intl.supportedValuesOf("currency").includes(code),
    "Unknown ISO currency",
  );
export const moneySchema = z.object({
  amount: z
    .number()
    .int()
    .refine(Number.isSafeInteger, "Amount exceeds safe integer range"),
  currency: currencySchema,
});
export type Money = z.infer<typeof moneySchema>;
export const usdMoneySchema = moneySchema.extend({
  currency: z.literal("USD"),
});
export const calendarDateSchema = z.iso.date();
export const versionSchema = z.number().int().min(1).max(2_147_483_647);
export const expectedVersionSchema = z.object({
  expectedVersion: versionSchema,
});
export const ledgerParamsSchema = z.object({ ledgerId: idSchema });
export const idempotencyKeySchema = z
  .string()
  .regex(/^[A-Za-z0-9._:-]{8,128}$/, "Provide a valid Idempotency-Key.");
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };
export const ledgerSchema = z.object({
  id: idSchema,
  name: z.string(),
  baseCurrency: currencySchema,
  role: z.enum(["owner", "editor", "viewer"]),
});
export const problemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string(),
  errors: z
    .array(z.object({ field: z.string(), message: z.string() }))
    .default([]),
});
export const signInSchema = z.object({
  email: z.email(),
  password: z.string().min(12).max(128),
});
