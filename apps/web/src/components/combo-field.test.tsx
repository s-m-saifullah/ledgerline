import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type ComboCreate, ComboField, type ComboOption } from "./combo-field";

afterEach(cleanup);
const options: ComboOption[] = [
  { id: "a1", label: "Checking" },
  { id: "a2", label: "Cash" },
  { id: "a3", label: "Old account (archived)" },
];
function Harness({
  value = null,
  creates,
  onChange = () => {},
  disabled,
}: {
  value?: string | null;
  creates?: ComboCreate[];
  onChange?: (id: string | null) => void;
  disabled?: boolean;
}) {
  const [current, setCurrent] = useState(value);
  return (
    <ComboField
      label="Account"
      allLabel="All accounts"
      emptyText="No matching accounts."
      options={options}
      value={current}
      onChange={(id) => {
        setCurrent(id);
        onChange(id);
      }}
      {...(creates ? { creates } : {})}
      {...(disabled ? { disabled } : {})}
    />
  );
}
const box = () => screen.getByRole("combobox", { name: "Account" });

describe("ComboField", () => {
  it("shows the chosen option's name, or the All text as a placeholder", () => {
    render(<Harness />);
    expect(box()).toHaveValue("");
    expect(box()).toHaveAttribute("placeholder", "All accounts");
    cleanup();
    render(<Harness value="a2" />);
    expect(box()).toHaveValue("Cash");
  });

  it("opens on focus with All first, then every option, and the chosen one marked", async () => {
    render(<Harness value="a2" />);
    await userEvent.click(box());
    const list = screen.getByRole("listbox", { name: "Account options" });
    expect(
      within(list)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["All accounts", "Checking", "Cash", "Old account (archived)"]);
    expect(within(list).getByRole("option", { name: "Cash" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("does not open just because it was focused, but does for an arrow key", async () => {
    render(<Harness />);
    box().focus();
    expect(screen.queryByRole("listbox")).toBeNull();
    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("narrows as you type, ignoring case, and drops All", async () => {
    render(<Harness />);
    await userEvent.type(box(), "CHEC");
    const names = screen.getAllByRole("option").map((o) => o.textContent);
    expect(names).toEqual(["Checking"]);
  });

  it("chooses with a click, and the list closes", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await userEvent.click(box());
    await userEvent.click(screen.getByRole("option", { name: "Cash" }));
    expect(onChange).toHaveBeenCalledWith("a2");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(box()).toHaveValue("Cash");
  });

  it("clears with the All choice", async () => {
    const onChange = vi.fn();
    render(<Harness value="a2" onChange={onChange} />);
    await userEvent.click(box());
    await userEvent.click(screen.getByRole("option", { name: "All accounts" }));
    expect(onChange).toHaveBeenCalledWith(null);
    expect(box()).toHaveValue("");
  });

  it("chooses with the keyboard: arrows, Enter, and Escape closes without choosing", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await userEvent.click(box());
    await userEvent.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    // All is first, so two steps down is Cash.
    expect(onChange).toHaveBeenCalledWith("a2");
    await userEvent.click(box());
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("says when nothing matches", async () => {
    render(<Harness />);
    await userEvent.type(box(), "zzz");
    expect(screen.getByText("No matching accounts.")).toBeInTheDocument();
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });

  it("is off when disabled", async () => {
    render(<Harness disabled />);
    expect(box()).toBeDisabled();
  });
});

describe("ComboField: creating what does not exist", () => {
  const make = (run: ComboCreate["run"]): ComboCreate[] => [
    { key: "one", label: (text) => `Create “${text}”`, run },
  ];

  it("offers to create a name nobody has, after the matches", async () => {
    render(<Harness creates={make(async () => "new")} />);
    await userEvent.type(box(), "Che");
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Checking",
      "Create “Che”",
    ]);
  });

  it("offers nothing to create for an exact match, whatever the case", async () => {
    render(<Harness creates={make(async () => "new")} />);
    await userEvent.type(box(), "cash");
    expect(screen.queryByRole("option", { name: /Create/ })).toBeNull();
  });

  it("offers nothing to create before anything is typed", async () => {
    render(<Harness creates={make(async () => "new")} />);
    await userEvent.click(box());
    expect(screen.queryByRole("option", { name: /Create/ })).toBeNull();
  });

  it("can offer several kinds of create", async () => {
    render(
      <Harness
        creates={[
          {
            key: "e",
            label: (t) => `Create expense “${t}”`,
            run: async () => "e",
          },
          {
            key: "i",
            label: (t) => `Create income “${t}”`,
            run: async () => "i",
          },
        ]}
      />,
    );
    await userEvent.type(box(), "Pets");
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Create expense “Pets”",
      "Create income “Pets”",
    ]);
  });

  it("creates with the typed text, then chooses what was made", async () => {
    const run = vi.fn(async () => "made");
    const onChange = vi.fn();
    render(<Harness creates={make(run)} onChange={onChange} />);
    await userEvent.type(box(), "  Pets ");
    await userEvent.click(
      screen.getByRole("option", { name: "Create “Pets”" }),
    );
    expect(run).toHaveBeenCalledWith("Pets");
    await waitFor(() => expect(onChange).toHaveBeenCalledWith("made"));
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("creates from the keyboard", async () => {
    const run = vi.fn(async () => "made");
    render(<Harness creates={make(run)} />);
    await userEvent.type(box(), "Pets");
    await userEvent.keyboard("{Enter}");
    expect(run).toHaveBeenCalledWith("Pets");
  });

  it("shows why a create failed, and chooses nothing", async () => {
    const onChange = vi.fn();
    render(
      <Harness
        creates={make(async () => {
          throw new Error("That name is taken.");
        })}
        onChange={onChange}
      />,
    );
    await userEvent.type(box(), "Pets");
    await userEvent.click(
      screen.getByRole("option", { name: "Create “Pets”" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That name is taken.",
    );
    expect(onChange).not.toHaveBeenCalled();
  });

  it("does not create twice when its option is clicked again while one is under way", async () => {
    let finish: (id: string) => void = () => {};
    const run = vi.fn(
      () => new Promise<string>((resolve) => (finish = resolve)),
    );
    render(<Harness creates={make(run)} />);
    await userEvent.type(box(), "Pets");
    const option = screen.getByRole("option", { name: "Create “Pets”" });
    await userEvent.click(option);
    await userEvent.click(option);
    expect(run).toHaveBeenCalledTimes(1);
    finish("made");
    await waitFor(() => expect(box()).toBeEnabled());
  });

  it("forgets a failure as soon as you type again", async () => {
    render(
      <Harness
        creates={make(async () => {
          throw new Error("That name is taken.");
        })}
      />,
    );
    await userEvent.type(box(), "Pets");
    await userEvent.click(
      screen.getByRole("option", { name: "Create “Pets”" }),
    );
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    await userEvent.type(box(), "x");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("does not create twice while one is under way", async () => {
    let finish: (id: string) => void = () => {};
    const run = vi.fn(
      () => new Promise<string>((resolve) => (finish = resolve)),
    );
    render(<Harness creates={make(run)} />);
    await userEvent.type(box(), "Pets");
    await userEvent.click(
      screen.getByRole("option", { name: "Create “Pets”" }),
    );
    expect(box()).toBeDisabled();
    await userEvent.keyboard("{Enter}");
    expect(run).toHaveBeenCalledTimes(1);
    finish("made");
    await waitFor(() => expect(box()).toBeEnabled());
  });
});
