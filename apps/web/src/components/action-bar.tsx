import * as Menu from "@radix-ui/react-dropdown-menu";
import { EllipsisVertical, type LucideIcon } from "lucide-react";
import { useSyncExternalStore } from "react";

export type BarAction = {
  key: string;
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  disabled?: boolean;
  id?: string;
  danger?: boolean;
  /** Shorter visible text on phones; the full label stays the accessible name. */
  shortLabel?: string;
};

const query = "(max-width: 700px)";
function subscribe(callback: () => void) {
  const list = window.matchMedia?.(query);
  list?.addEventListener("change", callback);
  return () => list?.removeEventListener("change", callback);
}
/** True on phone-width screens, where secondary actions move into a menu. */
export function useIsPhone() {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia?.(query).matches ?? false,
    () => false,
  );
}

/**
 * One primary action fills the row. Other actions are inline buttons on wide
 * screens and sit in a "more" menu on phones. `extra` (a toggle such as Show
 * payments) stays visible next to the menu.
 */
export function ActionBar({
  primary,
  actions,
  featured,
  extra,
  menuLabel,
}: {
  primary?: BarAction | undefined;
  featured?: BarAction | undefined;
  actions: BarAction[];
  extra?: BarAction | undefined;
  menuLabel: string;
}) {
  const phone = useIsPhone();
  const PrimaryIcon = primary?.icon;
  const button = (
    action: BarAction,
    className: string,
    text: boolean,
    short = false,
  ) => {
    const Icon = action.icon;
    return (
      <button
        key={action.key}
        id={action.id}
        type="button"
        className={action.danger ? `${className} danger-action` : className}
        disabled={action.disabled}
        title={action.label}
        aria-label={
          text && !(short && action.shortLabel) ? undefined : action.label
        }
        onClick={action.onSelect}
      >
        <Icon size={18} aria-hidden="true" />
        {text && (
          <span>
            {short && action.shortLabel ? action.shortLabel : action.label}
          </span>
        )}
      </button>
    );
  };
  return (
    <div
      className={featured && phone ? "action-bar has-featured" : "action-bar"}
    >
      {primary &&
        PrimaryIcon &&
        button(primary, "button action-primary action-btn", true, phone)}
      {phone ? (
        <>
          {featured &&
            button(
              featured,
              "secondary-button action-featured action-btn",
              true,
            )}
          {extra &&
            button(extra, "secondary-button action-square action-btn", false)}
          {actions.length > 0 && (
            <Menu.Root>
              <Menu.Trigger
                className="secondary-button action-square action-btn"
                aria-label={menuLabel}
                title={menuLabel}
              >
                <EllipsisVertical size={18} aria-hidden="true" />
              </Menu.Trigger>
              <Menu.Portal>
                <Menu.Content
                  className="action-menu"
                  align="end"
                  sideOffset={6}
                >
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
          )}
        </>
      ) : (
        <>
          {featured &&
            button(featured, "secondary-button action-inline action-btn", true)}
          {actions.map((action) =>
            button(action, "secondary-button action-inline action-btn", true),
          )}
          {extra &&
            button(extra, "secondary-button action-inline action-btn", true)}
        </>
      )}
    </div>
  );
}
