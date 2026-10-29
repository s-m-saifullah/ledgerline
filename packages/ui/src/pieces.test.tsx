import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Avatar,
  EmptyState,
  FilterChip,
  Hero,
  HeroFigure,
  initialsOf,
  ListCard,
  ListRow,
  limitState,
  ProportionBar,
  SectionLabel,
  SegmentedControl,
  StatusPill,
  SwitchRow,
} from "./pieces";

afterEach(cleanup);

describe("initialsOf (the phone's rule)", () => {
  it.each([
    ["Acme Studio", "AS"],
    ["  harbor   cafe  ", "HC"],
    ["Alex", "AL"],
    ["a", "A"],
    ["Mary Jane Watson", "MJ"],
    ["(Acme) -Studio", "AS"],
    ["Élan Vital", "ÉV"],
    ["", "?"],
    ["   ", "?"],
    ["--", "?"],
  ])("%j gives %j", (name, initials) => {
    expect(initialsOf(name)).toBe(initials);
  });

  it("shows the initials in an avatar that is hidden from screen readers", () => {
    const { container } = render(<Avatar name="Acme Studio" />);
    expect(container.firstElementChild).toHaveTextContent("AS");
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
  });
});

describe("limitState (the phone's thresholds)", () => {
  it.each([
    [0, 10_000, "within"],
    [8_999, 10_000, "within"],
    [9_000, 10_000, "near"],
    [10_000, 10_000, "near"],
    [10_001, 10_000, "over"],
    [500, 0, "within"],
    [500, -1, "within"],
  ])("%d of %d is %s", (used, limit, state) => {
    expect(limitState(used, limit)).toBe(state);
  });
});

describe("ProportionBar", () => {
  it("fills to the share and names it for screen readers", () => {
    render(<ProportionBar share={0.42} />);
    const bar = screen.getByRole("img", { name: "42%" });
    expect(bar.firstElementChild).toHaveStyle({ width: "42%" });
  });

  it("keeps the fill between empty and full", () => {
    const { rerender } = render(<ProportionBar share={-1} />);
    expect(screen.getByRole("img").firstElementChild).toHaveStyle({
      width: "0%",
    });
    rerender(<ProportionBar share={3} />);
    expect(screen.getByRole("img").firstElementChild).toHaveStyle({
      width: "100%",
    });
  });

  it("carries its state as a class so the colour can follow it", () => {
    render(<ProportionBar share={1} state="over" label="Over budget" />);
    expect(screen.getByRole("img", { name: "Over budget" })).toHaveClass(
      "ui-bar-over",
    );
  });
});

