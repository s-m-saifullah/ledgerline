import type { SyncState } from "../../lib/use-live-changes";

const words: Record<SyncState, string> = {
  synced: "Synced",
  updating: "Updating",
  offline: "Offline",
};

/** The live-updates state (ADR 0044) in one word, with a dot. A live region, not role="status": pages use that role for their own notices. */
export function SyncStatus({ state }: { state: SyncState }) {
  return (
    <p className="ui-sync" aria-live="polite" data-state={state}>
      <span className="ui-sync-dot" aria-hidden="true" />
      {words[state]}
    </p>
  );
}
