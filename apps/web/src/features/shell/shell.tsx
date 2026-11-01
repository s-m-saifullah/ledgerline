import { useQuery } from "@tanstack/react-query";
import {
  Link,
  Outlet,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import {
  ArrowLeft,
  Command,
  Eye,
  EyeOff,
  type Home,
  LogOut,
  Moon,
  Plus,
  Search,
  Sun,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { LoadError } from "../../components/load-error";
import { TopBar } from "../../components/top-bar";
import { api, getLedgers, type Session } from "../../lib/api";
import { type Preferences, SignOutContext } from "../../lib/preferences";
import { useLiveChanges } from "../../lib/use-live-changes";
import { usePageAnnouncement } from "../../lib/use-page-announcement";
import { QuickAdd } from "../transactions/quick-add";
import { TransactionWorkspace } from "../transactions/workspace";
import {
  backTarget,
  basePath,
  destinations,
  isActiveDestination,
  moreGroups,
  morePages,
  pageTitle,
  showsAdd,
} from "./nav";
import { type PageAdd, PageAddProvider } from "./page-add";
import { CommandPalette, type PaletteItem } from "./palette";
import { SyncStatus } from "./sync-status";
import "./shell.css";

/**
 * The frame of every signed-in screen (ADR 0047). One `aside` is a bottom bar's counterpart: hidden under
 * 700 px, an icon rail from 700 px and a sidebar that also lists More's pages from 1100 px, all in CSS
 * (`shell.css`), so no script chooses between layouts. A phone has a top bar, five tabs and one Add button.
 */
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
  const currentPage = pageTitle(pathname);
  const back = backTarget(pathname);
  const pageAnnouncement = usePageAnnouncement(currentPage);
  const ledgers = useQuery({ queryKey: ["ledgers"], queryFn: getLedgers });
  const ledger = ledgers.data?.items[0];
  const sync = useLiveChanges(ledger?.id);
  const canAdd = !!ledger && ledger.role !== "viewer";
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [addTrigger, setAddTrigger] = useState("add-transaction");
  const [pageAdd, setPageAdd] = useState<PageAdd | null>(null);
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
  const darkNow = preferences.resolvedTheme === "dark";
  const themeLabel = darkNow ? "Switch to light theme" : "Switch to dark theme";
  const signOutButton = (className: string) => (
    <button
      type="button"
      className={className}
      aria-label="Sign out"
      onClick={signOut}
    >
      <LogOut size={18} />
    </button>
  );
  const paletteItems: PaletteItem[] = [
    {
      key: "add",
      label: "Add transaction",
      icon: Plus,
      disabled: !canAdd,
      run: () => {
        paletteToAdd.current = true;
        setPaletteOpen(false);
        openAdd("open-navigation");
      },
    },
    ...[...destinations, ...morePages].map((page) => ({
      key: page.to,
      label: ("paletteLabel" in page && page.paletteLabel) || page.label,
      icon: page.icon,
      run: () => {
        setPaletteOpen(false);
        void navigate({ to: page.to });
      },
    })),
    ...(["light", "dark", "system"] as const).map((value) => ({
      key: `theme-${value}`,
      label: `Theme: ${value[0]?.toUpperCase()}${value.slice(1)}`,
      icon: value === "dark" ? Moon : value === "light" ? Sun : Command,
      run: () => {
        preferences.setTheme(value);
        setPaletteOpen(false);
      },
    })),
    {
      key: "privacy",
      label: preferences.privateMode ? "Show amounts" : "Hide amounts",
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
  ];
  const content = (
    <div className="ui-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside className="ui-side">
        <Link to="/" className="ui-side-brand">
          <span className="brand-mark" aria-hidden="true">
            L<span>↗</span>
          </span>
          <span className="ui-side-wide">Ledgerline</span>
        </Link>
        <div className="ui-side-scroll">
          <button
            type="button"
            className="ui-btn ui-btn-primary ui-side-add"
            id="add-transaction"
            disabled={!canAdd}
            title={
              ledger?.role === "viewer"
                ? "Read-only ledger"
                : "Record income or an expense"
            }
            onClick={() => openAdd("add-transaction")}
          >
            <Plus size={18} aria-hidden="true" />
            <span className="ui-side-wide">Add transaction</span>
          </button>
          <nav aria-label="Main navigation" className="ui-side-nav">
            {destinations.map(({ to, label, icon: Icon }) => (
              <Link
                key={to}
                to={to}
                className={to === "/more" ? "ui-side-more" : undefined}
                {...(isActiveDestination(to, pathname)
                  ? { "aria-current": "page" as const }
                  : {})}
              >
                <Icon size={20} aria-hidden="true" />
                <span className="ui-side-label">{label}</span>
              </Link>
            ))}
          </nav>
          <nav aria-label="More pages" className="ui-side-pages">
            {moreGroups.map((group) => (
              <div key={group.label} className="ui-side-group">
                <p className="ui-side-group-label">{group.label}</p>
                {group.pages.map(({ to, label, icon: Icon }) => (
                  <Link
                    key={to}
                    to={to}
                    {...(basePath(pathname) === to
                      ? { "aria-current": "page" as const }
                      : {})}
                  >
                    <Icon size={18} aria-hidden="true" />
                    <span className="ui-side-label">{label}</span>
                  </Link>
                ))}
              </div>
            ))}
          </nav>
        </div>
        <div className="ui-side-foot">
          <button
            type="button"
            id="open-navigation"
            className="ui-side-jump"
            onClick={() => setPaletteOpen(true)}
          >
            <Search size={18} aria-hidden="true" />
            <span className="ui-side-wide">Jump to</span>
            <kbd className="ui-side-wide">⌘ K</kbd>
          </button>
          <div className="ui-side-owner">
            <span className="ui-avatar" aria-hidden="true">
              {session.user.name.slice(0, 1)}
            </span>
            <div>
              <strong>{session.user.name}</strong>
              <span>Owner</span>
            </div>
            {signOutButton("ui-icon-btn")}
          </div>
          <AppVersion />
        </div>
      </aside>
      <div className="ui-shell-body">
        <header>
          <TopBar
            decorative
            title={currentPage}
            back={
              back ? (
                <Link
                  to={back.to}
                  className="ui-icon-btn"
                  aria-label={back.label}
                >
                  <ArrowLeft size={20} aria-hidden="true" />
                </Link>
              ) : undefined
            }
            tools={
              <>
                <span className="ui-topbar-sync">
                  <SyncStatus state={sync} />
                </span>
                <button
                  type="button"
                  className="ui-icon-btn"
                  aria-label={
                    preferences.privateMode ? "Show amounts" : "Hide amounts"
                  }
                  aria-pressed={preferences.privateMode}
                  onClick={() =>
                    preferences.setPrivateMode(!preferences.privateMode)
                  }
                >
                  {preferences.privateMode ? (
                    <EyeOff size={20} aria-hidden="true" />
                  ) : (
                    <Eye size={20} aria-hidden="true" />
                  )}
                </button>
                <button
                  type="button"
                  className="ui-icon-btn"
                  aria-label={themeLabel}
                  title={themeLabel}
                  onClick={() =>
                    preferences.setTheme(darkNow ? "light" : "dark")
                  }
                >
                  {darkNow ? (
                    <Sun size={20} aria-hidden="true" />
                  ) : (
                    <Moon size={20} aria-hidden="true" />
                  )}
                </button>
              </>
            }
          />
        </header>
        {error && (
          <p role="alert" className="field-error">
            {error}
          </p>
        )}
        <p className="sr-only" aria-live="polite">
          {pageAnnouncement}
        </p>
        <main id="main-content" className="main-content" tabIndex={-1}>
          <SignOutContext value={() => void signOut()}>
            <PageAddProvider value={setPageAdd}>
              <Outlet />
            </PageAddProvider>
          </SignOutContext>
        </main>
      </div>
      <nav className="ui-bottom" aria-label="Mobile navigation">
        {destinations.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            {...(isActiveDestination(to, pathname)
              ? { "aria-current": "page" as const }
              : {})}
          >
            <Icon size={20} aria-hidden="true" />
            <span>{label}</span>
          </Link>
        ))}
      </nav>
      {showsAdd(pathname) && (
        <button
          type="button"
          className="ui-fab"
          id={pageAdd ? "mobile-add-page" : "mobile-add-transaction"}
          aria-label={pageAdd?.label ?? "Add transaction"}
          disabled={pageAdd ? pageAdd.disabled : !canAdd}
          onClick={() =>
            pageAdd ? pageAdd.onClick() : openAdd("mobile-add-transaction")
          }
        >
          <Plus size={24} aria-hidden="true" />
        </button>
      )}
      {ledgers.isError && (
        <LoadError
          className="shell-ledger-error"
          message="Couldn't load your ledger."
          onRetry={() => void ledgers.refetch()}
        />
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
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        items={paletteItems}
        onCloseAutoFocus={(event) => {
          if (paletteToAdd.current) {
            event.preventDefault();
            paletteToAdd.current = false;
          }
        }}
      />
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
