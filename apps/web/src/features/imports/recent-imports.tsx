import { RowBody, SectionLabel } from "@ledgerline/ui";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { queryKeys } from "../../lib/query-keys";
import { formatDay } from "../../lib/time";
import { getImports } from "./api";
import { UndoQuestion } from "./undo-import";

/** The latest imports, each row opening the question that undoes it, so a mistake can be taken back later too. */
export function RecentImports({ ledgerId }: { ledgerId: string | undefined }) {
  const [notice, setNotice] = useState("");
  const [asking, setAsking] = useState<string | null>(null);
  const imports = useQuery({
    queryKey: queryKeys.imports(ledgerId),
    queryFn: ({ signal }) => getImports(ledgerId as string, signal),
    enabled: !!ledgerId,
    staleTime: 0,
  });
  if (!ledgerId || (!imports.data?.length && !notice)) return null;
  return (
    <section className="imp-section" aria-labelledby="recent-imports-title">
      <SectionLabel as="h2" id="recent-imports-title">
        Recent imports
      </SectionLabel>
      {notice && (
        <p role="status" className="imp-note">
          {notice}
        </p>
      )}
      <div className="ui-card ui-list">
        {(imports.data ?? []).map((batch) => (
          <div key={batch.id} className="imp-recent">
            <button
              id={`undo-import-${batch.id}`}
              type="button"
              className="ui-row ui-row-press"
              disabled={batch.remaining === 0}
              onClick={() => setAsking(batch.id)}
            >
              <RowBody
                title={batch.sourceName ?? "Imported file"}
                hint={`${formatDay(batch.createdAt)} · ${batch.remaining} of ${batch.rowCount} ${
                  batch.rowCount === 1 ? "transaction" : "transactions"
                } still in your ledger`}
                value={
                  batch.remaining === 0 ? undefined : (
                    <span className="imp-undo">Undo</span>
                  )
                }
              />
            </button>
            <UndoQuestion
              ledgerId={ledgerId}
              batch={batch}
              open={asking === batch.id}
              returnFocusId={`undo-import-${batch.id}`}
              onClose={() => setAsking(null)}
              onUndone={(removed) =>
                setNotice(
                  `Deleted ${removed} ${removed === 1 ? "transaction" : "transactions"} from ${batch.sourceName ?? "the import"}.`,
                )
              }
            />
          </div>
        ))}
      </div>
    </section>
  );
}
