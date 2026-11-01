import { createContext, useContext, useEffect, useRef } from "react";

/** What a phone's one Add button does on a page that adds something other than a transaction (ADR 0047). */
export type PageAdd = {
  /** The button's name for assistive technology, such as "Add client". */
  label: string;
  disabled: boolean;
  onClick: () => void;
};

/** The shell provides the setter; outside a shell it does nothing. */
const Context = createContext<(add: PageAdd | null) => void>(() => {});
export const PageAddProvider = Context.Provider;

/**
 * A page that adds its own thing says so while it is on screen; the shell's Add button then carries its label
 * and runs it, and goes back to adding a transaction when the page leaves. The click handler is read when the
 * button is pressed, so the page may pass a new one on every render.
 */
export function usePageAdd(add: PageAdd | null) {
  const set = useContext(Context);
  const press = useRef(add?.onClick);
  press.current = add?.onClick;
  const label = add?.label;
  const disabled = add?.disabled ?? false;
  useEffect(() => {
    set(
      label === undefined
        ? null
        : { label, disabled, onClick: () => press.current?.() },
    );
  }, [set, label, disabled]);
  useEffect(() => () => set(null), [set]);
}
