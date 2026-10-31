import { describe, expect, it } from "vitest";
import {
  backsToMore,
  destinations,
  isActiveDestination,
  moreGroups,
  morePages,
  pageTitle,
  showsAdd,
} from "./nav";

describe("the navigation model", () => {
  it("has the five destinations in order", () => {
    expect(destinations.map(({ to, label }) => [to, label])).toEqual([
      ["/", "Home"],
      ["/transactions", "Transactions"],
      ["/budgets", "Budgets"],
      ["/insights", "Insights"],
      ["/more", "More"],
    ]);
  });

  it("lists More's pages under three groups, in the decided order", () => {
    expect(
      moreGroups.map(({ label, pages }) => [label, pages.map((p) => p.to)]),
    ).toEqual([
      ["Receivables and lending", ["/clients", "/loans"]],
      [
        "Money setup",
        ["/accounts", "/categories", "/tags", "/currencies", "/recurring"],
      ],
      ["Data and preferences", ["/import", "/settings"]],
    ]);
  });

  it("names the import page Import and export, and the palette still says Import from CSV", () => {
    const page = morePages.find((row) => row.to === "/import");
    expect(page?.label).toBe("Import and export");
    expect(page?.paletteLabel).toBe("Import from CSV");
    expect(pageTitle("/import")).toBe("Import and export");
  });

  it("lists every page once, and none is also a destination", () => {
    const all = [...destinations, ...morePages].map((page) => page.to);
    expect(new Set(all).size).toBe(all.length);
  });

  it("highlights More on More and on every page reached from it, and each other tab only on itself", () => {
    for (const { to } of morePages)
      expect(isActiveDestination("/more", to)).toBe(true);
    expect(isActiveDestination("/more", "/more")).toBe(true);
    expect(isActiveDestination("/more", "/transactions")).toBe(false);
    expect(isActiveDestination("/more", "/")).toBe(false);
    expect(isActiveDestination("/transactions", "/transactions")).toBe(true);
    expect(isActiveDestination("/transactions", "/accounts")).toBe(false);
    expect(isActiveDestination("/", "/transactions")).toBe(false);
  });

  it("names the page for the title and the screen-reader announcement", () => {
    expect(pageTitle("/")).toBe("Home");
    expect(pageTitle("/transactions")).toBe("Transactions");
    expect(pageTitle("/budgets")).toBe("Budgets");
    expect(pageTitle("/insights")).toBe("Insights");
    expect(pageTitle("/more")).toBe("More");
    for (const { to, label } of morePages) expect(pageTitle(to)).toBe(label);
    expect(pageTitle("/nowhere")).toBe("Home");
  });

  it("shows a back arrow on a phone only on pages opened from More", () => {
    for (const { to } of morePages) expect(backsToMore(to)).toBe(true);
    for (const { to } of destinations) expect(backsToMore(to)).toBe(false);
  });

  it("offers the phone's Add button everywhere except More, Settings and Import", () => {
    for (const path of ["/more", "/settings", "/import"])
      expect(showsAdd(path)).toBe(false);
    for (const path of [
      "/",
      "/transactions",
      "/budgets",
      "/insights",
      "/accounts",
      "/categories",
      "/tags",
      "/currencies",
      "/recurring",
      "/clients",
      "/loans",
    ])
      expect(showsAdd(path)).toBe(true);
  });
});
