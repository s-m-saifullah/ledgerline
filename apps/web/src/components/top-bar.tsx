import type { ReactNode } from "react";

/**
 * The bar across the top of a screen: an optional back control, the page's title (its one h1) and tools such
 * as the privacy and theme switches. The shell (PR 3) decides what a wider screen does with the title.
 */
export function TopBar({
  title,
  back,
  tools,
}: {
  title: string;
  back?: ReactNode;
  tools?: ReactNode;
}) {
  return (
    <div className="ui-topbar">
      {back && <div className="ui-topbar-back">{back}</div>}
      <h1 className="ui-topbar-title">{title}</h1>
      {tools && <div className="ui-topbar-tools">{tools}</div>}
    </div>
  );
}
