import { convertMinor, type Money } from "@ledgerline/shared";
import { useQuery } from "@tanstack/react-query";
import { getCurrencies } from "./api";

/**
 * The ledger's currencies and their newest stored rates, for showing what an amount in another
 * currency is worth in the base currency today (the same rule Home uses for balances).
 */
export function useBaseValues(ledgerId: string | undefined) {
  const list = useQuery({
    queryKey: ["currencies", ledgerId],
    queryFn: ({ signal }) => getCurrencies(ledgerId as string, signal),
    enabled: !!ledgerId,
    staleTime: 0,
  });
  const data = list.data;
  const baseCurrency = data?.baseCurrency ?? "USD";
  const rates = new Map(
    (data?.items ?? []).flatMap((item) =>
      item.latestRate ? [[item.code, item.latestRate.rate] as const] : [],
    ),
  );
  return {
    baseCurrency,
    /** The base currency first, then the ones the ledger has added. */
    currencies: [baseCurrency, ...(data?.items ?? []).map((item) => item.code)],
    /** The amount in the base currency, or null when it already is, or no rate exists. */
    baseValue(money: Money): number | null {
      if (money.currency === baseCurrency) return null;
      const rate = rates.get(money.currency);
      if (!rate) return null;
      try {
        return convertMinor(money.amount, rate, money.currency, baseCurrency);
      } catch {
        return null;
      }
    },
  };
}
