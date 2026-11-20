import { EmptyState } from "@ledgerline/ui";
import { Link } from "@tanstack/react-router";

/** What a page that does not exist shows: its title, one short line and the way home. */
export function NotFoundPage() {
  // One root, like every page: the frame is a grid, and two roots would be spaced by its gap.
  return (
    <div className="ui-stack">
      <h1>Page not found</h1>
      <div className="ui-card">
        <EmptyState text="This page does not exist." />
      </div>
      <Link to="/" className="ui-btn ui-btn-primary">
        Go to Home
      </Link>
    </div>
  );
}
