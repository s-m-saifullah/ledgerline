import { Link } from "@tanstack/react-router";

/** The link back to the More page, at the top of every page reached from it. */
export function BackToMore() {
  return (
    <Link to="/more" className="accounts-back">
      ← More
    </Link>
  );
}
