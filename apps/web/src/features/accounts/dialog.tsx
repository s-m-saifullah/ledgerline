import type { ComponentProps } from "react";
import { EditorDialog } from "../../components/editor-dialog";

export function AccountDialog(
  props: Omit<
    ComponentProps<typeof EditorDialog>,
    "closeLabel" | "returnFocusId" | "fallbackFocusId"
  > & { returnFocusId?: string },
) {
  return (
    <EditorDialog
      {...props}
      returnFocusId={props.returnFocusId ?? "accounts-title"}
      closeLabel="Close account dialog"
      fallbackFocusId="accounts-title"
    />
  );
}
