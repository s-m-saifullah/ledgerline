import type { ChangeMarker } from "@ledgerline/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api } from "./api";

/** How often an open, visible page asks whether anything changed (ADR 0044). */
export const liveChangesInterval = 15_000;

/** Queries the change marker itself and the session are never reloaded by it. */
const notReloaded = new Set(["changes", "session"]);

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
 * closes. A failed check is ignored and tried again at the next one.
 */
export function useLiveChanges(ledgerId: string | undefined) {
  const client = useQueryClient();
  const visible = useVisible();
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
    void client.invalidateQueries({
      predicate: (query) => !notReloaded.has(String(query.queryKey[0])),
    });
  }, [client, marker, checkedAt]);
}
