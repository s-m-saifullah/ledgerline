import { type HomeSummary, homeSummarySchema } from "@ledgerline/shared";
import { api } from "../../lib/api";

export async function getHome(
  ledgerId: string,
  month: string,
  signal?: AbortSignal,
): Promise<HomeSummary> {
  return homeSummarySchema.parse(
    await api(`/ledgers/${ledgerId}/home?month=${month}`, {
      ...(signal ? { signal } : {}),
    }),
  );
}
