import type { ChangeMarker } from "@ledgerline/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { api } from "./api";

/** How often an open, visible page asks whether anything changed (ADR 0044). */
export const liveChangesInterval = 15_000;

/** Queries the change marker itself and the session are never reloaded by it. */
const notReloaded = new Set(["changes", "session"]);

export type SyncState = "synced" | "updating" | "offline";
/** Offline wins over updating, which wins over synced: a reload that cannot finish is not "updating". */
export function syncState({
  online,
  checkFailed,
  reloading,
}: {
  online: boolean;
  checkFailed: boolean;
  reloading: boolean;
}): SyncState {
  if (!online || checkFailed) return "offline";
  return reloading ? "updating" : "synced";
}

const subscribeOnline = (callback: () => void) => {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
};
const useOnline = () =>
  useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );

function useVisible() {
  const [visible, setVisible] = useState(
    () => document.visibilityState === "visible",
  );
  useEffect(() => {
    const update = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return visible;
}

/** A dialog is open: a reload could change what it shows under the owner's hands, so it waits. */
const dialogOpen = () =>
  document.querySelector(
    '[role="dialog"], [role="alertdialog"], dialog[open]',
  ) !== null;

/**
 * Keeps an open page up to date with changes made elsewhere (the Android app, another browser, a background job):
 * while the page is visible it asks for the ledger's change marker every 15 seconds and, when the marker moves,
 * reloads the data on screen. Nothing is reloaded while a dialog is open; that waits for the next check after it
 * closes. A failed check is tried again at the next one. It returns the state for the top bar's status line:
 * synced, updating while a reload runs, or offline when the browser is or a check failed.
 */
export function useLiveChanges(ledgerId: string | undefined): SyncState {
  const client = useQueryClient();
  const visible = useVisible();
  const online = useOnline();
  const [reloading, setReloading] = useState(false);
  const seen = useRef<string | null>(null);
  const changes = useQuery({
    queryKey: ["changes", ledgerId],
    queryFn: () => api<ChangeMarker>(`/ledgers/${ledgerId}/changes`),
    enabled: !!ledgerId && visible,
    refetchInterval: liveChangesInterval,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 0,
    retry: false,
  });
  const marker = changes.data?.marker;
  const checkedAt = changes.dataUpdatedAt;
  useEffect(() => {
    if (!marker || checkedAt === 0) return;
    if (seen.current === null) {
      seen.current = marker;
      return;
    }
    if (marker === seen.current || dialogOpen()) return;
    seen.current = marker;
    setReloading(true);
    void client
      .invalidateQueries({
        predicate: (query) => !notReloaded.has(String(query.queryKey[0])),
      })
      .finally(() => setReloading(false));
  }, [client, marker, checkedAt]);
  return syncState({ online, checkFailed: changes.isError, reloading });
}