describe("ListRow", () => {
  it("shows a title, one hint and a trailing value with its own hint", () => {
    render(
      <ListCard>
        <ListRow
          title="Harbor Checking"
          hint="Checking"
          value="$1,200.00"
          valueHint="Oct 12"
        />
      </ListCard>,
    );
    expect(screen.getByText("Harbor Checking")).toHaveClass("ui-row-title");
    expect(screen.getByText("Checking")).toHaveClass("ui-row-hint");
    expect(screen.getByText("$1,200.00")).toBeInTheDocument();
    expect(screen.getByText("Oct 12")).toHaveClass("ui-row-hint");
  });

  it("draws no hint element when there is none", () => {
    const { container } = render(<ListRow title="Cash" />);
    expect(container.querySelector(".ui-row-hint")).toBeNull();
    expect(container.querySelector(".ui-row-end")).toBeNull();
  });

  it("is a static row, a button or a link, and only the last two are interactive", async () => {
    const onClick = vi.fn();
    const { rerender } = render(<ListRow title="Static" />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();

    rerender(<ListRow title="Open it" onClick={onClick} />);
    await userEvent.click(screen.getByRole("button", { name: "Open it" }));
    expect(onClick).toHaveBeenCalledTimes(1);

    rerender(
      <ListRow
        title="Clients"
        render={(inner, className) => (
          <a href="/clients" className={className}>
            {inner}
          </a>
        )}
      />,
    );
    expect(screen.getByRole("link", { name: "Clients" })).toHaveAttribute(
      "href",
      "/clients",
    );
    expect(screen.getByRole("link")).toHaveClass("ui-row");
  });

  it("marks a row that opens something with a chevron hidden from screen readers", () => {
    const { container } = render(
      <ListRow title="Settings" onClick={() => {}} chevron />,
    );
    expect(container.querySelector(".ui-row-chevron")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });

  it("puts a lead (an avatar or a tile) first", () => {
    const { container } = render(
      <ListRow title="Acme" lead={<Avatar name="Acme" />} />,
    );
    expect(container.querySelector(".ui-row")?.firstElementChild).toHaveClass(
      "ui-avatar",
    );
  });
});

describe("StatusPill, SectionLabel, EmptyState", () => {
  it("names the tone as a class", () => {
    render(<StatusPill tone="danger">Overdue</StatusPill>);
    expect(screen.getByText("Overdue")).toHaveClass(
      "ui-pill",
      "ui-pill-danger",
    );
  });

  it("defaults to the accent tone", () => {
    render(<StatusPill>Paid</StatusPill>);
    expect(screen.getByText("Paid")).toHaveClass("ui-pill-accent");
  });

  it("shows a section label", () => {
    render(<SectionLabel>Cash and banking</SectionLabel>);
    expect(screen.getByText("Cash and banking")).toHaveClass(
      "ui-section-label",
    );
  });

  it("shows an empty state with an optional action", async () => {
    const onClick = vi.fn();
    const { rerender } = render(<EmptyState text="Nothing here yet." />);
    expect(screen.getByText("Nothing here yet.")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
    rerender(
      <EmptyState
        text="Nothing here yet."
        action={{ label: "Add", onClick }}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe("FilterChip", () => {
  it("is a toggle button that says whether it is on", async () => {
    const onClick = vi.fn();
    const { rerender } = render(
      <FilterChip selected={false} onClick={onClick}>
        Open
      </FilterChip>,
    );
    const chip = screen.getByRole("button", { name: "Open" });
    expect(chip).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(chip);
    expect(onClick).toHaveBeenCalledTimes(1);
    rerender(
      <FilterChip selected onClick={onClick} count={3}>
        Open
      </FilterChip>,
    );
    expect(screen.getByRole("button", { name: "Open 3" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});

describe("SegmentedControl", () => {
  const options = [
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
    { value: "system", label: "System" },
  ];

  it("is one radio group with the chosen option checked", () => {
    render(
      <SegmentedControl
        label="Theme"
        options={options}
        value="dark"
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole("radiogroup", { name: "Theme" })).toBeVisible();
    expect(screen.getByRole("radio", { name: "Dark" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Light" })).not.toBeChecked();
  });

  it("only the chosen option is in the tab order", () => {
    render(
      <SegmentedControl
        label="Theme"
        options={options}
        value="dark"
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole("radio", { name: "Dark" })).toHaveAttribute(
      "tabindex",
      "0",
    );
    expect(screen.getByRole("radio", { name: "Light" })).toHaveAttribute(
      "tabindex",
      "-1",
    );
  });

  it("chooses on a click", async () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        label="Theme"
        options={options}
        value="dark"
        onChange={onChange}
      />,
    );
    await userEvent.click(screen.getByRole("radio", { name: "System" }));
    expect(onChange).toHaveBeenCalledWith("system");
  });

  it("moves with the arrow keys, wrapping at both ends, and moves focus with it", async () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        label="Theme"
        options={options}
        value="system"
        onChange={onChange}
      />,
    );
    screen.getByRole("radio", { name: "System" }).focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith("light");
    expect(screen.getByRole("radio", { name: "Light" })).toHaveFocus();
    await userEvent.keyboard("{ArrowLeft}");
    expect(onChange).toHaveBeenLastCalledWith("system");
    await userEvent.keyboard("{ArrowDown}");
    expect(onChange).toHaveBeenLastCalledWith("light");
    await userEvent.keyboard("{ArrowUp}");
    expect(onChange).toHaveBeenLastCalledWith("system");
  });

  it("Home and End go to the first and last option", async () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        label="Theme"
        options={options}
        value="dark"
        onChange={onChange}
      />,
    );
    screen.getByRole("radio", { name: "Dark" }).focus();
    await userEvent.keyboard("{End}");
    expect(onChange).toHaveBeenLastCalledWith("system");
    await userEvent.keyboard("{Home}");
    expect(onChange).toHaveBeenLastCalledWith("light");
  });
});

describe("SwitchRow", () => {
  it("is one switch named by its title, with its hint as the description", () => {
    render(
      <SwitchRow
        title="Pending"
        hint="Not cleared yet"
        checked={false}
        onChange={() => {}}
      />,
    );
    const toggle = screen.getByRole("switch", { name: "Pending" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(toggle).toHaveAccessibleDescription("Not cleared yet");
  });

  it("asks for the opposite on a click and on Space", async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <SwitchRow title="Pending" checked={false} onChange={onChange} />,
    );
    await userEvent.click(screen.getByRole("switch", { name: "Pending" }));
    expect(onChange).toHaveBeenLastCalledWith(true);
    rerender(<SwitchRow title="Pending" checked onChange={onChange} />);
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
    screen.getByRole("switch").focus();
    await userEvent.keyboard(" ");
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it("does nothing when disabled", async () => {
    const onChange = vi.fn();
    render(
      <SwitchRow
        title="Pending"
        checked={false}
        onChange={onChange}
        disabled
      />,
    );
    await userEvent.click(screen.getByRole("switch"));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("Hero", () => {
  it("shows its label and figure, then the small figures", () => {
    render(
      <Hero label="In hand" figure="$12,400.00">
        <HeroFigure label="Clients owe" value="$1,500.00" />
      </Hero>,
    );
    expect(screen.getByText("In hand")).toBeInTheDocument();
    expect(screen.getByText("$12,400.00")).toBeInTheDocument();
    expect(screen.getByText("Clients owe")).toHaveClass("ui-hero-fig-label");
  });

  it("draws no figures row when there are none", () => {
    const { container } = render(<Hero label="In hand" figure="$1.00" />);
    expect(container.querySelector(".ui-hero-figs")).toBeNull();
  });

  it("a figure can be a link with an icon, or a plain figure", () => {
    render(
      <Hero label="In hand" figure="$1.00">
        <HeroFigure
          label="Clients owe"
          value="$5.00"
          icon={<svg data-testid="icon" />}
          render={(inner, className) => (
            <a href="/clients" className={className}>
              {inner}
            </a>
          )}
        />
        <HeroFigure label="You owe" value="$2.00" />
      </Hero>,
    );
    expect(screen.getByRole("link", { name: /Clients owe/ })).toHaveAttribute(
      "href",
      "/clients",
    );
    expect(screen.getByTestId("icon")).toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });
});
