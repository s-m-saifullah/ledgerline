import { cn } from "@ledgerline/ui";

/**
 * A row that is only an action, as the prototype draws Settings' "Make new backup codes" and "Turn off two-factor":
 * a title, no hint, and red when it undoes something (ADR 0047). The whole row is the button.
 */
export function ActionRow({
  id,
  title,
  tone,
  disabled,
  onClick,
}: {
  id?: string;
  title: string;
  tone?: "accent" | "danger";
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      id={id}
      disabled={disabled}
      className="ui-row ui-row-press"
      onClick={onClick}
    >
      <span className="ui-row-main">
        <span className={cn("ui-row-title", tone && `set-${tone}`)}>
          {title}
        </span>
      </span>
    </button>
  );
}
