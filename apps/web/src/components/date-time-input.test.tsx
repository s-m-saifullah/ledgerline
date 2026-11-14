import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { afterEach, expect, it, vi } from "vitest";
import { DateTimeInput } from "./date-time-input";
import { Overlay } from "./overlay";

afterEach(cleanup);

it("keeps historical calendar dates selectable even in zones with skipped civil days", async () => {
  render(
    <>
      <label htmlFor="date">Date</label>
      <DateTimeInput
        label="Date"
        id="date"
        type="date"
        defaultValue="2011-12-30"
      />
    </>,
  );
  await userEvent.click(screen.getByRole("button", { name: "Choose date" }));
  expect(screen.getByRole("button", { name: "2011-12-30" })).toHaveFocus();
  await userEvent.keyboard("{ArrowLeft}");
  expect(screen.getByRole("button", { name: "2011-12-29" })).toHaveFocus();
  await userEvent.keyboard("{ArrowRight}{Enter}");
  expect(screen.getByLabelText("Date")).toHaveValue("2011-12-30");
});

it("Escape closes only the nested picker and restores its trigger", async () => {
  const dismissed = vi.fn();
  render(
    <Overlay
      open
      title="Edit entry"
      description="Example"
      busy={false}
      onDismiss={dismissed}
      returnFocusId="date"
      fallbackFocusId="date"
    >
      <label htmlFor="date">Date</label>
      <DateTimeInput
        label="Date"
        id="date"
        type="date"
        defaultValue="2024-02-29"
      />
    </Overlay>,
  );
  await userEvent.click(screen.getByRole("button", { name: "Choose date" }));
  await userEvent.keyboard("{Escape}");
  expect(dismissed).not.toHaveBeenCalled();
  expect(
    screen.getByRole("dialog", { name: "Edit entry" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Choose date" })).toHaveFocus();
});

it("selects a leap date by keyboard and updates registered form values", async () => {
  const saved = vi.fn();
  function Form() {
    const { register, handleSubmit } = useForm({
      defaultValues: { date: "2024-02-28" },
    });
    return (
      <form onSubmit={handleSubmit(saved)}>
        <label htmlFor="date">Date</label>
        <DateTimeInput
          label="Date"
          id="date"
          type="date"
          required
          {...register("date")}
        />
        <button type="submit">Save</button>
      </form>
    );
  }
  render(<Form />);
  await userEvent.click(screen.getByRole("button", { name: "Choose date" }));
  expect(screen.getByRole("button", { name: "2024-02-28" })).toHaveFocus();
  await userEvent.keyboard("{ArrowRight}");
  expect(screen.getByRole("button", { name: "2024-02-29" })).toHaveFocus();
  await userEvent.keyboard("{Enter}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Date")).toHaveValue("2024-02-29");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(saved.mock.calls[0]?.[0]).toEqual({ date: "2024-02-29" });
});

it("preserves controlled exact times, rejects invalid drafts and clears optional time", async () => {
  function Field() {
    const [value, setValue] = useState("23:59");
    return (
      <>
        <label htmlFor="time">Local time</label>
        <DateTimeInput
          label="Local time"
          id="time"
          type="time"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      </>
    );
  }
  render(<Field />);
  await userEvent.click(
    screen.getByRole("button", { name: "Choose local time" }),
  );
  const hour = screen.getByLabelText("Hour");
  await userEvent.clear(hour);
  await userEvent.type(hour, "13");
  expect(screen.getByRole("button", { name: "Set time" })).toBeDisabled();
  await userEvent.clear(hour);
  await userEvent.type(hour, "0");
  expect(screen.getByRole("button", { name: "Set time" })).toBeDisabled();
  await userEvent.clear(hour);
  await userEvent.type(hour, "12");
  await userEvent.click(screen.getByRole("button", { name: "AM" }));
  await userEvent.click(screen.getByRole("button", { name: ":15" }));
  await userEvent.click(screen.getByRole("button", { name: "Set time" }));
  expect(screen.getByLabelText("Local time")).toHaveValue("00:15");
  // Reopening reads the saved 24-hour value back as 12:15 AM; an afternoon time is stored as 24-hour.
  await userEvent.click(
    screen.getByRole("button", { name: "Choose local time" }),
  );
  expect(screen.getByLabelText("Hour")).toHaveValue("12");
  expect(screen.getByLabelText("Minute")).toHaveValue("15");
  expect(screen.getByRole("button", { name: "AM" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await userEvent.clear(screen.getByLabelText("Hour"));
  await userEvent.type(screen.getByLabelText("Hour"), "2");
  await userEvent.clear(screen.getByLabelText("Minute"));
  await userEvent.type(screen.getByLabelText("Minute"), "32");
  await userEvent.click(screen.getByRole("button", { name: "PM" }));
  await userEvent.click(screen.getByRole("button", { name: "Set time" }));
  expect(screen.getByLabelText("Local time")).toHaveValue("14:32");
  await userEvent.click(
    screen.getByRole("button", { name: "Choose local time" }),
  );
  await userEvent.click(screen.getByRole("button", { name: "Clear" }));
  expect(screen.getByLabelText("Local time")).toHaveValue("");
});

it("respects date bounds and the supported historical year range", async () => {
  render(
    <>
      <label htmlFor="date">Date</label>
      <DateTimeInput
        label="Date"
        id="date"
        type="date"
        defaultValue="0001-01-01"
        min="0001-01-01"
        max="0001-01-03"
        required
      />
    </>,
  );
  await userEvent.click(screen.getByRole("button", { name: "Choose date" }));
  expect(screen.getByRole("button", { name: "Previous month" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "0001-01-04" })).toBeDisabled();
  expect(
    screen.queryByRole("button", { name: "Clear" }),
  ).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "0001-01-03" }));
  expect(screen.getByLabelText("Date")).toHaveValue("0001-01-03");
});

it("inherits frozen-fieldset guards and cancels without changing the value", async () => {
  const view = render(
    <fieldset disabled>
      <label htmlFor="date">Date</label>
      <DateTimeInput
        label="Date"
        id="date"
        type="date"
        defaultValue="9999-12-31"
      />
    </fieldset>,
  );
  expect(screen.getByRole("button", { name: "Choose date" })).toBeDisabled();
  view.rerender(
    <fieldset>
      <label htmlFor="date">Date</label>
      <DateTimeInput
        label="Date"
        id="date"
        type="date"
        defaultValue="9999-12-31"
      />
    </fieldset>,
  );
  await userEvent.click(screen.getByRole("button", { name: "Choose date" }));
  expect(screen.getByRole("button", { name: "Next month" })).toBeDisabled();
  await userEvent.keyboard("{Escape}");
  expect(screen.getByLabelText("Date")).toHaveValue("9999-12-31");
  expect(screen.getByRole("button", { name: "Choose date" })).toHaveFocus();
});

it("picks the year from a dropdown, keeping far-away saved years selectable", async () => {
  render(
    <>
      <label htmlFor="date">Date</label>
      <DateTimeInput
        label="Date"
        id="date"
        type="date"
        defaultValue="2026-10-08"
      />
    </>,
  );
  await userEvent.click(screen.getByRole("button", { name: "Choose date" }));
  const year = screen.getByRole("combobox", { name: "Calendar year" });
  expect(year.tagName).toBe("SELECT");
  await userEvent.selectOptions(year, "2019");
  expect(
    screen.getByRole("button", { name: "2019-10-01" }),
  ).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "2019-10-14" }));
  expect(screen.getByLabelText("Date")).toHaveValue("2019-10-14");
});
it("lists newest years first and includes a saved year outside the usual range", async () => {
  render(
    <>
      <label htmlFor="date">Date</label>
      <DateTimeInput
        label="Date"
        id="date"
        type="date"
        defaultValue="0042-03-05"
      />
    </>,
  );
  await userEvent.click(screen.getByRole("button", { name: "Choose date" }));
  const options = within(
    screen.getByRole("combobox", { name: "Calendar year" }),
  )
    .getAllByRole("option")
    .map((option) => Number(option.textContent));
  expect(options).toEqual([...options].sort((a, b) => b - a));
  expect(options).toContain(42);
  expect(options).toContain(new Date().getFullYear());
  expect(screen.getByRole("combobox", { name: "Calendar year" })).toHaveValue(
    "42",
  );
});

