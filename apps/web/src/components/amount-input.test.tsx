import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { AmountEntryContext } from "../features/shell/preferences";
import { AmountInput } from "./amount-input";

function Box({
  on,
  start = "",
  currency = "USD",
}: {
  on: boolean;
  start?: string;
  currency?: string;
}) {
  const [value, setValue] = useState(start);
  return (
    <AmountEntryContext value={{ centsFirst: on, setCentsFirst: () => {} }}>
      <label htmlFor="amt">Amount</label>
      <AmountInput
        id="amt"
        currency={currency}
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      <output data-testid="state">{value}</output>
    </AmountEntryContext>
  );
}

describe("AmountInput", () => {
  afterEach(cleanup);
  it("is an ordinary box when the preference is off", async () => {
    render(<Box on={false} />);
    await userEvent.type(screen.getByLabelText("Amount"), "12.5");
    expect(screen.getByLabelText("Amount")).toHaveValue("12.5");
    expect(screen.getByLabelText("Amount")).not.toHaveAttribute("placeholder");
  });
  it("fills digits in from the right when the preference is on", async () => {
    render(<Box on />);
    const box = screen.getByLabelText("Amount");
    expect(box).toHaveAttribute("placeholder", "0.00");
    expect(box).toHaveAttribute("inputmode", "numeric");
    await userEvent.type(box, "1234");
    expect(box).toHaveValue("12.34");
    expect(screen.getByTestId("state")).toHaveTextContent("12.34");
    await userEvent.keyboard("{Backspace}");
    expect(box).toHaveValue("1.23");
    await userEvent.keyboard("{Backspace}{Backspace}{Backspace}");
    expect(box).toHaveValue("");
  });
  it("appends to a value that is already there", async () => {
    render(<Box on start="12.50" />);
    const box = screen.getByLabelText("Amount");
    await userEvent.click(box);
    await userEvent.keyboard("3");
    expect(box).toHaveValue("125.03");
  });
  it("uses the currency's decimals", async () => {
    render(<Box on currency="JPY" />);
    const box = screen.getByLabelText("Amount");
    expect(box).toHaveAttribute("placeholder", "0");
    await userEvent.type(box, "1500");
    expect(box).toHaveValue("1500");
  });
  it("reads a paste the ordinary way", async () => {
    render(<Box on />);
    const box = screen.getByLabelText("Amount");
    await userEvent.click(box);
    await userEvent.paste("42.5");
    expect(box).toHaveValue("42.50");
    expect(screen.getByTestId("state")).toHaveTextContent("42.50");
  });
});
