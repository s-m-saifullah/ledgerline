import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Overlay } from "./overlay";

afterEach(cleanup);

const base = {
  open: true,
  title: "Add account",
  busy: false,
  onDismiss: () => {},
  returnFocusId: "opener",
  fallbackFocusId: "fallback",
};

describe("Overlay as a sheet", () => {
  it("is a dialog named by its title, with the content in a scrolling body", () => {
    render(
      <Overlay {...base}>
        <p>Name field</p>
      </Overlay>,
    );
    const dialog = screen.getByRole("dialog", { name: "Add account" });
    expect(dialog).toHaveClass("ui-sheet");
    expect(screen.getByText("Name field").closest(".ui-sheet-body")).not.toBe(
      null,
    );
  });

  it("pins the primary button in a footer outside the scrolling body", () => {
    render(
      <Overlay {...base} footer={<button type="button">Save</button>}>
        <p>Name field</p>
      </Overlay>,
    );
    const save = screen.getByRole("button", { name: "Save" });
    expect(save.closest(".ui-sheet-foot")).not.toBe(null);
    expect(save.closest(".ui-sheet-body")).toBe(null);
  });

  it("adds no page landmark: a sheet's head and foot are not a second banner and footer", () => {
    render(
      <Overlay {...base} footer={<button type="button">Save</button>}>
        <p>Name field</p>
      </Overlay>,
    );
    const dialog = screen.getByRole("dialog", { name: "Add account" });
    expect(dialog.querySelector("header, footer")).toBeNull();
  });

  it("draws no footer when there is no primary button", () => {
    render(<Overlay {...base}>content</Overlay>);
    expect(document.querySelector(".ui-sheet-foot")).toBeNull();
  });

  it("has one Cancel, and it dismisses", async () => {
    const onDismiss = vi.fn();
    render(<Overlay {...base} onDismiss={onDismiss} />);
    expect(screen.getAllByRole("button", { name: "Cancel" })).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("can name Cancel something else", () => {
    render(<Overlay {...base} cancelLabel="Close" />);
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });

  it("shows an optional action in the header", () => {
    render(<Overlay {...base} action={<button type="button">Reset</button>} />);
    expect(
      screen.getByRole("button", { name: "Reset" }).closest(".ui-sheet-head"),
    ).not.toBe(null);
  });

  it("is wider for a wide form", () => {
    const { rerender } = render(<Overlay {...base} />);
    expect(screen.getByRole("dialog")).not.toHaveClass("ui-sheet-wide");
    rerender(<Overlay {...base} size="wide" />);
    expect(screen.getByRole("dialog")).toHaveClass("ui-sheet-wide");
  });

  it("renders nothing while closed", () => {
    render(<Overlay {...base} open={false} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps its description for screen readers only, never as a visible paragraph", () => {
    render(<Overlay {...base} description="Add a bank account." />);
    expect(screen.getByRole("dialog")).toHaveAccessibleDescription(
      "Add a bank account.",
    );
    expect(screen.getByText("Add a bank account.")).toHaveClass("sr-only");
  });

  it("does not make Radix warn when there is no description", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(<Overlay {...base} />);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("Overlay dismissing", () => {
  it("closes on Escape", async () => {
    const onDismiss = vi.fn();
    render(<Overlay {...base} onDismiss={onDismiss} />);
    await userEvent.keyboard("{Escape}");
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("closes on a click outside", async () => {
    const onDismiss = vi.fn();
    render(<Overlay {...base} onDismiss={onDismiss} />);
    await userEvent.click(document.querySelector(".ui-scrim") as Element);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("while busy, neither Escape nor a click outside nor Cancel dismisses", async () => {
    const onDismiss = vi.fn();
    render(<Overlay {...base} busy onDismiss={onDismiss} />);
    await userEvent.keyboard("{Escape}");
    await userEvent.click(document.querySelector(".ui-scrim") as Element);
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(onDismiss).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("when it cannot be dismissed it has no Cancel, and neither Escape nor a click outside closes it", async () => {
    const onDismiss = vi.fn();
    render(<Overlay {...base} dismissible={false} onDismiss={onDismiss} />);
    await userEvent.keyboard("{Escape}");
    await userEvent.click(document.querySelector(".ui-scrim") as Element);
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    expect(onDismiss).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("Escape closes an open list inside it first, not the dialog", async () => {
    const onDismiss = vi.fn();
    render(
      <Overlay {...base} onDismiss={onDismiss}>
        <input role="combobox" aria-expanded="true" aria-label="Category" />
      </Overlay>,
    );
    screen.getByRole("combobox").focus();
    await userEvent.keyboard("{Escape}");
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("Escape in a dialog opened from inside it closes only that one", async () => {
    const onDismiss = vi.fn();
    render(
      <Overlay {...base} onDismiss={onDismiss}>
        <div role="dialog" aria-label="Pick a date">
          <button type="button">Today</button>
        </div>
      </Overlay>,
    );
    screen.getByRole("button", { name: "Today" }).focus();
    await userEvent.keyboard("{Escape}");
    expect(onDismiss).not.toHaveBeenCalled();
  });

  // Radix keeps its own order of open layers, and it can put the outer one on top (here both open in the same
  // render, so the inner one registers first). The key is still aimed at the inner dialog, so that one must close.
  it("Escape in an overlay opened from inside another closes the inner one, whichever layer Radix thinks is on top", async () => {
    const outer = vi.fn();
    const inner = vi.fn();
    render(
      <Overlay {...base} title="Edit entry" onDismiss={outer}>
        <Overlay
          {...base}
          title="Pick a date"
          onDismiss={inner}
          initialFocusId="inner-field"
        >
          <input id="inner-field" aria-label="Day" />
        </Overlay>
      </Overlay>,
    );
    expect(screen.getByLabelText("Day")).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
  });

  it("while busy, Escape in an inner overlay dismisses neither", async () => {
    const outer = vi.fn();
    const inner = vi.fn();
    render(
      <Overlay {...base} title="Edit entry" onDismiss={outer}>
        <Overlay
          {...base}
          busy
          title="Pick a date"
          onDismiss={inner}
          initialFocusId="inner-field"
        >
          <input id="inner-field" aria-label="Day" />
        </Overlay>
      </Overlay>,
    );
    await userEvent.keyboard("{Escape}");
    expect(inner).not.toHaveBeenCalled();
    expect(outer).not.toHaveBeenCalled();
  });
});

function Harness({ initialFocusId }: { initialFocusId?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button id="opener" type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <button id="fallback" type="button">
        Fallback
      </button>
      <Overlay
        open={open}
        title="Add account"
        busy={false}
        onDismiss={() => setOpen(false)}
        returnFocusId="opener"
        fallbackFocusId="fallback"
        initialFocusId={initialFocusId}
      >
        <input id="first" aria-label="Name" />
      </Overlay>
    </>
  );
}

describe("Overlay focus", () => {
  it("starts on the field it is told to, and gives focus back to the opener on close", async () => {
    render(<Harness initialFocusId="first" />);
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    await waitFor(() => expect(screen.getByLabelText("Name")).toHaveFocus());
    await userEvent.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Open" })).toHaveFocus(),
    );
  });

  it("with no field named, a sheet starts on its first field, never on Cancel", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    await waitFor(() => expect(screen.getByLabelText("Name")).toHaveFocus());
  });

  it("a sheet with nothing to fill starts on its pinned button", async () => {
    render(
      <Overlay {...base} footer={<button type="button">Save</button>}>
        <p>Nothing to type.</p>
      </Overlay>,
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save" })).toHaveFocus(),
    );
  });

  it("a question starts on Cancel, the safe choice", async () => {
    render(
      <Overlay
        {...base}
        kind="question"
        title="Delete?"
        footer={<button type="button">Delete</button>}
      />,
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus(),
    );
  });

  it("gives focus to the fallback when the opener is gone", async () => {
    function Gone() {
      const [open, setOpen] = useState(false);
      const [openerShown, setOpenerShown] = useState(true);
      return (
        <>
          {openerShown && (
            <button type="button" onClick={() => setOpen(true)}>
              Open
            </button>
          )}
          <button id="fallback" type="button">
            Fallback
          </button>
          <Overlay
            open={open}
            title="Add account"
            busy={false}
            onDismiss={() => setOpen(false)}
            returnFocusId="missing"
            fallbackFocusId="fallback"
          >
            <button type="button" onClick={() => setOpenerShown(false)}>
              Remove opener
            </button>
          </Overlay>
        </>
      );
    }
    render(<Gone />);
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Remove opener" }),
    );
    await userEvent.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Fallback" })).toHaveFocus(),
    );
  });
});

describe("Overlay as a question", () => {
  it("is a centred dialog with Cancel beside the one confirming button, and no grab handle", async () => {
    const onDismiss = vi.fn();
    render(
      <Overlay
        {...base}
        kind="question"
        title="Delete this account?"
        onDismiss={onDismiss}
        footer={
          <button type="button" className="ui-btn ui-btn-danger-filled">
            Delete
          </button>
        }
      >
        <p>It can be restored.</p>
      </Overlay>,
    );
    const dialog = screen.getByRole("dialog", { name: "Delete this account?" });
    expect(dialog).toHaveClass("ui-question");
    expect(dialog).not.toHaveClass("ui-sheet");
    expect(dialog.querySelector(".ui-grab")).toBeNull();
    const actions = dialog.querySelector(".ui-question-actions");
    expect(actions).not.toBeNull();
    expect(actions).toContainElement(
      screen.getByRole("button", { name: "Cancel" }),
    );
    expect(actions).toContainElement(
      screen.getByRole("button", { name: "Delete" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("closes when the handle is tapped, and only then", async () => {
    const onDismiss = vi.fn();
    render(
      <Overlay {...base} onDismiss={onDismiss}>
        <p>Name field</p>
      </Overlay>,
    );
    const dialog = screen.getByRole("dialog", { name: "Add account" });
    await userEvent.click(screen.getByText("Name field"));
    await userEvent.click(dialog.querySelector(".ui-sheet-head") as Element);
    expect(onDismiss).not.toHaveBeenCalled();
    await userEvent.click(dialog.querySelector(".ui-grab") as Element);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("ignores the handle while a save is in flight, and where nobody may dismiss", async () => {
    const onDismiss = vi.fn();
    const { rerender } = render(
      <Overlay {...base} busy onDismiss={onDismiss}>
        <p>Name field</p>
      </Overlay>,
    );
    const handle = () =>
      screen.getByRole("dialog").querySelector(".ui-grab") as Element;
    await userEvent.click(handle());
    rerender(
      <Overlay {...base} dismissible={false} onDismiss={onDismiss}>
        <p>Name field</p>
      </Overlay>,
    );
    await userEvent.click(handle());
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("keeps the handle out of the accessibility tree: Cancel and Escape are the way out", () => {
    render(
      <Overlay {...base}>
        <p>Name field</p>
      </Overlay>,
    );
    const handle = screen
      .getByRole("dialog")
      .querySelector(".ui-grab") as HTMLElement;
    expect(handle).toHaveAttribute("aria-hidden", "true");
    expect(handle).not.toHaveAttribute("tabindex");
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });
});

describe("Overlay's dark overlay when the overlay goes away", () => {
  const ghosts = () =>
    document.querySelectorAll('.ui-scrim[data-state="closed"]');
  const panels = () =>
    document.querySelectorAll(".ui-sheet-out, .ui-question-out");
  beforeEach(() => {
    // A browser: it can tell whether less motion was asked for (jsdom has no matchMedia).
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: false })),
    );
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    // Copies left behind by a test are not the next test's.
    for (const left of document.querySelectorAll(
      ".ui-scrim, .ui-sheet-out, .ui-question-out",
    ))
      left.remove();
  });

  it("leaves a hidden, click-through copy behind that fades, when its parent stops drawing it while open", async () => {
    const view = render(<Overlay {...base}>content</Overlay>);
    expect(ghosts()).toHaveLength(0);
    view.unmount();
    await Promise.resolve();
    expect(ghosts()).toHaveLength(1);
    const ghost = ghosts()[0] as HTMLElement;
    expect(ghost).toHaveClass("ui-scrim");
    expect(ghost).toHaveAttribute("aria-hidden", "true");
    // No inline style: Radix's own `pointer-events: auto` would beat the CSS that lets taps through.
    expect(ghost).not.toHaveAttribute("style");
    expect(ghost.parentElement).toBe(document.body);
  });

  it("removes the copy when its fade ends", async () => {
    render(<Overlay {...base}>content</Overlay>).unmount();
    await Promise.resolve();
    fireEvent.animationEnd(ghosts()[0] as Element);
    expect(ghosts()).toHaveLength(0);
  });

  it("removes the copy after a short time even if the fade never reports its end", async () => {
    vi.useFakeTimers();
    render(<Overlay {...base}>content</Overlay>).unmount();
    await Promise.resolve();
    expect(ghosts()).toHaveLength(1);
    act(() => vi.advanceTimersByTime(399));
    expect(ghosts()).toHaveLength(1);
    act(() => vi.advanceTimersByTime(2));
    expect(ghosts()).toHaveLength(0);
  });

  it("does the same for a question", async () => {
    render(
      <Overlay {...base} kind="question" title="Delete it?">
        text
      </Overlay>,
    ).unmount();
    await Promise.resolve();
    expect(ghosts()).toHaveLength(1);
    expect(document.querySelectorAll(".ui-question-out")).toHaveLength(1);
    expect(document.querySelectorAll(".ui-sheet-out")).toHaveLength(0);
  });

  describe("closed in place (the page keeps it mounted)", () => {
    it("is gone at once and leaves a copy of the sheet to slide away, but none of the dark overlay (Radix fades that)", () => {
      const view = render(<Overlay {...base}>content</Overlay>);
      expect(panels()).toHaveLength(0);
      view.rerender(
        <Overlay {...base} open={false}>
          content
        </Overlay>,
      );
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(panels()).toHaveLength(1);
      expect(panels()[0]).toHaveClass("ui-sheet-out");
      expect(ghosts()).toHaveLength(0);
    });

    it("leaves a question's copy when a question closes in place", () => {
      const view = render(
        <Overlay {...base} kind="question" title="Delete it?">
          text
        </Overlay>,
      );
      view.rerender(
        <Overlay {...base} kind="question" title="Delete it?" open={false}>
          text
        </Overlay>,
      );
      expect(document.querySelectorAll(".ui-question-out")).toHaveLength(1);
    });

    it("leaves nothing more when it is later removed while closed", async () => {
      const view = render(<Overlay {...base}>content</Overlay>);
      view.rerender(
        <Overlay {...base} open={false}>
          content
        </Overlay>,
      );
      expect(panels()).toHaveLength(1);
      view.unmount();
      await Promise.resolve();
      expect(panels()).toHaveLength(1);
      expect(ghosts()).toHaveLength(0);
    });

    it("leaves a copy each time it is closed again", () => {
      const view = render(<Overlay {...base}>content</Overlay>);
      for (const index of [1, 2]) {
        view.rerender(
          <Overlay {...base} open={false}>
            content
          </Overlay>,
        );
        view.rerender(
          <Overlay {...base} open>
            content
          </Overlay>,
        );
        view.rerender(
          <Overlay {...base} open={false}>
            content
          </Overlay>,
        );
        expect(panels().length).toBeGreaterThanOrEqual(index);
      }
    });

    it("leaves a copy when one that started closed is opened and then closed", () => {
      const view = render(
        <Overlay {...base} open={false}>
          content
        </Overlay>,
      );
      expect(panels()).toHaveLength(0);
      view.rerender(
        <Overlay {...base} open>
          content
        </Overlay>,
      );
      expect(panels()).toHaveLength(0);
      view.rerender(
        <Overlay {...base} open={false}>
          content
        </Overlay>,
      );
      expect(panels()).toHaveLength(1);
    });

    it("leaves nothing for a person who asked for less motion", () => {
      vi.stubGlobal(
        "matchMedia",
        vi.fn(() => ({ matches: true })),
      );
      const view = render(<Overlay {...base}>content</Overlay>);
      view.rerender(
        <Overlay {...base} open={false}>
          content
        </Overlay>,
      );
      expect(panels()).toHaveLength(0);
    });

    it("leaves nothing for a sheet that was dragged off the screen", () => {
      const view = render(<Overlay {...base}>content</Overlay>);
      (screen.getByRole("dialog") as HTMLElement).style.transform =
        "translateY(320px)";
      view.rerender(
        <Overlay {...base} open={false}>
          content
        </Overlay>,
      );
      expect(panels()).toHaveLength(0);
    });
  });

  it("leaves nothing just because StrictMode ran the cleanup and the setup again at mount", async () => {
    render(
      <StrictMode>
        <Overlay {...base}>content</Overlay>
      </StrictMode>,
    );
    await Promise.resolve();
    expect(ghosts()).toHaveLength(0);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("leaves nothing for a person who asked for less motion", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true })),
    );
    render(<Overlay {...base}>content</Overlay>).unmount();
    await Promise.resolve();
    expect(ghosts()).toHaveLength(0);
  });

  it("is a sibling copy only: no second dialog, nothing to focus, nothing to read", async () => {
    render(<Overlay {...base}>content</Overlay>).unmount();
    await Promise.resolve();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect((ghosts()[0] as HTMLElement).children).toHaveLength(0);
  });

  it("leaves nothing in a browser that cannot say what motion was asked for", async () => {
    vi.stubGlobal("matchMedia", undefined);
    render(<Overlay {...base}>content</Overlay>).unmount();
    await Promise.resolve();
    expect(ghosts()).toHaveLength(0);
    expect(panels()).toHaveLength(0);
  });

  describe("the sheet's own copy", () => {
    const leaves = async (ui = <Overlay {...base}>content</Overlay>) => {
      render(ui).unmount();
      await Promise.resolve();
      return panels()[0] as HTMLElement;
    };

    it("is a picture of the sheet under its own class, so nothing that looks for the open sheet finds it", async () => {
      const copy = await leaves(
        <Overlay {...base}>
          <p>Name field</p>
        </Overlay>,
      );
      expect(copy).toHaveClass("ui-sheet-out");
      expect(copy).not.toHaveClass("ui-sheet");
      expect(document.querySelectorAll(".ui-sheet")).toHaveLength(0);
      expect(copy).toHaveTextContent("Name field");
      expect(copy).toHaveAttribute("data-state", "closed");
      expect(copy.parentElement).toBe(document.body);
    });

    it("is hidden from assistive technology, cannot take focus, and has no role, style or ids", async () => {
      const copy = await leaves(
        <Overlay {...base} footer={<button type="button">Save</button>}>
          <input id="name" defaultValue="Ann" />
        </Overlay>,
      );
      expect(copy).toHaveAttribute("aria-hidden", "true");
      expect(copy).toHaveAttribute("inert");
      expect(copy).not.toHaveAttribute("role");
      expect(copy).not.toHaveAttribute("style");
      expect(copy.id).toBe("");
      expect(copy.querySelectorAll("[id]")).toHaveLength(0);
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    });

    it("never copies a password, a secret marked data-secret, or a link that carries one", async () => {
      const copy = await leaves(
        <Overlay {...base}>
          <input
            type="password"
            defaultValue="pw-12345"
            aria-label="Password"
          />
          <span data-secret="" data-testid="temporary-password">
            maple-otter-1234-river
          </span>
          <ul data-secret="">
            <li>backup-code-one</li>
          </ul>
          <a href="otpauth://totp/x?secret=ABCDEFGH">Open</a>
          <p>Plain text stays.</p>
        </Overlay>,
      );
      const text = copy.textContent ?? "";
      expect(text).not.toContain("maple-otter-1234-river");
      expect(text).not.toContain("backup-code-one");
      expect(text).toContain("Plain text stays.");
      expect(
        (copy.querySelector('input[type="password"]') as HTMLInputElement)
          .value,
      ).toBe("");
      expect(copy.querySelector("a")?.hasAttribute("href")).toBe(false);
      expect(copy.innerHTML).not.toContain("ABCDEFGH");
      expect(copy.innerHTML).not.toContain("pw-12345");
      // Nor anywhere else in the page.
      expect(document.body.textContent).not.toContain("maple-otter-1234-river");
    });

    it("is not drawn when the sheet was already dragged off the screen, but the dark overlay still fades", async () => {
      const view = render(<Overlay {...base}>content</Overlay>);
      (screen.getByRole("dialog") as HTMLElement).style.transform =
        "translateY(320px)";
      view.unmount();
      await Promise.resolve();
      expect(panels()).toHaveLength(0);
      expect(ghosts()).toHaveLength(1);
    });

    it("is drawn when a spring-back left the sheet at translateY(0px)", async () => {
      const view = render(<Overlay {...base}>content</Overlay>);
      (screen.getByRole("dialog") as HTMLElement).style.transform =
        "translateY(0px)";
      view.unmount();
      await Promise.resolve();
      expect(panels()).toHaveLength(1);
    });

    it("goes when its own animation ends, not when something inside it does", async () => {
      const copy = await leaves(
        <Overlay {...base}>
          <p>Inside</p>
        </Overlay>,
      );
      fireEvent.animationEnd(copy.querySelector("p") as Element);
      expect(panels()).toHaveLength(1);
      fireEvent.animationEnd(copy);
      expect(panels()).toHaveLength(0);
    });

    it("goes after a short time even if its animation never reports its end", async () => {
      vi.useFakeTimers();
      await leaves();
      expect(panels()).toHaveLength(1);
      act(() => vi.advanceTimersByTime(401));
      expect(panels()).toHaveLength(0);
      expect(ghosts()).toHaveLength(0);
    });

    it("is not left for a person who asked for less motion", async () => {
      vi.stubGlobal(
        "matchMedia",
        vi.fn(() => ({ matches: true })),
      );
      render(<Overlay {...base}>content</Overlay>).unmount();
      await Promise.resolve();
      expect(panels()).toHaveLength(0);
    });
  });
});

describe("Overlay opened over another overlay", () => {
  // The CSS puts a lone overlay's dark layer at 30 and its panel at 31 (overlay.css); jsdom does not read the file.
  const z = (node: Element, fallback: number) =>
    Number((node as HTMLElement).style.zIndex || fallback);
  function Stack({ kind = "question" }: { kind?: "question" | "sheet" }) {
    const [asking, setAsking] = useState(false);
    return (
      <Overlay {...base} title="Edit transaction">
        <button type="button" onClick={() => setAsking(true)}>
          Delete
        </button>
        <Overlay
          {...base}
          open={asking}
          kind={kind}
          title="Delete this transaction?"
          onDismiss={() => setAsking(false)}
        >
          text
        </Overlay>
      </Overlay>
    );
  }
  afterEach(cleanup);

  it("puts its dark layer and its panel above the one beneath, so that one is dimmed", async () => {
    render(<Stack />);
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    const [lowerScrim, upperScrim] = document.querySelectorAll(".ui-scrim");
    // While another is open Radix hides the rest from assistive technology, so find it by its class.
    const lower = document.querySelector(".ui-sheet") as HTMLElement;
    const upper = screen.getByRole("dialog", {
      name: "Delete this transaction?",
    });
    expect(z(lowerScrim as Element, 30)).toBe(30);
    expect(z(lower, 31)).toBe(31);
    // The upper dark layer is over the lower panel; the upper panel is over its own dark layer.
    expect(z(upperScrim as Element, 30)).toBeGreaterThan(z(lower, 31));
    expect(z(upper, 31)).toBeGreaterThan(z(upperScrim as Element, 30));
  });

  it("does the same for a sheet opened over a sheet", async () => {
    render(<Stack kind="sheet" />);
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    const [, upperScrim] = document.querySelectorAll(".ui-scrim");
    const lower = document.querySelector(".ui-sheet") as HTMLElement;
    expect(z(upperScrim as Element, 30)).toBeGreaterThan(z(lower, 31));
  });

  it("leaves a lone overlay on the layers of the stylesheet, also after a stack has come and gone", async () => {
    render(<Stack />);
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await userEvent.keyboard("{Escape}");
    await userEvent.keyboard("{Escape}");
    cleanup();
    render(<Overlay {...base}>content</Overlay>);
    expect(
      (document.querySelector(".ui-scrim") as HTMLElement).style.zIndex,
    ).toBe("");
    expect(screen.getByRole("dialog").style.zIndex).toBe("");
  });

  it("gives the same layers each time it opens", async () => {
    render(<Stack />);
    const layers = async () => {
      await userEvent.click(screen.getByRole("button", { name: "Delete" }));
      const found = z(
        screen.getByRole("dialog", { name: "Delete this transaction?" }),
        31,
      );
      await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
      return found;
    };
    const first = await layers();
    expect(await layers()).toBe(first);
  });
});

describe("The copy of a stacked overlay that slides away", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: false })),
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    for (const left of document.querySelectorAll(
      ".ui-scrim, .ui-sheet-out, .ui-question-out",
    ))
      left.remove();
  });
  it("keeps its layer, so it does not drop under the sheet beneath while it goes", async () => {
    function Stack() {
      const [asking, setAsking] = useState(true);
      return (
        <Overlay {...base} title="Edit transaction">
          <button type="button" onClick={() => setAsking(false)}>
            Close question
          </button>
          <Overlay
            {...base}
            open={asking}
            kind="question"
            title="Delete this transaction?"
            onDismiss={() => setAsking(false)}
          >
            text
          </Overlay>
        </Overlay>
      );
    }
    render(<Stack />);
    const live = screen.getByRole("dialog", {
      name: "Delete this transaction?",
    });
    const layer = Number(live.style.zIndex);
    expect(layer).toBeGreaterThan(31);
    await userEvent.keyboard("{Escape}");
    const copy = document.querySelector(".ui-question-out") as HTMLElement;
    expect(copy).not.toBeNull();
    expect(Number(copy.style.zIndex)).toBe(layer);
  });
  it("keeps the layer of its dark layer too, when its parent stops drawing it while it is open", async () => {
    function Stack() {
      const [shown, setShown] = useState(true);
      return (
        <Overlay {...base} title="Edit transaction">
          <button type="button" onClick={() => setShown(false)}>
            Stop drawing it
          </button>
          {shown && (
            <Overlay {...base} kind="question" title="Delete this transaction?">
              text
            </Overlay>
          )}
        </Overlay>
      );
    }
    render(<Stack />);
    const scrims = document.querySelectorAll<HTMLElement>(".ui-scrim");
    const layer = Number(scrims[1]?.style.zIndex);
    expect(layer).toBeGreaterThan(30);
    fireEvent.click(
      screen.getByRole("button", { name: "Stop drawing it", hidden: true }),
    );
    await Promise.resolve();
    const ghost = document.querySelector<HTMLElement>(
      '.ui-scrim[data-state="closed"]',
    );
    expect(ghost).not.toBeNull();
    expect(Number(ghost?.style.zIndex)).toBe(layer);
  });
});
