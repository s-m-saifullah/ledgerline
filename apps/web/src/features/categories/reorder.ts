import type { Category, ReorderCategories } from "@ledgerline/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { ApiError } from "../../lib/api";
import { getCategories, prepareCategoryReorder } from "./api";

/** Each click is one intent. An interrupted response retains its key and body. */
export function useCategoryReorder(ledgerId: string) {
  const client = useQueryClient();
  const [state, setState] = useState<
    "idle" | "saving" | "uncertain" | "conflict"
  >("idle");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const attempt = useRef<ReturnType<typeof prepareCategoryReorder> | null>(
    null,
  );
  const inFlight = useRef(false);
  const queryKey = ["categories", ledgerId];

  const save = async (body?: ReorderCategories) => {
    if (inFlight.current || state === "conflict") return;
    // A fresh click must not replace an unconfirmed move.
    if (body && attempt.current) return;
    if (body) attempt.current = prepareCategoryReorder(ledgerId, body);
    const run = attempt.current;
    if (!run) return;
    inFlight.current = true;
    setState("saving");
    setError("");
    setNotice("");
    try {
      // Prevent a pre-save list response from replacing the returned versions.
      await client.cancelQueries({ queryKey });
      const saved = await run();
      const updated = new Map(saved.items.map((item) => [item.id, item]));
      client.setQueryData<Category[]>(queryKey, (items = []) =>
        items.map((item) => updated.get(item.id) ?? item),
      );
      await client.invalidateQueries({ queryKey });
      attempt.current = null;
      setState("idle");
      setNotice("Category order updated.");
    } catch (failure) {
      if (!(failure instanceof ApiError) || failure.status >= 500) {
        setState("uncertain");
        setError(
          "Couldn't confirm the order. Retry to confirm the same move before making another change.",
        );
      } else {
        attempt.current = null;
        setState(failure.status === 409 ? "conflict" : "idle");
        setError(
          failure.status === 409
            ? "These categories changed. Reload categories before moving them again."
            : failure.message,
        );
      }
    } finally {
      inFlight.current = false;
    }
  };
  const reload = async () => {
    if (inFlight.current || state !== "conflict") return;
    inFlight.current = true;
    setState("saving");
    try {
      await client.cancelQueries({ queryKey });
      await client.fetchQuery({
        queryKey,
        queryFn: ({ signal }) => getCategories(ledgerId, signal),
        staleTime: 0,
      });
      setState("idle");
      setError("");
      setNotice("Categories reloaded. Choose your move again.");
    } catch {
      setState("conflict");
      setError("Couldn't reload your categories. Please try again.");
    } finally {
      inFlight.current = false;
    }
  };
  return { state, error, notice, locked: state !== "idle", save, reload };
}
