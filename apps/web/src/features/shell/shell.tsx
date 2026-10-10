import * as Dialog from "@radix-ui/react-dialog";
import { useQuery } from "@tanstack/react-query";
import {
  Link,
  Outlet,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import {
  ArrowLeftRight,
  ArrowUpRight,
  BarChart3,
  ChevronRight,
  Command,
  Eye,
  EyeOff,
  Home,
  Layers,
  LogOut,
  Moon,
  MoreHorizontal,
  Plus,
  Search,
  Shapes,
  Sun,
  Wallet,
  X,
} from "lucide-react";
import { useContext, useEffect, useRef, useState } from "react";
import { api, getLedgers, type Session } from "../../lib/api";
import { QuickAdd } from "../transactions/quick-add";
import { TransactionWorkspace } from "../transactions/workspace";
import { type Preferences, ThemeContext } from "./preferences";

const destinations = [
  { to: "/", label: "Home", icon: Home },
  { to: "/transactions", label: "Transactions", icon: ArrowLeftRight },
  { to: "/budgets", label: "Budgets", icon: Layers },
  { to: "/insights", label: "Insights", icon: BarChart3 },
  { to: "/more", label: "More", icon: MoreHorizontal },
] as const;

export function Shell({
  session,
  onSignOut,
  preferences,
}: {
  session: Session;
  preferences: Preferences;
  onSignOut: () => Promise<void>;
}) {
  const navigate = useNavigate();
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const currentPage =
    pathname === "/more/accounts"
      ? "Accounts"
      : pathname === "/more/categories"
        ? "Categories"
        : pathname === "/more/people"
          ? "People"
          : (destinations.find(({ to }) => to === pathname)?.label ?? "Home");
  const ledgers = useQuery({ queryKey: ["ledgers"], queryFn: getLedgers });
  const ledger = ledgers.data?.items[0];
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [addTrigger, setAddTrigger] = useState("add-transaction");
  const paletteToAdd = useRef(false);
  const openAdd = (trigger: string) => {
    setAddTrigger(trigger);
    setQuickAddOpen(true);
  };
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (quickAddOpen) return;
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [quickAddOpen]);
  const signOut = async () => {
    try {
      await api("/auth/sign-out", { method: "POST", body: "{}" });
      await onSignOut();
    } catch {
      setError("Couldn't sign out. Please try again.");
    }
  };
  const content = (
    <div className="app-layout">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside className="sidebar">
        <a href="/" className="brand">
          <span className="brand-mark">
            L<span>↗</span>
          </span>
          Ledgerline
        </a>
        <button
          type="button"
          className="button add-button"
          id="add-transaction"
          disabled={!ledger || ledger.role === "viewer"}
          title={
            ledger?.role === "viewer"
              ? "Read-only ledger"
              : "Record income or an expense"
          }
          onClick={() => openAdd("add-transaction")}
        >
          <Plus size={18} />
          Add transaction
        </button>
        <nav aria-label="Main navigation">
          {destinations.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              activeOptions={{ exact: to !== "/more" }}
              activeProps={{ className: "active", "aria-current": "page" }}
            >
              <Icon size={20} />
              {label}
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button
            type="button"
            id="open-navigation"
            className="quiet-button search-button"
            onClick={() => setPaletteOpen(true)}
          >
            <Search size={18} />
            Jump to<kbd>⌘ K</kbd>
          </button>
          <div className="owner">
            <span className="avatar">{session.user.name.slice(0, 1)}</span>
            <div>
              <strong>{session.user.name}</strong>
              <span className="owner-role">Owner</span>
            </div>
            <button
              type="button"
              className="icon-button"
              aria-label="Sign out"
              onClick={signOut}
            >
              <LogOut size={18} />
            </button>
          </div>
          <AppVersion />
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <Link to="/" className="mobile-brand" aria-label="Ledgerline home">
            <span className="brand-mark" aria-hidden="true">
              L<span>↗</span>
            </span>
          </Link>
          <div className="topbar-context">
            <span>Personal ledger</span>
            <ChevronRight size={14} aria-hidden="true" />
            <span className="topbar-page">{currentPage}</span>
          </div>
          <div className="topbar-actions">
            <button
              type="button"
              className="icon-button"
              aria-label={
                preferences.privateMode ? "Show amounts" : "Hide amounts"
              }
              aria-pressed={preferences.privateMode}
              onClick={() =>
                preferences.setPrivateMode(!preferences.privateMode)
              }
            >
              {preferences.privateMode ? (
                <EyeOff size={19} />
              ) : (
                <Eye size={19} />
              )}
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label={
                preferences.resolvedTheme === "dark"
                  ? "Switch to light theme"
                  : "Switch to dark theme"
              }
              title={
                preferences.resolvedTheme === "dark"
                  ? "Switch to light theme"
                  : "Switch to dark theme"
              }
              onClick={() =>
                preferences.setTheme(
                  preferences.resolvedTheme === "dark" ? "light" : "dark",
                )
              }
            >
              {preferences.resolvedTheme === "dark" ? (
                <Sun size={19} aria-hidden="true" />
              ) : (
                <Moon size={19} aria-hidden="true" />
              )}
            </button>
            <button
              type="button"
              className="icon-button mobile-signout"
              aria-label="Sign out"
              onClick={signOut}
            >
              <LogOut size={18} />
            </button>
          </div>
        </header>
        {error && (
          <p role="alert" className="field-error">
            {error}
          </p>
        )}
        <main id="main-content" className="main-content" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
      <nav className="bottom-nav" aria-label="Mobile navigation">
        <button
          type="button"
          className="mobile-add"
          id="mobile-add-transaction"
          aria-label="Add transaction"
          disabled={!ledger || ledger.role === "viewer"}
          onClick={() => openAdd("mobile-add-transaction")}
        >
          <Plus size={24} />
        </button>
        {destinations.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            activeOptions={{ exact: to !== "/more" }}
            activeProps={{ className: "active", "aria-current": "page" }}
          >
            <Icon size={20} />
            <span>{label}</span>
          </Link>
        ))}
      </nav>
      {ledgers.isError && (
        <p role="alert" className="shell-ledger-error">
          Couldn't load your ledger.{" "}
          <button
            type="button"
            className="quiet-button"
            onClick={() => void ledgers.refetch()}
          >
            Try again
          </button>
        </p>
      )}
      {ledger && (
        <QuickAdd
          key={`${session.user.id}:${ledger.id}`}
          actorId={session.user.id}
          ledgerId={ledger.id}
          writable={ledger.role !== "viewer"}
          open={quickAddOpen}
          onDismiss={() => setQuickAddOpen(false)}
          returnFocusId={addTrigger}
        />
      )}
      <Dialog.Root open={paletteOpen} onOpenChange={setPaletteOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content
            className="command-dialog"
            onCloseAutoFocus={(event) => {
              if (paletteToAdd.current) {
                event.preventDefault();
                paletteToAdd.current = false;
              }
            }}
          >
            <Dialog.Title>
              <Command size={20} />
              Go to
            </Dialog.Title>
            <Dialog.Description className="muted">
              Type to find a page or action.
            </Dialog.Description>
            <PaletteList
              items={[
                {
                  key: "add",
                  label: "Add transaction",
                  icon: Plus,
                  disabled: !ledger || ledger.role === "viewer",
                  run: () => {
                    paletteToAdd.current = true;
                    setPaletteOpen(false);
                    openAdd("open-navigation");
                  },
                },
                ...[
                  ...destinations,
                  {
                    to: "/more/accounts",
                    label: "Accounts",
                    icon: Wallet,
                  } as const,
                  {
                    to: "/more/categories",
                    label: "Categories",
                    icon: Shapes,
                  } as const,
                  {
                    to: "/more/people",
                    label: "People",
                    icon: Wallet,
                  } as const,
                ].map(({ to, label, icon }) => ({
                  key: to,
                  label,
                  icon,
                  run: () => {
                    setPaletteOpen(false);
                    void navigate({ to });
                  },
                })),
                ...(["light", "dark", "system"] as const).map((value) => ({
                  key: `theme-${value}`,
                  label: `Theme: ${value[0]?.toUpperCase()}${value.slice(1)}`,
                  icon:
                    value === "dark" ? Moon : value === "light" ? Sun : Command,
                  run: () => {
                    preferences.setTheme(value);
                    setPaletteOpen(false);
                  },
                })),
                {
                  key: "privacy",
                  label: preferences.privateMode
                    ? "Show amounts"
                    : "Hide amounts",
                  icon: preferences.privateMode ? EyeOff : Eye,
                  run: () => {
                    preferences.setPrivateMode(!preferences.privateMode);
                    setPaletteOpen(false);
                  },
                },
                {
                  key: "sign-out",
                  label: "Sign out",
                  icon: LogOut,
                  run: () => {
                    setPaletteOpen(false);
                    void signOut();
                  },
                },
              ]}
            />
            <Dialog.Close
              className="dialog-close icon-button"
              aria-label="Close navigation"
            >
              <X size={20} />
            </Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
  return (
    <TransactionWorkspace
      key={`${session.user.id}:${ledger?.id ?? "no-ledger"}`}
      ledgerId={ledger?.id}
      actorId={session.user.id}
      writable={!!ledger && ledger.role !== "viewer"}
    >
      {content}
    </TransactionWorkspace>
  );
}

type PaletteItem = {
  key: string;
  label: string;
  icon: typeof Home;
  disabled?: boolean;
  run: () => void;
};
/** Search box plus filtered actions; arrows move between them and Enter runs the first match. */
function PaletteList({ items }: { items: PaletteItem[] }) {
  const [query, setQuery] = useState("");
  const list = useRef<HTMLFieldSetElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const shown = items.filter((item) =>
    item.label.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const options = () =>
    Array.from(
      list.current?.querySelectorAll<HTMLButtonElement>(
        "button:not(:disabled)",
      ) ?? [],
    );
  return (
    <>
      <input
        ref={search}
        type="search"
        className="command-search"
        aria-label="Search pages and actions"
        placeholder="Search pages and actions"
        autoComplete="off"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            options()[0]?.focus();
          } else if (event.key === "Enter") {
            event.preventDefault();
            options()[0]?.click();
          }
        }}
      />
      <div className="command-scroll">
        <fieldset
          ref={list}
          className="command-results"
          onKeyDown={(event) => {
            if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
            event.preventDefault();
            const all = options();
            const index = all.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            const next = index + (event.key === "ArrowDown" ? 1 : -1);
            if (next < 0) search.current?.focus();
            else all[Math.min(next, all.length - 1)]?.focus();
          }}
        >
          <legend className="sr-only">Results</legend>
          {shown.map(({ key, label, icon: Icon, disabled, run }) => (
            <button
              key={key}
              type="button"
              className="command-option"
              disabled={disabled ?? false}
              onClick={run}
            >
              <Icon size={18} />
              {label}
              <ArrowUpRight size={16} />
            </button>
          ))}
          {shown.length === 0 && (
            <p className="muted" role="status">
              Nothing matches “{query.trim()}”.
            </p>
          )}
        </fieldset>
      </div>
    </>
  );
}

