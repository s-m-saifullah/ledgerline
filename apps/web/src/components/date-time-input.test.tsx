import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { afterEach, expect, it, vi } from "vitest";
import { DateTimeInput } from "./date-time-input";
import { EditorDialog } from "./editor-dialog";

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
    <EditorDialog
      open
      title="Edit entry"
      description="Example"
      busy={false}
      onDismiss={dismissed}
      returnFocusId="date"
      closeLabel="Close editor"
      fallbackFocusId="date"
    >
      <label htmlFor="date">Date</label>
      <DateTimeInput
        label="Date"
        id="date"
        type="date"
        defaultValue="2024-02-29"
      />
    </EditorDialog>,
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
