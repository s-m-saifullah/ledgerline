import {
  ArrowLeftRight,
  BarChart3,
  Coins,
  FileUp,
  HandCoins,
  Home,
  Layers,
  type LucideIcon,
  MoreHorizontal,
  Repeat,
  Settings,
  Shapes,
  Tags,
  Wallet,
} from "lucide-react";

/** One place the navigation can go: its path, its name in the menus and the title, and its icon. */
export type NavPage<Path extends string> = {
  to: Path;
  label: string;
  icon: LucideIcon;
  /** What the command palette calls it, when that differs from the menus. */
  paletteLabel?: string;
};
export type TabPath =
  | "/"
  | "/transactions"
  | "/budgets"
  | "/insights"
  | "/more";
export type MorePath =
  | "/clients"
  | "/loans"
  | "/accounts"
  | "/categories"
  | "/tags"
  | "/currencies"
  | "/recurring"
  | "/import"
  | "/settings";

export const destinations: readonly NavPage<TabPath>[] = [
  { to: "/", label: "Home", icon: Home },
  { to: "/transactions", label: "Transactions", icon: ArrowLeftRight },
  { to: "/budgets", label: "Budgets", icon: Layers },
  { to: "/insights", label: "Insights", icon: BarChart3 },
  { to: "/more", label: "More", icon: MoreHorizontal },
];

/** More's pages in three groups: the desktop sidebar lists them, a phone reaches them through More. */
export const moreGroups: readonly {
  label: string;
  pages: readonly NavPage<MorePath>[];
}[] = [
  {
    label: "Receivables and lending",
    pages: [
      { to: "/clients", label: "Clients", icon: Wallet },
      { to: "/loans", label: "Loans", icon: HandCoins },
    ],
  },
  {
    label: "Money setup",
    pages: [
      { to: "/accounts", label: "Accounts", icon: Wallet },
      { to: "/categories", label: "Categories", icon: Shapes },
      { to: "/tags", label: "Tags", icon: Tags },
      { to: "/currencies", label: "Currencies", icon: Coins },
      { to: "/recurring", label: "Recurring", icon: Repeat },
    ],
  },
  {
    label: "Data and preferences",
    pages: [
      // Named "Import" until the page becomes Import and export (ADR 0047, PR 6).
      {
        to: "/import",
        label: "Import",
        icon: FileUp,
        paletteLabel: "Import from CSV",
      },
      { to: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

export const morePages = moreGroups.flatMap((group) => group.pages);

const isMorePage = (pathname: string) =>
  morePages.some((page) => page.to === pathname);

/** The More tab stays highlighted on More and on every page reached from it. */
export const isActiveDestination = (to: string, pathname: string) =>
  to === "/more"
    ? pathname === "/more" || isMorePage(pathname)
    : pathname === to;

/** The page's name, for the document title, the top bar and the screen-reader announcement. */
export function pageTitle(pathname: string) {
  return (
    [...destinations, ...morePages].find((page) => page.to === pathname)
      ?.label ?? "Home"
  );
}

/** A page opened from More has a back arrow in a phone's top bar. */
export const backsToMore = isMorePage;

/**
 * Whether a phone shows its Add button here: on every page but More, Settings and Import, where there is
 * nothing to add. It adds a transaction everywhere until a page registers its own add (Clients is the first).
 */
export const showsAdd = (pathname: string) =>
  !["/more", "/settings", "/import"].includes(pathname);
