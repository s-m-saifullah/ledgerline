import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PickRow } from "./pick-row";

afterEach(cleanup);
const options = [
  { value: "", label: "Choose a column" },
  { value: "0", label: "Date (2026-10-02)", short: "Date" },
  { value: "1", label: "Amount (-4.50)" },
];

describe("PickRow", () => {
  it("is a select named by its label, with the chosen option's text shown on the row", () => {
    render(
      <PickRow
        id="p"
        label="Amount"
        value="1"
        options={options}
        onChange={vi.fn()}
      />,
    );
    const select = screen.getByLabelText("Amount");
    expect(select.tagName).toBe("SELECT");
    expect(select).toHaveProperty("value", "1");
    expect(select.closest(".ui-pick-row")?.textContent).toContain(
      "Amount (-4.50)",
    );
  });

  it("shows the short text on the row when an option has one, and the full text in the list", () => {
    render(
      <PickRow
        id="p"
        label="Date"
        value="0"
        options={options}
        onChange={vi.fn()}
      />,
    );
    const row = screen.getByLabelText("Date").closest(".ui-pick-row");
    expect(row?.querySelector(".ui-pick-value")?.textContent).toBe("Date");
    expect(
      screen.getByRole("option", { name: "Date (2026-10-02)" }),
    ).toBeTruthy();
  });

  it("shows an empty choice as a muted placeholder", () => {
    render(
      <PickRow
        id="p"
        label="Date"
        value=""
        options={options}
        onChange={vi.fn()}
      />,
    );
    const placeholder = document.querySelector(".ui-pick-placeholder");
    expect(placeholder?.textContent).toBe("Choose a column");
    cleanup();
    render(
      <PickRow
        id="p"
        label="Date"
        value="1"
        options={options}
        onChange={vi.fn()}
      />,
    );
    expect(document.querySelector(".ui-pick-placeholder")).toBeNull();
  });

  it("reports the chosen value", async () => {
    const onChange = vi.fn();
    render(
      <PickRow
        id="p"
        label="Date"
        value=""
        options={options}
        onChange={onChange}
      />,
    );
    await userEvent.selectOptions(screen.getByLabelText("Date"), "1");
    expect(onChange).toHaveBeenCalledWith("1");
  });

  it("hides the drawn value and chevron from screen readers, so the select is read once", () => {
    render(
      <PickRow
        id="p"
        label="Date"
        value="0"
        options={options}
        onChange={vi.fn()}
      />,
    );
    expect(
      document.querySelector(".ui-pick-value")?.getAttribute("aria-hidden"),
    ).toBe("true");
    expect(
      document.querySelector(".ui-row-chevron")?.getAttribute("aria-hidden"),
    ).toBe("true");
  });

  it("can be switched off, and a disabled option cannot be chosen", () => {
    render(
      <PickRow
        id="p"
        label="Date"
        value=""
        disabled
        options={[
          ...options,
          { value: "9", label: "Archived", disabled: true },
        ]}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Date")).toHaveProperty("disabled", true);
    expect(screen.getByRole("option", { name: "Archived" })).toHaveProperty(
      "disabled",
      true,
    );
  });
});
