import { SectionLabel } from "@ledgerline/ui";
import { useQuery } from "@tanstack/react-query";
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
    <section className="imp-section" aria-labelledby="export-title">
      <SectionLabel as="h2" id="export-title">
        Export
      </SectionLabel>
      <div className="imp-card">
        <div className="imp-range">
          <div className="imp-field">
            <label className="imp-label" htmlFor="export-from">
              From date
            </label>
            <DateTimeInput
              label="From date"
              id="export-from"
              type="date"
              min="0001-01-01"
              max="9999-12-31"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
          </div>
          <div className="imp-field">
            <label className="imp-label" htmlFor="export-to">
              To date
            </label>
            <DateTimeInput
              label="To date"
              id="export-to"
              type="date"
              min="0001-01-01"
              max="9999-12-31"
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
          </div>
        </div>
        {rangeInvalid ? (
          <p role="alert" className="field-error">
            Choose an end date on or after the start date.
          </p>
        ) : (
          <p className="imp-hint">Leave the dates empty for every entry.</p>
        )}
      </div>
      <div className="imp-actions">
        <button
          type="button"
          className="ui-btn ui-btn-primary"
          disabled={!ledgerId || rangeInvalid || busy}
          onClick={() => run("transactions")}
        >
          Download transactions
        </button>
        <button
          type="button"
          className="ui-btn ui-btn-secondary"
          disabled={!ledgerId || busy}
          onClick={() => run("accounts")}
        >
          Download accounts
        </button>
        <button
          type="button"
          className="ui-btn ui-btn-secondary"
          disabled={!ledgerId || busy}
          onClick={() => run("categories")}
        >
          Download categories
        </button>
      </div>
      <DownloadMessage message={message} />
      <p className="imp-note">
        Not kept on the server. Keep the files private.
      </p>
    </section>
  );
}
