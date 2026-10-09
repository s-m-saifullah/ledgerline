import type { LucideIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

/**
 * Primary actions keep their text. Secondary actions show icon + text on wide
 * screens and shrink to a 44 px icon on phones; the text stays in the DOM for
 * assistive technology and appears as a hover/long-press hint.
 */
export function ActionButton({
  icon: Icon,
  variant,
  danger = false,
  children,
  ...props
}: {
  icon: LucideIcon;
  variant: "primary" | "secondary";
  danger?: boolean;
  children: ReactNode;
} & Omit<ComponentProps<"button">, "type" | "className" | "children">) {
  return (
    <button
      type="button"
      className={`${variant === "primary" ? "button" : "secondary-button action-icon"}${danger ? " danger-action" : ""} action-button`}
      title={typeof children === "string" ? children : undefined}
      {...props}
    >
      <Icon size={18} aria-hidden="true" />
      <span className="action-label">{children}</span>
    </button>
  );
}
