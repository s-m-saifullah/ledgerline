import { Link } from "@tanstack/react-router";
import { Download } from "lucide-react";
import { saveTemplate } from "./template";

/** The Import button with its template download beside it, wherever importing is offered. */
export function ImportLinks({ primary = false }: { primary?: boolean }) {
  return (
    <div className="import-links">
      <Link
        to="/import"
        className={`${primary ? "button" : "secondary-button"} import-link-button`}
      >
        Import from CSV
      </Link>
      <button type="button" className="text-button" onClick={saveTemplate}>
        <Download size={16} aria-hidden="true" />
        Download CSV template
      </button>
    </div>
  );
}
