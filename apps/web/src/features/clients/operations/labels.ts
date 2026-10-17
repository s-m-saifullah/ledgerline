import { type ClientOperation, names } from "./types";

/** The dialog heading for the current operation. */
export function dialogTitle(op: ClientOperation | null) {
  return op?.kind === "receipt"
    ? op.receipt
      ? "Edit receipt"
      : `Record payment from ${op.client.name}`
    : op?.kind === "contact"
      ? op.client
        ? "Edit client"
        : "Add client"
      : op?.kind === "service"
        ? op.service
          ? "Edit service"
          : "Log service"
        : op?.kind === "payment"
          ? op.payment
            ? "Edit payment"
            : "Record payment"
          : op?.kind === "action"
            ? names[op.action]
            : "Payment details";
}
/** The sentence under the heading. */
export function dialogDescription(op: ClientOperation | null) {
  return op?.kind === "receipt"
    ? op.receipt
      ? "Correct the details of one payment you received. Amounts stay as recorded; to change them, delete the receipt and enter it again."
      : "Record money received from this client. It pays their oldest services first, each with its own linked income entry."
    : op?.kind === "payment"
      ? "Record only money actually received. This creates one linked income entry."
      : op?.kind === "service"
        ? "Logging a service creates no income and changes no account balance."
        : "Keep clients and their payment history together.";
}
/** The element that gets focus when the dialog opens. */
export function dialogInitialFocus(
  op: ClientOperation | null,
  uncertain: boolean,
) {
  return uncertain
    ? "client-retry"
    : op?.kind === "payment" || (op?.kind === "receipt" && !op.receipt)
      ? "client-amount"
      : op?.kind === "service"
        ? "client-description"
        : op?.kind === "contact"
          ? "client-name"
          : undefined;
}
/** The label of the dialog's submit button. */
export function submitLabel(op: ClientOperation) {
  return op.kind === "action"
    ? "Confirm"
    : op.kind === "payment" || op.kind === "receipt"
      ? op.kind === "receipt" && op.receipt
        ? "Save receipt"
        : "Save payment"
      : op.kind === "service"
        ? "Save service"
        : "Save client";
}
