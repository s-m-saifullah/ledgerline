import { NativeSelect } from "../../components/native-select";
import { RecentImports } from "./recent-imports";
import { saveTemplate } from "./template";
import type { Wizard } from "./wizard";

export function FileStep({ w }: { w: Wizard }) {
  return (
    <>
      <section className="settings-card" aria-labelledby="import-file-title">
        <h2 id="import-file-title">Choose a file</h2>
        <p className="muted">
          The file is read in your browser. It is never sent to the server or
          stored; only the rows you approve are saved.
        </p>
        <div className="import-fields">
          <div>
            <label htmlFor="import-account">Import into</label>
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
          <div>
            <label htmlFor="import-file">CSV file</label>
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
        </div>
        {w.fileError && (
          <p role="alert" className="field-error">
            {w.fileError}
          </p>
        )}
        <div className="import-template">
          <button type="button" className="quiet-button" onClick={saveTemplate}>
            Download CSV template
          </button>
          <p className="muted import-note">
            Not sure how to lay out your file? Download the template, fill it
            in, then choose it above.
          </p>
        </div>
      </section>
      <RecentImports ledgerId={w.ledgerId} />
    </>
  );
}
