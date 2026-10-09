import { ChevronDown } from "lucide-react";
import type { ComponentProps } from "react";

/** Keep native selection with a consistently inset, decorative arrow. */
export function NativeSelect(props: ComponentProps<"select">) {
  return (
    <div className="theme-picker category-select">
      <select {...props} />
      <ChevronDown size={16} aria-hidden="true" />
    </div>
  );
}
