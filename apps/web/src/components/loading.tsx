import type { ReactNode } from "react";

/** The one way a screen says it is loading: "Loading tags…", a polite status. A skeleton may follow as `children`. */
export function Loading({
  what,
  children,
}: {
  what: string;
  children?: ReactNode;
}) {
  return (
    <div role="status" aria-live="polite">
      <p className="muted">Loading {what}…</p>
      {children}
    </div>
  );
}
