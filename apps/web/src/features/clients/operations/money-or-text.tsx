import type { ComponentPropsWithoutRef } from "react";
import { AmountInput } from "../../../components/amount-input";

/** A money box when a currency is given, otherwise a plain text input. */
export function MoneyOrText({
  money,
  ...rest
}: { money: string | undefined } & ComponentPropsWithoutRef<"input">) {
  return money ? (
    <AmountInput currency={money} {...rest} />
  ) : (
    <input {...rest} />
  );
}
