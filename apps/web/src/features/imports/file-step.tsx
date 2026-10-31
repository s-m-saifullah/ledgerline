import { Download } from "lucide-react";
import { NativeSelect } from "../../components/native-select";
import { RecentImports } from "./recent-imports";
import { saveTemplate } from "./template";
import type { Wizard } from "./wizard";

export function FileStep({ w }: { w: Wizard }) {
  return (
    <>
      <div className="imp-card">
        <div className="imp-field">
          <label className="imp-label" htmlFor="import-account">
            Import into
          </label>
          <NativeSelect
            id="import-account"
            value={w.accountId}
            onChange={(event) => w.setAccountId(event.target.value)}
          >
            {w.accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name} ({account.currency})
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="imp-field">
          <label className="imp-label" htmlFor="import-file">
            CSV file
          </label>
          <input
            id="import-file"
            type="file"
            accept=".csv,.txt,text/csv,text/plain"
            onChange={(event) => {
              const chosen = event.target.files?.[0];
              if (chosen) void w.loadFile(chosen);
              event.target.value = "";
            }}
          />
        </div>
        {w.fileError && (
          <p role="alert" className="field-error">
            {w.fileError}
          </p>
        )}
        <p className="imp-hint">
          Read in your browser; only approved rows are saved.
        </p>
      </div>
      <div className="imp-actions">
        <button
          type="button"
          className="ui-btn ui-btn-text"
          onClick={saveTemplate}
        >
          <Download size={16} aria-hidden="true" />
          Download CSV template
        </button>
      </div>
      <RecentImports ledgerId={w.ledgerId} />
    </>
  );
}
