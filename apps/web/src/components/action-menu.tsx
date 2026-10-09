import * as Menu from "@radix-ui/react-dropdown-menu";
import { EllipsisVertical } from "lucide-react";
import type { BarAction } from "./action-bar";

/** One "more" button that opens every action in a menu; Delete-style actions stay red (ADR 0014). */
export function ActionMenu({
  label,
  actions,
  id,
  disabled = false,
}: {
  label: string;
  actions: BarAction[];
  id?: string;
  disabled?: boolean;
}) {
  return (
    <Menu.Root>
      <Menu.Trigger
        id={id}
        className="icon-button"
        aria-label={label}
        title={label}
        disabled={disabled}
      >
        <EllipsisVertical size={18} aria-hidden="true" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content className="action-menu" align="end" sideOffset={6}>
          {actions.map((action) => {
            const Icon = action.icon;
            return (
              <Menu.Item
                key={action.key}
                className={
                  action.danger
                    ? "action-menu-item danger-action"
                    : "action-menu-item"
                }
                disabled={action.disabled ?? false}
                onSelect={action.onSelect}
              >
                <Icon size={18} aria-hidden="true" />
                {action.label}
              </Menu.Item>
            );
          })}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
