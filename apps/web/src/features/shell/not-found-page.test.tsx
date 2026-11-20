import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NotFoundPage } from "./not-found-page";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    className,
    ...rest
  }: {
    children: ReactNode;
    to: string;
    className?: string;
  }) => (
    <a href={to} className={className} {...rest}>
      {children}
    </a>
  ),
}));

afterEach(cleanup);

// A missing page says so and offers the way home (WP-11e): no eyebrow, no subtitle and no welcome card that
// promises "a little more clarity" for a page that does not exist.
describe("the page that is not found", () => {
  it("has the title, one short line and one way home", () => {
    render(<NotFoundPage />);
    expect(
      screen.getByRole("heading", { level: 1, name: "Page not found" }),
    ).toBeInTheDocument();
    expect(screen.getByText("This page does not exist.")).toBeInTheDocument();
    const home = screen.getByRole("link", { name: "Go to Home" });
    expect(home).toHaveAttribute("href", "/");
    expect(home).toHaveClass("ui-btn", "ui-btn-primary");
  });
  it("keeps no eyebrow, no subtitle and no welcome card", () => {
    const { container } = render(<NotFoundPage />);
    expect(screen.queryByText(/your personal ledger/i)).toBeNull();
    expect(screen.queryByText(/little more clarity/i)).toBeNull();
    expect(screen.queryByText(/coming soon/i)).toBeNull();
    expect(screen.queryByText(/choose a page from the navigation/i)).toBeNull();
    expect(container.querySelector(".welcome-card, .eyebrow")).toBeNull();
  });
  it("is one root, like every page, because the page frame is a grid", () => {
    const { container } = render(<NotFoundPage />);
    expect(container.children).toHaveLength(1);
  });
});
