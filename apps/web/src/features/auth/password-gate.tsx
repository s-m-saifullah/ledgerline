import type { Me } from "@ledgerline/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { type ReactNode, useEffect, useRef } from "react";
import { onPasswordChangeRequired } from "../../lib/api";
import { getMe, meKey } from "../profile/api";
import { FirstSignIn } from "./first-sign-in";

/**
 * Around the signed-in app (ADR 0048). A person on a temporary password sees the first-sign-in card instead of the
 * shell: `GET /me` says so, and so does any request the server refuses with the password-change-required problem.
 * If `/me` cannot be read the app opens as it always did: the server refuses what it must either way.
 */
export function PasswordGate({
  onSignOut,
  children,
}: {
  onSignOut: () => Promise<void>;
  children: ReactNode;
}) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const me = useQuery({ queryKey: meKey, queryFn: getMe });
  // Only the first answer is waited for. A failed query that is asked again goes back to "pending", and swapping the
  // app for the loading text each time would mount it again, ask again, and so on without end.
  const answered = useRef(false);
  if (!me.isPending) answered.current = true;
  // The server's refusal is the truth even when `/me` said otherwise a moment ago.
  useEffect(
    () =>
      onPasswordChangeRequired(() =>
        client.setQueryData<Me>(meKey, (old) =>
          old ? { ...old, mustChangePassword: true } : old,
        ),
      ),
    [client],
  );
  if (me.isPending && !answered.current)
    return (
      <main className="loading" role="status">
        Opening your ledger…
      </main>
    );
  if (me.data?.mustChangePassword)
    return (
      <FirstSignIn
        onSignOut={onSignOut}
        onSaved={async () => {
          await client.invalidateQueries({ queryKey: meKey });
          await navigate({ to: "/" });
        }}
      />
    );
  return children;
}
