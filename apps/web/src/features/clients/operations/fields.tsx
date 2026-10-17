import { DateTimeInput } from "../../../components/date-time-input";
import type { OperationForm } from "./form-context";
import { MoneyOrText } from "./money-or-text";
import type { Fields } from "./types";

/** One labelled field of the Clients editor: a date or time box, a money box or plain text. */
export function fieldInput(
  form: OperationForm,
  key: keyof Fields,
  label: string,
  type = "text",
  required = false,
  // A currency makes this a money box (typed from the cents when that preference is on).
  money?: string,
) {
  const { values, setValues, frozen, allowWrite } = form;
  return (
    <label className="form-field" htmlFor={`client-${key}`} key={key}>
      {label}
      {type === "date" || type === "time" ? (
        <DateTimeInput
          label={label}
          id={`client-${key}`}
          type={type}
          value={values[key]}
          required={required}
          disabled={frozen || !allowWrite}
          min={type === "date" ? "0001-01-01" : undefined}
          max={type === "date" ? "9999-12-31" : undefined}
          step={type === "time" ? 60 : undefined}
          onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
        />
      ) : (
        <MoneyOrText
          money={money}
          id={`client-${key}`}
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
          onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
        />
      )}
    </label>
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
  ) =>
    fieldInput(form, key, label, type, required, money);
