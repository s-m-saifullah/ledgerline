import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppVersion } from "./shell";

describe("AppVersion", () => {
  it("shows the build's release tag", () => {
    render(<AppVersion />);
    expect(screen.getByTestId("app-version").textContent).toBe(
      "Ledgerline v0.0.0-test",
    );
  });
});
