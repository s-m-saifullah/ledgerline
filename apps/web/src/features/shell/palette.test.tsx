import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Plus, Settings } from "lucide-react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandPalette, type PaletteItem } from "./palette";

afterEach(cleanup);

function setup(items: PaletteItem[]) {
  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button
          id="open-navigation"
          type="button"
          onClick={() => setOpen(true)}
        >
          Jump to
        </button>
        <CommandPalette open={open} onOpenChange={setOpen} items={items} />
      </>
    );
  }
  return render(<Harness />);
}
const items = (run = vi.fn()): PaletteItem[] => [
  { key: "add", label: "Add transaction", icon: Plus, run },
  { key: "settings", label: "Settings", icon: Settings, run },
  { key: "off", label: "Archive everything", icon: Plus, run, disabled: true },
];

describe("CommandPalette", () => {
  it("is a dialog named Go to, with a search box that has the focus and no visible paragraph", async () => {
    setup(items());
    await userEvent.click(screen.getByRole("button", { name: "Jump to" }));
    const dialog = screen.getByRole("dialog", { name: "Go to" });
    await waitFor(() =>
      expect(screen.getByLabelText("Search pages and actions")).toHaveFocus(),
    );
    expect(dialog).toHaveAccessibleDescription(
      "Type to find a page or action.",
    );
    expect(screen.getByText("Type to find a page or action.")).toHaveClass(
      "sr-only",
    );
    expect(screen.queryByRole("button", { name: /close/i })).toBeNull();
  });

  it("filters the list as you type and says when nothing matches", async () => {
    setup(items());
    await userEvent.click(screen.getByRole("button", { name: "Jump to" }));
    await userEvent.type(
      screen.getByLabelText("Search pages and actions"),
      "sett",
    );
    const results = screen.getByRole("group", { name: "Results" });
    expect(results.querySelectorAll("button")).toHaveLength(1);
    await userEvent.type(
      screen.getByLabelText("Search pages and actions"),
      "zzz",
    );
    expect(screen.getByRole("status")).toHaveTextContent("Nothing matches");
  });

  it("Enter runs the first match, and a disabled item is skipped", async () => {
    const run = vi.fn();
    setup(items(run));
    await userEvent.click(screen.getByRole("button", { name: "Jump to" }));
    await userEvent.type(
      screen.getByLabelText("Search pages and actions"),
      "archive{Enter}",
    );
    expect(run).not.toHaveBeenCalled();
    await userEvent.clear(screen.getByLabelText("Search pages and actions"));
    await userEvent.type(
      screen.getByLabelText("Search pages and actions"),
      "{Enter}",
    );
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("arrow keys move between the search box and the results", async () => {
    setup(items());
    await userEvent.click(screen.getByRole("button", { name: "Jump to" }));
    await userEvent.keyboard("{ArrowDown}");
    expect(
      screen.getByRole("button", { name: "Add transaction" }),
    ).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getByRole("button", { name: "Settings" })).toHaveFocus();
    await userEvent.keyboard("{ArrowUp}{ArrowUp}");
    expect(screen.getByLabelText("Search pages and actions")).toHaveFocus();
  });

  it("gives focus back to what opened it when it closes", async () => {
    setup(items());
    await userEvent.click(screen.getByRole("button", { name: "Jump to" }));
    await userEvent.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Jump to" })).toHaveFocus(),
    );
  });

  it("leaves focus alone when the caller handles it", async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button
            id="open-navigation"
            type="button"
            onClick={() => setOpen(true)}
          >
            Jump to
          </button>
          <button type="button" id="elsewhere">
            Elsewhere
          </button>
          <CommandPalette
            open={open}
            onOpenChange={setOpen}
            items={items()}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              document.getElementById("elsewhere")?.focus();
            }}
          />
        </>
      );
    }
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Jump to" }));
    await userEvent.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Elsewhere" })).toHaveFocus(),
    );
  });
});
