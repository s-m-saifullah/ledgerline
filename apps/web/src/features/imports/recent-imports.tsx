import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { getImports } from "./api";
import { UndoImport } from "./undo-import";

/** The latest imports, each with an Undo, so a mistake can be taken back later too. */
export function RecentImports({ ledgerId }: { ledgerId: string | undefined }) {
  const [notice, setNotice] = useState("");
  const imports = useQuery({
    queryKey: ["imports", ledgerId],
    queryFn: ({ signal }) => getImports(ledgerId as string, signal),
    enabled: !!ledgerId,
    staleTime: 0,
  });
  if (!ledgerId || (!imports.data?.length && !notice)) return null;
  return (
    <section className="settings-card" aria-labelledby="recent-imports-title">
      <h2 id="recent-imports-title">Recent imports</h2>
      {notice && (
        <p role="status" className="muted">
          {notice}
        </p>
      )}
      <ul className="import-recent">
        {(imports.data ?? []).map((batch) => (
          <li key={batch.id}>
            <div>
              <strong>{batch.sourceName ?? "Imported file"}</strong>
              <p className="muted import-note">
                {new Date(batch.createdAt).toLocaleDateString("en-US", {
                  dateStyle: "medium",
                })}{" "}
                · {batch.remaining} of {batch.rowCount}{" "}
                {batch.rowCount === 1 ? "entry" : "entries"} still in your
                ledger
              </p>
            </div>
            <UndoImport
              ledgerId={ledgerId}
              batch={batch}
              onUndone={(removed) =>
                setNotice(
                  `Removed ${removed} ${removed === 1 ? "entry" : "entries"} from ${batch.sourceName ?? "the import"}.`,
                )
              }
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
