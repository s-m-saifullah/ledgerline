import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HourlyHelper } from "./hourly-helper";

afterEach(cleanup);

function useTotal(secret: boolean) {
  const onUse = vi.fn();
  render(
    <HourlyHelper
      currency="USD"
      secret={secret}
      disabled={false}
      descriptionBlank
      onUse={onUse}
    />,
  );
  fireEvent.change(screen.getByLabelText("Hours"), {
    target: { value: "3.5" },
  });
  fireEvent.change(screen.getByLabelText(/Hourly rate/), {
    target: { value: "40" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Use this total" }));
  return onUse;
}

describe("the hourly helper", () => {
  it("writes how the total was worked out into a blank description", () => {
    const onUse = useTotal(false);
    expect(onUse).toHaveBeenCalledTimes(1);
    expect(onUse).toHaveBeenCalledWith("140.00", "3.5 h at $40.00/h");
  });

  it("writes no rate into the saved description while amounts are hidden", () => {
    const onUse = useTotal(true);
    expect(onUse).toHaveBeenCalledTimes(1);
    expect(onUse).toHaveBeenCalledWith("140.00", null);
    // Nothing of the figures is on the screen either.
    expect(screen.queryByText(/40/)).toBeNull();
  });

  it("leaves a description that is already there alone", () => {
    const onUse = vi.fn();
    render(
      <HourlyHelper
        currency="USD"
        secret={false}
        disabled={false}
        descriptionBlank={false}
        onUse={onUse}
      />,
    );
    fireEvent.change(screen.getByLabelText("Hours"), {
      target: { value: "2" },
    });
    fireEvent.change(screen.getByLabelText(/Hourly rate/), {
      target: { value: "10" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Use this total" }));
    expect(onUse).toHaveBeenCalledWith("20.00", null);
  });
});
