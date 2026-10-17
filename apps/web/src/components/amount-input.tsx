import { currencyDigits } from "@ledgerline/shared";
import {
  type ChangeEvent,
  type ClipboardEvent,
  type ComponentPropsWithoutRef,
  type FocusEvent,
  forwardRef,
  useContext,
  useRef,
} from "react";
import { AmountEntryContext } from "../features/shell/preferences";
import {
  amountPlaceholder,
  centsFirstValue,
  pastedValue,
} from "./amount-entry";

type Props = ComponentPropsWithoutRef<"input"> & {
  /** Sets how many decimals the box has (USD 2, JPY 0, BHD 3). */
  currency?: string;
};

/**
 * A money box. With the "type amounts from the cents" preference off it is an ordinary input;
 * with it on, typed digits fill in from the right. Either way the box holds a plain decimal
 * string, so forms, validation and the API see the same value.
 */
export const AmountInput = forwardRef<HTMLInputElement, Props>(
  function AmountInput(
    { currency = "USD", onChange, onFocus, onPaste, onClick, ...rest },
    forwarded,
  ) {
    const { centsFirst } = useContext(AmountEntryContext);
    const own = useRef<HTMLInputElement | null>(null);
    // What the box held before the current keystroke.
    const previous = useRef("");
    const setRefs = (node: HTMLInputElement | null) => {
      own.current = node;
      if (typeof forwarded === "function") forwarded(node);
      else if (forwarded) forwarded.current = node;
    };
    if (!centsFirst)
      return (
        <input
          ref={setRefs}
          onChange={onChange}
          onFocus={onFocus}
          onPaste={onPaste}
          onClick={onClick}
          {...rest}
        />
      );
    const digits = currencyDigits(currency);
    const toEnd = () => {
      const node = own.current;
      if (!node) return;
      try {
        node.setSelectionRange(node.value.length, node.value.length);
      } catch {
        // Some input types cannot hold a selection; the caret is then wherever the browser puts it.
      }
    };
    const publish = (event: ChangeEvent<HTMLInputElement>, value: string) => {
      event.target.value = value;
      previous.current = value;
      onChange?.(event);
      requestAnimationFrame(toEnd);
    };
    return (
      <input
        ref={setRefs}
        {...rest}
        inputMode="numeric"
        placeholder={rest.placeholder ?? amountPlaceholder(digits)}
        onFocus={(event: FocusEvent<HTMLInputElement>) => {
          previous.current = event.target.value;
          onFocus?.(event);
          requestAnimationFrame(toEnd);
        }}
        onClick={(event) => {
          toEnd();
          onClick?.(event);
        }}
        onChange={(event) => {
          publish(
            event,
            centsFirstValue(previous.current, event.target.value, digits),
          );
        }}
        onPaste={(event: ClipboardEvent<HTMLInputElement>) => {
          onPaste?.(event);
          if (event.defaultPrevented) return;
          event.preventDefault();
          const value = pastedValue(
            event.clipboardData.getData("text"),
            digits,
          );
          if (value === null) return;
          event.currentTarget.value = value;
          previous.current = value;
          onChange?.({
            target: event.currentTarget,
            currentTarget: event.currentTarget,
            type: "change",
          } as ChangeEvent<HTMLInputElement>);
        }}
      />
    );
  },
);