it("opens the calendar as the shared sheet: Cancel in its head, its actions pinned in the footer", async () => {
  render(
    <>
      <label htmlFor="date">Date</label>
      <DateTimeInput
        label="Date"
        id="date"
        type="date"
        defaultValue="2026-10-08"
      />
    </>,
  );
  await userEvent.click(screen.getByRole("button", { name: "Choose date" }));
  const picker = screen.getByRole("dialog", { name: "Date" });
  expect(picker).toHaveClass("ui-sheet");
  // The head says Cancel like every sheet; there is no X.
  const head = picker.querySelector(".ui-sheet-head") as HTMLElement;
  expect(within(head).getByRole("button", { name: "Cancel" })).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Close picker" }),
  ).not.toBeInTheDocument();
  // Clear (the field is optional) is secondary beside the one primary, Today, both in the footer.
  const foot = picker.querySelector(".ui-sheet-foot") as HTMLElement;
  expect(within(foot).getByRole("button", { name: "Clear" })).toHaveClass(
    "ui-btn-secondary",
  );
  expect(within(foot).getByRole("button", { name: "Today" })).toHaveClass(
    "ui-btn-primary",
  );
  // The calendar itself is the sheet's body, not the footer.
  const body = picker.querySelector(".ui-sheet-body") as HTMLElement;
  expect(
    within(body).getByRole("button", { name: "2026-10-08" }),
  ).toBeVisible();
});

