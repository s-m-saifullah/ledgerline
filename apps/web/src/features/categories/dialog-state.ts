import type { Category } from "@ledgerline/shared";
import type { CategoryAction } from "./action-dialog";

/** What the owner asked for: an editor (a new category, a new subcategory or an existing one) or a question. */
export type DialogIntent =
  | { kind: "edit"; category?: Category; parentId?: string }
  | { kind: "action"; action: CategoryAction };
/** An intent that is open or waiting on an unconfirmed save. */
export type DialogState = {
  intentId: string;
  open: boolean;
  unconfirmed: boolean;
} & DialogIntent;
