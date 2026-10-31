import { Download, FileUp } from "lucide-react";
import { PickRow } from "../../components/pick-row";
import { RecentImports } from "./recent-imports";
import { saveTemplate } from "./template";
import type { Wizard } from "./wizard";

export function FileStep({ w }: { w: Wizard }) {
  return (
    <>
      <div className="ui-card ui-list">
        <PickRow
          id="import-account"
          label="Import into"
          value={w.accountId}
          options={w.accounts.map((account) => ({
            value: account.id,
            label: `${account.name} (${account.currency})`,
          }))}
          onChange={w.setAccountId}
        />
        <div className="ui-row ui-row-static imp-drop-row">
          <label className="imp-drop" htmlFor="import-file">
            <FileUp size={24} aria-hidden="true" />
            <span className="imp-drop-title">Choose a CSV file</span>
            <span className="imp-drop-hint">5 MB and 5,000 rows at most</span>
            <input
              id="import-file"
              aria-label="CSV file"
              className="sr-only"
              type="file"
              accept=".csv,.txt,text/csv,text/plain"
              onChange={(event) => {
                const chosen = event.target.files?.[0];
                if (chosen) void w.loadFile(chosen);
                event.target.value = "";
              }}
            />
          </label>
          {w.fileError && (
            <p role="alert" className="field-error">
              {w.fileError}
            </p>
          )}
        </div>
      </div>
      <button
        type="button"
        className="ui-btn ui-btn-text imp-template"
        onClick={saveTemplate}
      >
        <Download size={18} aria-hidden="true" />
        Download CSV template
      </button>
      <RecentImports ledgerId={w.ledgerId} />
    </>
  );
}
