import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PrivacyContext } from "../lib/preferences";
import { Amount } from "./amount-text";

afterEach(cleanup);

describe("Amount with a plus sign", () => {
  it("puts a plus before a positive amount when asked", () => {
    render(<Amount cents={132640} plus />);
    expect(screen.getByText("+$1,326.40")).toBeInTheDocument();
  });

  it("puts no plus before zero or a negative amount", () => {
    render(
      <>
        <Amount cents={0} plus />
        <Amount cents={-500} plus />
      </>,
    );
    expect(screen.getByText("$0.00")).toBeInTheDocument();
    expect(screen.getByText("-$5.00")).toBeInTheDocument();
  });

  it("has no plus unless asked", () => {
    render(<Amount cents={500} />);
    expect(screen.getByText("$5.00")).toBeInTheDocument();
  });

  it("keeps the mask and shows no sign in privacy mode", () => {
    const { container } = render(
      <PrivacyContext value={true}>
        <Amount cents={500} plus />
      </PrivacyContext>,
    );
    expect(container.textContent).not.toContain("+");
    expect(screen.getByText("Amount hidden")).toBeInTheDocument();
  });
});
