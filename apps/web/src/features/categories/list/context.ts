import type { Category } from "@ledgerline/shared";
import type { UseQueryResult } from "@tanstack/react-query";
import type { Dispatch, SetStateAction } from "react";
import type { CategoryAction } from "../action-dialog";
import type { useCategoryMergeWorkspace } from "../merge-workspace";
import type { useCategoryReorder } from "../reorder";

export type DialogState = {
  intentId: string;
  open: boolean;
  unconfirmed: boolean;
} & (
  | { kind: "edit"; category?: Category }
  | { kind: "action"; action: CategoryAction }
);
export type DialogIntent =
  | { kind: "edit"; category?: Category }
  | { kind: "action"; action: CategoryAction };
export type CategoryGroup = {
  root: Category;
  children: Category[];
  showRoot: boolean;
};

/** What the category list pieces read from the page (one object, no hidden state). */
export type CategoriesViewContext = {
  items: Category[];
  groups: CategoryGroup[];
  writable: boolean;
  phone: boolean;
  locked: boolean;
  query: UseQueryResult<Category[]>;
  dialog: DialogState | null;
  setDialog: Dispatch<SetStateAction<DialogState | null>>;
  notice: string;
  setNotice: (notice: string) => void;
  reorder: ReturnType<typeof useCategoryReorder>;
  merge: ReturnType<typeof useCategoryMergeWorkspace>;
  start: (intent: DialogIntent) => void;
  kind: Category["kind"];
  setKind: (kind: Category["kind"]) => void;
  status: "all" | "active" | "archived";
  setStatus: (status: "all" | "active" | "archived") => void;
  search: string;
  setSearch: (search: string) => void;
};
