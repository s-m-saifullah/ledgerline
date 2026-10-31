import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { useState } from "react";
import { DateTimeInput } from "../../components/date-time-input";
import { getLedgers } from "../../lib/api";
import { DownloadMessage } from "./message";
import { exportPath } from "./paths";
import { useCsvDownload } from "./use-csv-download";

/** Export, on the Import and export page: the ledger as CSV files made at the moment of download. */
export function ExportCard() {
  const ledgers = useQuery({ queryKey: ["ledgers"], queryFn: getLedgers });
  const ledgerId = ledgers.data?.items[0]?.id;
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const { busy, message, start } = useCsvDownload();
  const rangeInvalid = !!from && !!to && from > to;
  const run = (file: "transactions" | "accounts" | "categories") =>
    ledgerId &&
    void start(
      exportPath(ledgerId, file, { from, to }),
      `ledgerline-${file}.csv`,
    );
  return (
    <section className="ui-card ui-list" aria-labelledby="export-title">
      <div className="ui-row ui-row-static">
        <h2 id="export-title" className="ui-row-main imp-card-title">
          Export
        </h2>
      </div>
      <div className="imp-body imp-top">
        <div className="imp-fields">
          <div className="imp-field">
            <label htmlFor="export-from">From</label>
            <DateTimeInput
              label="From date"
              aria-label="From date"
              id="export-from"
              type="date"
              min="0001-01-01"
              max="9999-12-31"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
          </div>
          <div className="imp-field">
            <label htmlFor="export-to">To</label>
            <DateTimeInput
              label="To date"
              aria-label="To date"
              id="export-to"
              type="date"
              min="0001-01-01"
              max="9999-12-31"
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
          </div>
        </div>
        {rangeInvalid && (
          <p role="alert" className="field-error">
            Choose an end date on or after the start date.
          </p>
        )}
        <div className="imp-downloads">
          <button
            type="button"
            className="ui-btn ui-btn-primary"
            aria-label="Download transactions"
            disabled={!ledgerId || rangeInvalid || busy}
            onClick={() => run("transactions")}
          >
            <Download size={18} aria-hidden="true" />
            Transactions
          </button>
          <button
            type="button"
            className="ui-btn ui-btn-secondary"
            aria-label="Download accounts"
            disabled={!ledgerId || busy}
            onClick={() => run("accounts")}
          >
            <Download size={18} aria-hidden="true" />
            Accounts
          </button>
          <button
            type="button"
            className="ui-btn ui-btn-secondary"
            aria-label="Download categories"
            disabled={!ledgerId || busy}
            onClick={() => run("categories")}
          >
            <Download size={18} aria-hidden="true" />
            Categories
          </button>
        </div>
        <DownloadMessage message={message} />
      </div>
    </section>
  );
}
