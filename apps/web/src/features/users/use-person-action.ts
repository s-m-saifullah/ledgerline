import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError } from "../../lib/api";
import { usersKey } from "./api";

/**
 * Runs one change to a person for a sheet: busy while it goes, the server's own words when it refuses, a calm
 * "couldn't confirm" when the answer is lost (the change may have gone through, so never "it failed"), and `notFound`
 * (with the lists read again) when the person is no longer there.
 */
export function usePersonAction(
  notFound: string,
  onSaved: (notice: string) => void,
) {
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async (action: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (problem) {
      if (problem instanceof ApiError && problem.status === 404) {
        setError(notFound);
        void client.invalidateQueries({ queryKey: usersKey });
      } else if (problem instanceof ApiError && problem.status < 500) {
        setError(problem.message);
      } else {
        setError("We couldn't confirm that. Please try again.");
      }
      setBusy(false);
      return;
    }
    setBusy(false);
    onSaved(done);
  };
  return { busy, error, setError, run };
}
