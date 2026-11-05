import { IconTile, ListCard, ListRow } from "@ledgerline/ui";
import { Copy, RefreshCw } from "lucide-react";
import { useState } from "react";

/**
 * The temporary password, as the prototype's `pwBox` draws it: the password in a plain row, then Copy and
 * "Make a new one". The page that owns the sheet makes the password and keeps it only in that sheet's state.
 */
export function PasswordBox({
  password,
  disabled,
  onNew,
}: {
  password: string;
  disabled: boolean;
  onNew: () => void;
}) {
  const [copy, setCopy] = useState<"idle" | "done" | "failed">("idle");
  const copyIt = async () => {
    try {
      await navigator.clipboard.writeText(password);
      setCopy("done");
    } catch {
      setCopy("failed");
    }
  };
  return (
    <>
      <ListCard>
        <div className="ui-row ui-row-static">
          <span className="ui-row-main">
            <span
              className="ui-row-title us-password"
              data-testid="temporary-password"
              data-secret=""
            >
              {password}
            </span>
          </span>
        </div>
        <ListRow
          lead={
            <IconTile>
              <Copy size={18} />
            </IconTile>
          }
          title="Copy"
          {...(copy === "done" ? { value: "Copied" } : {})}
          disabled={disabled}
          onClick={() => void copyIt()}
        />
        <ListRow
          lead={
            <IconTile>
              <RefreshCw size={18} />
            </IconTile>
          }
          title="Make a new one"
          disabled={disabled}
          onClick={() => {
            setCopy("idle");
            onNew();
          }}
        />
      </ListCard>
      {copy === "failed" && (
        <p role="alert" className="field-error">
          Couldn't copy. Select the password and copy it yourself.
        </p>
      )}
    </>
  );
}
