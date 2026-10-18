import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { DateTimeInput } from "../../components/date-time-input";
import { getLedgers } from "../../lib/api";
import { DownloadMessage } from "./message";
import { exportPath } from "./paths";
import { useCsvDownload } from "./use-csv-download";

/** Settings card: download the ledger as CSV files made at the moment of download. */
export function YourDataCard() {
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
    <section className="settings-card" aria-labelledby="your-data-title">
      <h2 id="your-data-title">Your data</h2>
      <p className="scope-label">This ledger</p>
      <p className="muted">
        Download your ledger as CSV files that open in any spreadsheet. A file
        is made when you ask for it and is not kept on the server.
      </p>
      <div className="export-range">
        <div>
          <label htmlFor="export-from">From date</label>
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
        <div>
          <label htmlFor="export-to">To date</label>
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
      <p className="muted">Leave the dates empty to include every entry.</p>
      {rangeInvalid && (
        <p role="alert" className="field-error">
          Choose an end date on or after the start date.
        </p>
      )}
      <div className="export-actions">
        <button
          type="button"
          className="button"
          disabled={!ledgerId || rangeInvalid || busy}
          onClick={() => run("transactions")}
        >
          Download transactions
        </button>
        <button
          type="button"
          className="secondary-button"
          disabled={!ledgerId || busy}
          onClick={() => run("accounts")}
        >
          Download accounts
        </button>
        <button
          type="button"
          className="secondary-button"
          disabled={!ledgerId || busy}
          onClick={() => run("categories")}
        >
          Download categories
        </button>
      </div>
      <DownloadMessage message={message} />
      <p className="muted">
        These files hold your financial data. Keep them somewhere private.
      </p>
    </section>
  );
}
