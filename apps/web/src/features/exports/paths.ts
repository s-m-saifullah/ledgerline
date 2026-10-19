/** The export address for a kind of file; the transactions file takes the list filters. */
export function exportPath(
  ledgerId: string,
  file: "transactions" | "accounts" | "categories",
  filters: Record<string, string | boolean | undefined> = {},
) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters))
    if (value) query.set(key, String(value));
  const text = query.toString();
  return `/ledgers/${ledgerId}/exports/${file}.csv${text && file === "transactions" ? `?${text}` : ""}`;
}