export function EmptyPage({
  title,
  description,
  icon: Icon,
}: {
  title: string;
  description: string;
  icon: typeof Home;
}) {
  return (
    <>
      <div className="page-heading">
        <p className="eyebrow">YOUR PERSONAL LEDGER</p>
        <h1>{title}</h1>
        <p className="muted">{description}</p>
      </div>
      <section className="welcome-card">
        <div className="small-mark">
          <Icon size={28} />
        </div>
        <h2>A little more clarity is on its way.</h2>
        <p>This part of your ledger is coming soon.</p>
      </section>
    </>
  );
}
/** The deployed release tag, small and quiet. */
export function AppVersion() {
  return (
    <p className="app-version" data-testid="app-version">
      Ledgerline {__APP_VERSION__}
    </p>
  );
}

export function MorePage() {
  const { theme, setTheme } = useContext(ThemeContext);
  return (
    <>
      <div className="page-heading">
        <p className="eyebrow">MAKE IT YOURS</p>
        <h1>Your space.</h1>
        <p className="muted">
          The little details that make your ledger feel like home.
        </p>
      </div>
      <section className="settings-card">
        <Link to="/more/accounts" className="settings-link">
          <span className="account-icon">
            <Wallet size={22} />
          </span>
          <div>
            <h2>Accounts</h2>
            <p>Manage your bank accounts, cards, wallets, and balances.</p>
          </div>
          <ChevronRight size={20} aria-hidden="true" />
        </Link>
      </section>
      <section className="settings-card">
        <Link to="/more/categories" className="settings-link">
          <span className="account-icon">
            <Shapes size={22} />
          </span>
          <div>
            <h2>Categories</h2>
            <p>
              Create, organize and style your income and expense categories.
            </p>
          </div>
          <ChevronRight size={20} aria-hidden="true" />
        </Link>
      </section>
      <section className="settings-card">
        <Link to="/more/people" className="settings-link">
          <span className="account-icon">
            <Wallet size={22} />
          </span>
          <div>
            <h2>People</h2>
            <p>Track unpaid services, payments and money owed to you.</p>
          </div>
          <ChevronRight size={20} aria-hidden="true" />
        </Link>
      </section>
      <section className="settings-card">
        <h2>Appearance & privacy</h2>
        <fieldset className="theme-choice">
          <legend>Theme</legend>
          {(
            [
              ["light", "Light"],
              ["dark", "Dark"],
              ["system", "System"],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="theme-option">
              <input
                type="radio"
                name="theme"
                value={value}
                checked={theme === value}
                onChange={() => setTheme(value)}
              />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>
        <p className="muted">
          System follows your device. The sun or moon button in the header
          switches quickly between light and dark. The eye button hides amounts
          throughout your ledger.
        </p>
      </section>
      <section className="settings-card">
        <h2>Personal ledger</h2>
        <p>USD accounts are available now. More currencies are coming later.</p>
        <p className="muted">Use Add to record income and expenses in USD.</p>
      </section>
      <AppVersion />
    </>
  );
}
