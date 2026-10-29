import * as Dialog from "@radix-ui/react-dialog";
import { ArrowUpRight, Command, type LucideIcon } from "lucide-react";
import { useRef, useState } from "react";
import "./palette.css";

/**
 * The command palette ("Go to"): a search box over the pages and actions, opened from the sidebar's jump-to
 * button or Cmd/Ctrl+K. A phone has no button for it (it is a hardware-keyboard feature). It is a dialog
 * with the same role and names as before; the description is read aloud only.
 */
export function CommandPalette({
  open,
  onOpenChange,
  items,
  onCloseAutoFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: PaletteItem[];
  onCloseAutoFocus?: (event: Event) => void;
}) {
  // Radix only gives focus back to a Dialog.Trigger, and this dialog has none (it opens from a button, a key
  // or an action), so it remembers what had focus and returns there.
  const opener = useRef<HTMLElement | null>(null);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="ui-scrim" />
        <Dialog.Content
          className="ui-palette"
          onOpenAutoFocus={() => {
            opener.current =
              document.activeElement instanceof HTMLElement
                ? document.activeElement
                : null;
          }}
          onCloseAutoFocus={(event) => {
            onCloseAutoFocus?.(event);
            if (event.defaultPrevented) return;
            event.preventDefault();
            const target = [
              opener.current,
              document.getElementById("open-navigation"),
            ].find((element) => element?.isConnected);
            target?.focus();
          }}
        >
          <Dialog.Title className="sr-only">
            <Command size={20} aria-hidden="true" />
            Go to
          </Dialog.Title>
          <Dialog.Description className="sr-only">
            Type to find a page or action.
          </Dialog.Description>
          <PaletteList items={items} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export type PaletteItem = {
  key: string;
  label: string;
  icon: LucideIcon;
  disabled?: boolean;
  run: () => void;
};
/** Search box plus filtered actions; arrows move between them and Enter runs the first match. */
function PaletteList({ items }: { items: PaletteItem[] }) {
  const [query, setQuery] = useState("");
  const list = useRef<HTMLFieldSetElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const shown = items.filter((item) =>
    item.label.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const options = () =>
    Array.from(
      list.current?.querySelectorAll<HTMLButtonElement>(
        "button:not(:disabled)",
      ) ?? [],
    );
  return (
    <>
      <input
        ref={search}
        type="search"
        className="ui-palette-search"
        aria-label="Search pages and actions"
        placeholder="Search pages and actions"
        autoComplete="off"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            options()[0]?.focus();
          } else if (event.key === "Enter") {
            event.preventDefault();
            options()[0]?.click();
          }
        }}
      />
      <div className="ui-palette-scroll">
        <fieldset
          ref={list}
          className="ui-palette-results"
          onKeyDown={(event) => {
            if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
            event.preventDefault();
            const all = options();
            const index = all.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            const next = index + (event.key === "ArrowDown" ? 1 : -1);
            if (next < 0) search.current?.focus();
            else all[Math.min(next, all.length - 1)]?.focus();
          }}
        >
          <legend className="sr-only">Results</legend>
          {shown.map(({ key, label, icon: Icon, disabled, run }) => (
            <button
              key={key}
              type="button"
              className="ui-palette-option"
              disabled={disabled ?? false}
              onClick={run}
            >
              <Icon size={18} aria-hidden="true" />
              {label}
              <ArrowUpRight size={16} aria-hidden="true" />
            </button>
          ))}
          {shown.length === 0 && (
            <p className="muted" role="status">
              Nothing matches “{query.trim()}”.
            </p>
          )}
        </fieldset>
      </div>
    </>
  );
}