it("a required date has no Clear in the footer", async () => {
  render(
    <>
      <label htmlFor="date">Date</label>
      <DateTimeInput
        label="Date"
        id="date"
        type="date"
        required
        defaultValue="2026-10-08"
      />
    </>,
  );
  await userEvent.click(screen.getByRole("button", { name: "Choose date" }));
  const foot = screen
    .getByRole("dialog", { name: "Date" })
    .querySelector(".ui-sheet-foot") as HTMLElement;
  expect(
    within(foot).queryByRole("button", { name: "Clear" }),
  ).not.toBeInTheDocument();
  expect(within(foot).getByRole("button", { name: "Today" })).toBeVisible();
});

it("opens the time picker as a sheet with Clear, Now and Set time in the footer and the hour ready to type", async () => {
  render(
    <>
      <label htmlFor="time">Time</label>
      <DateTimeInput label="Time" id="time" type="time" defaultValue="09:30" />
    </>,
  );
  await userEvent.click(screen.getByRole("button", { name: "Choose time" }));
  const picker = screen.getByRole("dialog", { name: "Time" });
  expect(picker).toHaveClass("ui-sheet");
  const foot = picker.querySelector(".ui-sheet-foot") as HTMLElement;
  for (const name of ["Clear", "Now"])
    expect(within(foot).getByRole("button", { name })).toHaveClass(
      "ui-btn-secondary",
    );
  expect(within(foot).getByRole("button", { name: "Set time" })).toHaveClass(
    "ui-btn-primary",
  );
  // The hour box has the focus and its text selected, so typing replaces it.
  expect(screen.getByLabelText("Hour")).toHaveFocus();
});

it("Cancel closes the picker without changing the value and hands focus back to the calendar button", async () => {
  render(
    <>
      <label htmlFor="date">Date</label>
      <DateTimeInput
        label="Date"
        id="date"
        type="date"
        defaultValue="2026-10-08"
      />
    </>,
  );
  await userEvent.click(screen.getByRole("button", { name: "Choose date" }));
  await userEvent.click(screen.getByRole("button", { name: "Next month" }));
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(
    screen.queryByRole("dialog", { name: "Date" }),
  ).not.toBeInTheDocument();
  expect(screen.getByLabelText("Date")).toHaveValue("2026-10-08");
  expect(screen.getByRole("button", { name: "Choose date" })).toHaveFocus();
});

it("Escape closes the picker even when the key comes from the editor beneath it, before focus has moved in", async () => {
  const dismissed = vi.fn();
  render(
    <Overlay
      open
      title="Edit entry"
      description="Example"
      busy={false}
      onDismiss={dismissed}
      returnFocusId="date"
      fallbackFocusId="date"
    >
      <label htmlFor="date">Date</label>
      <DateTimeInput
        label="Date"
        id="date"
        type="date"
        defaultValue="2024-02-29"
      />
    </Overlay>,
  );
  const trigger = screen.getByRole("button", { name: "Choose date" });
  await userEvent.click(trigger);
  expect(screen.getByRole("dialog", { name: "Date" })).toBeInTheDocument();
  // The same key press, aimed at the button in the editor under the picker (a person who presses Escape the instant it opens).
  fireEvent.keyDown(trigger, { key: "Escape" });
  expect(
    screen.queryByRole("dialog", { name: "Date" }),
  ).not.toBeInTheDocument();
  expect(dismissed).not.toHaveBeenCalled();
});
