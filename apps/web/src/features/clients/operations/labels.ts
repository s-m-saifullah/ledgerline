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
/** What a screen reader hears under the heading; a question says its own sentence, so it has none. */
export function dialogDescription(op: ClientOperation | null) {
  return op?.kind === "receipt"
    ? op.receipt
      ? "Correct the details of one payment you received. Amounts stay as recorded; to change them, delete the receipt and enter it again."
      : "Record money received from this client. It pays their oldest services first, each with its own linked income entry."
    : op?.kind === "payment"
      ? "Record only money actually received. This creates one linked income entry."
      : op?.kind === "service"
        ? "Logging a service creates no income and changes no account balance."
        : op?.kind === "contact"
          ? "Keep clients and their payment history together."
          : undefined;
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
type Action = Extract<ClientOperation, { kind: "action" }>["action"];
/** The one sentence a question asks (ADR 0047: the prototype's `CONFIRM`). */
export const askText: Record<Action, string> = {
  archive: "Their history stays readable.",
  unarchive: "Their history is active again.",
  deleteContact:
    "Delete a client only after their services are deleted. Archive keeps the history.",
  deleteService: "Delete a service only after its payments are deleted.",
  restoreService: "Puts the service back with its payments.",
  writeOff: "Waives only what is unpaid. Money received stays.",
  reopen: "Puts the waived remainder back as owed.",
  deletePayment: "Deletes the payment, its income entry and any tip together.",
  restorePayment: "Puts the payment, its income entry and any tip back.",
  deleteReceipt:
    "Deletes every payment it made, their income entries and any tip together.",
  restoreReceipt: "Puts back every payment, income entry and tip.",
};
/** The word on a question's one button. */
export const askButton: Record<Action, string> = {
  archive: "Archive",
  unarchive: "Unarchive",
  deleteContact: "Delete",
  deleteService: "Delete",
  restoreService: "Restore",
  writeOff: "Write off",
  reopen: "Reopen",
  deletePayment: "Delete",
  restorePayment: "Restore",
  deleteReceipt: "Delete",
  restoreReceipt: "Restore",
};
/** Only a delete is red. */
export const isDelete = (action: Action) => action.startsWith("delete");
/** The label of the sheet's primary button. */
export function submitLabel(op: ClientOperation) {
  return op.kind === "action"
    ? askButton[op.action]
    : op.kind === "payment" || op.kind === "receipt"
      ? op.kind === "receipt" && op.receipt
        ? "Save receipt"
        : "Save payment"
      : op.kind === "service"
        ? "Save service"
        : "Save client";
}
