import * as Dialog from "@radix-ui/react-dialog";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  X,
} from "lucide-react";
import { type ComponentProps, useEffect, useRef, useState } from "react";
import { to24Hour } from "../lib/time";
import { NativeSelect } from "./native-select";

const months = Array.from({ length: 12 }, (_, month) =>
  new Intl.DateTimeFormat("en-US", { month: "long" }).format(
    new Date(2026, month, 1),
  ),
);
// Calendar arithmetic is independent of timezone offsets and skipped civil days.
/** Newest first: the last 100 years and the next 10, plus a few years around the one shown when it lies outside that range. */
function yearChoices(shown: number) {
  const now = new Date().getFullYear();
  const years = new Set<number>();
  for (let year = now - 100; year <= now + 10; year++) years.add(year);
  for (let year = shown - 5; year <= shown + 5; year++) years.add(year);
  return [...years]
    .filter((year) => year >= 1 && year <= 9999)
    .sort((a, b) => b - a);
}
function calendarDate(year: number, month: number, day: number) {
  const date = new Date(0);
  date.setUTCFullYear(year, month, day);
  date.setUTCHours(12, 0, 0, 0);
  return date;
}
function dateValue(date: Date) {
  return `${String(date.getUTCFullYear()).padStart(4, "0")}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}
function parseDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year = 0, month = 0, day = 0] = value.split("-").map(Number);
  const date = calendarDate(year, month - 1, day);
  return dateValue(date) === value ? date : null;
}

/** Typed local dates/times plus themed pickers; no timezone conversion. */
export function DateTimeInput({
  label,
  type,
  ref,
  ...props
}: ComponentProps<"input"> & { label: string; type: "date" | "time" }) {
  const input = useRef<HTMLInputElement | null>(null);
  const calendar = useRef<HTMLDivElement | null>(null);
  const hourInput = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const now = new Date();
  const today = dateValue(
    calendarDate(now.getFullYear(), now.getMonth(), now.getDate()),
  );
  const minimum = typeof props.min === "string" ? props.min : "0001-01-01";
  const maximum = typeof props.max === "string" ? props.max : "9999-12-31";
  const clamp = (value: string) =>
    value < minimum ? minimum : value > maximum ? maximum : value;
  const [focused, setFocused] = useState(today);
  const [month, setMonth] = useState(new Date().getMonth());
  const [year, setYear] = useState(new Date().getFullYear());
  // The picker reads and shows a 12-hour clock; the field keeps the 24-hour HH:mm value.
  const [hour, setHour] = useState("12");
  const [minute, setMinute] = useState("00");
  const [period, setPeriod] = useState<"AM" | "PM">("PM");
  const blocked = () =>
    !input.current ||
    input.current.matches(":disabled") ||
    input.current.readOnly;
  function choose(value: string) {
    if (blocked()) return;
    const field = input.current;
    if (!field) return;
    // Use the native setter so React and React Hook Form receive a real change.
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
    setOpen(false);
  }
  function show() {
    if (blocked()) return;
    const value = input.current?.value ?? "";
    if (type === "date") {
      const selected =
        parseDate(clamp(value || today)) ??
        calendarDate(now.getFullYear(), now.getMonth(), now.getDate());
      setMonth(selected.getUTCMonth());
      setYear(selected.getUTCFullYear());
      setFocused(dateValue(selected));
    } else {
      const [h24, m] = /^\d{2}:\d{2}$/.test(value)
        ? value.split(":").map(Number)
        : [new Date().getHours(), new Date().getMinutes()];
      const h24Safe = h24 ?? 12;
      setHour(String(h24Safe % 12 || 12));
      setMinute(String(m ?? 0).padStart(2, "0"));
      setPeriod(h24Safe >= 12 ? "PM" : "AM");
    }
    setOpen(true);
  }
  useEffect(() => {
    if (
      open &&
      type === "date" &&
      (document.activeElement === document.body ||
        calendar.current?.contains(document.activeElement))
    )
      calendar.current
        ?.querySelector<HTMLButtonElement>(`[data-date="${focused}"]`)
        ?.focus();
  }, [open, type, focused]);
  function moveMonth(offset: number) {
    const next = calendarDate(year, month + offset, 1);
    if (next.getUTCFullYear() < 1 || next.getUTCFullYear() > 9999) return;
    setMonth(next.getUTCMonth());
    setYear(next.getUTCFullYear());
    setFocused(clamp(dateValue(next)));
  }
  const start = calendarDate(year, month, 1);
  const days = Array.from({ length: 42 }, (_, index) =>
    calendarDate(year, month, index - start.getUTCDay() + 1),
  );
  const chosenTime = to24Hour(hour, minute, period);
  return (
    <div className="date-time-field">
      <input
        {...props}
        type={type}
        ref={(element) => {
          input.current = element;
          if (typeof ref === "function") return ref(element);
          if (ref) ref.current = element;
        }}
      />
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Trigger asChild>
          <button
            type="button"
            className="date-time-trigger"
            aria-label={`Choose ${label.toLowerCase()}`}
            disabled={props.disabled || props.readOnly}
            onClick={show}
          >
            {type === "date" ? (
              <CalendarDays size={19} aria-hidden="true" />
            ) : (
              <Clock3 size={19} aria-hidden="true" />
            )}
          </button>
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay date-time-overlay" />
          <Dialog.Content
            className="date-time-picker"
            // Radix sometimes does not treat this nested picker as the top layer and
            // ignores its Escape, so close it here and keep the key from the dialog below.
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.preventDefault();
              event.stopPropagation();
              setOpen(false);
            }}
            onEscapeKeyDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setOpen(false);
            }}
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              if (type === "date") {
                calendar.current
                  ?.querySelector<HTMLButtonElement>(`[data-date="${focused}"]`)
                  ?.focus();
              } else {
                hourInput.current?.focus();
                hourInput.current?.select();
              }
            }}
          >
            <div className="date-time-heading">
              <Dialog.Title>{label}</Dialog.Title>
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Close picker"
                >
                  <X size={19} />
                </button>
              </Dialog.Close>
            </div>
            <Dialog.Description className="sr-only">
              {type === "date"
                ? "Choose a date. Use arrow keys to move by day, or Page Up and Page Down to change month."
                : "Choose the local time with hours 1 to 12 and AM or PM. Leave it blank if unknown."}
            </Dialog.Description>
            {type === "date" ? (
              <>
                <div className="calendar-heading">
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="Previous month"
                    disabled={year === 1 && month === 0}
                    onClick={() => moveMonth(-1)}
                  >
                    <ChevronLeft size={18} />
                  </button>
                  <NativeSelect
                    aria-label="Calendar month"
                    value={month}
                    onChange={(event) => {
                      const next = Number(event.target.value);
                      setMonth(next);
                      setFocused(clamp(dateValue(calendarDate(year, next, 1))));
                    }}
                  >
                    {months.map((name, index) => (
                      <option value={index} key={name}>
                        {name}
                      </option>
                    ))}
                  </NativeSelect>
                  <NativeSelect
                    aria-label="Calendar year"
                    value={year}
                    onChange={(event) => {
                      const next = Number(event.target.value);
                      if (Number.isInteger(next) && next >= 1 && next <= 9999) {
                        setYear(next);
                        setFocused(
                          clamp(dateValue(calendarDate(next, month, 1))),
                        );
                      }
                    }}
                  >
                    {yearChoices(year).map((choice) => (
                      <option value={choice} key={choice}>
                        {choice}
                      </option>
                    ))}
                  </NativeSelect>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="Next month"
                    disabled={year === 9999 && month === 11}
                    onClick={() => moveMonth(1)}
                  >
                    <ChevronRight size={18} />
                  </button>
                </div>
                <div className="calendar-weekdays" aria-hidden="true">
                  {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((day) => (
                    <span key={day}>{day}</span>
                  ))}
                </div>
                <div className="calendar-days" ref={calendar}>
                  {days.map((date) => {
                    const value = dateValue(date),
                      outside = date.getUTCMonth() !== month;
                    return (
                      <button
                        type="button"
                        key={value}
                        data-date={value}
                        className={`${outside ? "outside-month" : ""}${value === input.current?.value ? " selected-day" : ""}`}
                        disabled={
                          date.getUTCFullYear() < 1 ||
                          date.getUTCFullYear() > 9999 ||
                          value < minimum ||
                          value > maximum
                        }
                        tabIndex={value === focused ? 0 : -1}
                        aria-label={value}
                        aria-pressed={value === input.current?.value}
                        aria-current={value === today ? "date" : undefined}
                        onClick={() => choose(value)}
                        onKeyDown={(event) => {
                          const offset = {
                            ArrowLeft: -1,
                            ArrowRight: 1,
                            ArrowUp: -7,
                            ArrowDown: 7,
                            Home: -date.getUTCDay(),
                            End: 6 - date.getUTCDay(),
                          }[event.key];
                          if (
                            event.key === "PageUp" ||
                            event.key === "PageDown"
                          ) {
                            event.preventDefault();
                            moveMonth(event.key === "PageUp" ? -1 : 1);
                          } else if (offset !== undefined) {
                            event.preventDefault();
                            const next = calendarDate(
                              date.getUTCFullYear(),
                              date.getUTCMonth(),
                              date.getUTCDate() + offset,
                            );
                            const bounded = parseDate(clamp(dateValue(next)));
                            if (bounded) {
                              setFocused(dateValue(bounded));
                              setMonth(bounded.getUTCMonth());
                              setYear(bounded.getUTCFullYear());
                            }
                          }
                        }}
                      >
                        {date.getUTCDate()}
                      </button>
                    );
                  })}
                </div>
                <div className="date-time-actions">
                  {!props.required && (
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => choose("")}
                    >
                      Clear
                    </button>
                  )}
                  <button
                    type="button"
                    className="button"
                    disabled={today < minimum || today > maximum}
                    onClick={() => choose(today)}
                  >
                    Today
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="time-format-hint">12-hour local time</p>
                <div className="time-columns">
                  <label>
                    Hour
                    <input
                      ref={hourInput}
                      type="text"
                      inputMode="numeric"
                      maxLength={2}
                      value={hour}
                      onChange={(event) => setHour(event.target.value)}
                    />
                  </label>
                  <span aria-hidden="true">:</span>
                  <label>
                    Minute
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={2}
                      value={minute}
                      onChange={(event) => setMinute(event.target.value)}
                    />
                  </label>
                </div>
                <fieldset className="time-period" aria-label="AM or PM">
                  {(["AM", "PM"] as const).map((value) => (
                    <button
                      type="button"
                      className="secondary-button time-period-button"
                      key={value}
                      aria-pressed={period === value}
                      onClick={() => setPeriod(value)}
                    >
                      {value}
                    </button>
                  ))}
                </fieldset>
                <fieldset
                  className="time-presets"
                  aria-label="Minute shortcuts"
                >
                  {["00", "15", "30", "45"].map((value) => (
                    <button
                      type="button"
                      className="secondary-button"
                      key={value}
                      aria-pressed={minute === value}
                      onClick={() => setMinute(value)}
                    >
                      :{value}
                    </button>
                  ))}
                </fieldset>
                <div className="date-time-actions">
                  {!props.required && (
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => choose("")}
                    >
                      Clear
                    </button>
                  )}
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => {
                      const now = new Date();
                      setHour(String(now.getHours() % 12 || 12));
                      setMinute(String(now.getMinutes()).padStart(2, "0"));
                      setPeriod(now.getHours() >= 12 ? "PM" : "AM");
                    }}
                  >
                    Now
                  </button>
                  <button
                    type="button"
                    className="button"
                    disabled={!chosenTime}
                    onClick={() => chosenTime && choose(chosenTime)}
                  >
                    Set time
                  </button>
                </div>
              </>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
