import { DateTimeInput } from "../../../components/date-time-input";
import type { OperationForm } from "./form-context";
import { MoneyOrText } from "./money-or-text";
import type { Fields } from "./types";
import "./editors.css";

/** One labelled field of a Clients editor: a date or time box, a money box, a text area or plain text. */
export function fieldInput(
  form: OperationForm,
  key: keyof Fields,
  label: string,
  type = "text",
  required = false,
  // A currency makes this a money box (typed from the cents when that preference is on).
  money?: string,
  multiline = false,
  // A row has its label on the left and its value on the right, as the prototype's `inputRow` (dates and times always are).
  row = false,
) {
  const { values, setValues, frozen, allowWrite } = form;
  const id = `client-${key}`;
  const change = (value: string) => setValues((v) => ({ ...v, [key]: value }));
  const asRow = row || type === "date" || type === "time";
  return (
    <div className={asRow ? "ed-row" : "ed-field"} key={key}>
      <label htmlFor={id}>{label}</label>
      {type === "date" || type === "time" ? (
        <DateTimeInput
          label={label}
          id={id}
          type={type}
          value={values[key]}
          required={required}
          disabled={frozen || !allowWrite}
          min={type === "date" ? "0001-01-01" : undefined}
          max={type === "date" ? "9999-12-31" : undefined}
          step={type === "time" ? 60 : undefined}
          onChange={(e) => change(e.target.value)}
        />
      ) : multiline ? (
        <textarea
          id={id}
          rows={3}
          value={values[key]}
          required={required}
          disabled={frozen || !allowWrite}
          maxLength={2000}
          onChange={(e) => change(e.target.value)}
        />
      ) : (
        <MoneyOrText
          money={money}
          id={id}
          type={type}
          value={values[key]}
          required={required}
          disabled={frozen || !allowWrite}
          maxLength={
            key === "description" || key === "note" || key === "reason"
              ? 2000
              : key === "email"
                ? 254
                : 100
          }
          onChange={(e) => change(e.target.value)}
        />
      )}
    </div>
  );
}
/** `fieldInput` with the form filled in, for the render functions that call it many times. */
export const inputFor =
  (form: OperationForm) =>
  (
    key: keyof Fields,
    label: string,
    type?: string,
    required?: boolean,
    money?: string,
    multiline?: boolean,
    row?: boolean,
  ) =>
    fieldInput(form, key, label, type, required, money, multiline, row);
