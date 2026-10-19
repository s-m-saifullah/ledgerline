import { DownloadMessage } from "./message";
import { exportPath } from "./paths";
import { useCsvDownload } from "./use-csv-download";

/** Exports the entries the Transactions screen is showing, with the same filters. */
export function ExportButton({
  ledgerId,
  filters,
  disabled,
}: {
  ledgerId: string | undefined;
  filters: Record<string, string | boolean | undefined>;
  disabled: boolean;
}) {
  const { busy, message, start } = useCsvDownload();
  return (
    <div className="export-inline">
      <button
        type="button"
        className="secondary-button"
        disabled={!ledgerId || disabled || busy}
        onClick={() =>
          ledgerId &&
          void start(
            exportPath(ledgerId, "transactions", filters),
            "ledgerline-transactions.csv",
          )
        }
      >
        {busy ? "Preparing…" : "Export as CSV"}
      </button>
      <p className="muted export-hint">
        Saves the entries that match the filters above.
      </p>
      <DownloadMessage message={message} />
    </div>
  );
}
