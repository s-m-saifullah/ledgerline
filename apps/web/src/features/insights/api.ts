import {
  type CashFlowReport,
  cashFlowReportSchema,
  type NetWorthReport,
  netWorthReportSchema,
  type SpendingReport,
  spendingReportSchema,
} from "@ledgerline/shared";
import { api } from "../../lib/api";

export async function getSpendingReport(
  ledgerId: string,
  month: string,
  signal?: AbortSignal,
): Promise<SpendingReport> {
  return spendingReportSchema.parse(
    await api(`/ledgers/${ledgerId}/reports/spending?month=${month}`, {
      ...(signal ? { signal } : {}),
    }),
  );
}

export async function getCashFlowReport(
  ledgerId: string,
  month: string,
  signal?: AbortSignal,
): Promise<CashFlowReport> {
  return cashFlowReportSchema.parse(
    await api(`/ledgers/${ledgerId}/reports/cash-flow?to=${month}&months=12`, {
      ...(signal ? { signal } : {}),
    }),
  );
}

export async function getNetWorthReport(
  ledgerId: string,
  month: string,
  signal?: AbortSignal,
): Promise<NetWorthReport> {
  return netWorthReportSchema.parse(
    await api(`/ledgers/${ledgerId}/reports/net-worth?to=${month}&months=12`, {
      ...(signal ? { signal } : {}),
    }),
  );
}
