import type { CashFlowReport, NetWorthReport } from "@ledgerline/shared";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Figures } from "./figures";

afterEach(cleanup);
const usd = (amount: number) => ({ amount, currency: "USD" as const });
const flow: CashFlowReport = {
  from: "2026-09",
  to: "2026-10",
  months: ["2026-09", "2026-10"].map((month, index) => ({
    month,
    income: usd(1000 * (index + 1)),
    spending: usd(300),
    net: usd(1000 * (index + 1) - 300),
  })),
};
const worth = (months: NetWorthReport["months"]): NetWorthReport => ({
  from: "2026-09",
  to: "2026-10",
  historyStart: months[0]?.month ?? null,
  months,
});
const point = (month: string, cents: number, missing: string[] = []) => ({
  month,
  asOf: `${month}-28`,
  netWorth: usd(cents),
  unconvertedCurrencies: missing,
});
const tables = () => screen.queryAllByRole("table", { hidden: true });

describe("Figures", () => {
  it("draws nothing without a cash flow chart or net worth months", () => {
    const { container } = render(<Figures flow={null} worth={null} />);
    expect(container).toBeEmptyDOMElement();
    cleanup();
    const empty = render(<Figures flow={null} worth={worth([])} />);
    expect(empty.container).toBeEmptyDOMElement();
  });

  it("is one disclosure with a table for each chart, the newest month first", () => {
    render(
      <Figures
        flow={flow}
        worth={worth([point("2026-09", 500), point("2026-10", 900, ["EUR"])])}
      />,
    );
    expect(screen.getAllByText("Show the figures")).toHaveLength(1);
    expect(tables()).toHaveLength(2);
    const heads = within(tables()[0] as HTMLElement)
      .getAllByRole("rowheader", { hidden: true })
      .map((cell) => cell.textContent);
    expect(heads).toEqual(["Oct 2026", "Sep 2026"]);
    expect(tables()[1]?.textContent).toContain("without EUR");
    expect(tables()[1]?.textContent).toContain("$9.00");
  });

  it("has only the cash flow table when net worth has no months", () => {
    render(<Figures flow={flow} worth={worth([])} />);
    expect(tables()).toHaveLength(1);
    expect(tables()[0]?.textContent).toContain("Oct 2026");
  });

  it("has only the net worth table without a cash flow chart", () => {
    render(<Figures flow={null} worth={worth([point("2026-10", 900)])} />);
    expect(tables()).toHaveLength(1);
    expect(tables()[0]?.textContent).toContain("Net worth");
  });

  it("names each table for a screen reader", () => {
    render(<Figures flow={flow} worth={worth([point("2026-10", 900)])} />);
    expect(
      screen.getByRole("table", {
        name: "Money in, spending and net",
        hidden: true,
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole("table", {
        name: "Net worth at each month end",
        hidden: true,
      }),
    ).toBeTruthy();
  });
});
