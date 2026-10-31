import { RowBody, SectionLabel } from "@ledgerline/ui";
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
    <section className="imp-section" aria-labelledby="recent-imports-title">
      <SectionLabel as="h2" id="recent-imports-title">
        Recent imports
      </SectionLabel>
      {notice && (
        <p role="status" className="imp-note">
          {notice}
        </p>
      )}
      <ul className="ui-card ui-list imp-list">
        {(imports.data ?? []).map((batch) => (
          <li key={batch.id} className="ui-row ui-row-static imp-recent-row">
            <RowBody
              title={batch.sourceName ?? "Imported file"}
              hint={`${new Date(batch.createdAt).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              })} · ${batch.remaining} of ${batch.rowCount} ${
                batch.rowCount === 1 ? "entry" : "entries"
              } left`}
            />
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
