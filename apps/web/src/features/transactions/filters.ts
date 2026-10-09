import {
  calendarDateSchema,
  idSchema,
  transactionStatusSchema,
} from "@ledgerline/shared";
import { z } from "zod";
// Validate each URL field separately so an invalid date range remains visible and correctable.
export const transactionSearchSchema = z.object({
  text: z.string().trim().max(200).optional().catch(undefined),
  accountId: idSchema.optional().catch(undefined),
  categoryId: idSchema.optional().catch(undefined),
  from: calendarDateSchema
    .refine((value) => value >= "0001-01-01")
    .optional()
    .catch(undefined),
  to: calendarDateSchema
    .refine((value) => value >= "0001-01-01")
    .optional()
    .catch(undefined),
  kind: z.enum(["expense", "income", "transfer"]).optional().catch(undefined),
  status: transactionStatusSchema.optional().catch(undefined),
});
export type TransactionFilters = z.infer<typeof transactionSearchSchema>;
export function dayLabel(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  const local = new Date(0);
  local.setFullYear(year ?? 1, (month ?? 1) - 1, day ?? 1);
  local.setHours(12, 0, 0, 0);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(local);
}
