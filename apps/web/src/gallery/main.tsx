import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import {
  Avatar,
  EmptyState,
  FilterChip,
  Hero,
  HeroFigure,
  IconTile,
  ListCard,
  ListHead,
  ListRow,
  limitState,
  ProportionBar,
  SectionLabel,
  SegmentedControl,
  StatusPill,
  SwitchRow,
} from "@ledgerline/ui";
import {
  Briefcase,
  Eye,
  EyeOff,
  HandCoins,
  Moon,
  Settings,
  Sun,
  Users,
} from "lucide-react";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Amount } from "../components/amount";
import { MonthControl } from "../components/month-control";
import { Overlay } from "../components/overlay";
import { TopBar } from "../components/top-bar";
import { PrivacyContext, usePreferences } from "../lib/preferences";
import "../styles.css";

/*
 * A development-only page that shows every shared piece of the redesign (ADR 0047) with invented data, so a
 * piece can be looked at and tested at any width without signing in. It is not in the production build: Vite
 * builds `index.html` only. Open `/gallery.html` while `pnpm dev` runs; `?view=` picks a section
 * (`pieces`, `columns`, `split`, `sheet`, `sheet-wide`, `question`), `?theme=dark` and `?privacy=on` set the rest.
 */
const params = new URLSearchParams(location.search);
const view = params.get("view") ?? "pieces";
const fields = Array.from({ length: 14 }, (_, n) => `Field ${n + 1}`);
const link = (href: string) => (inner: React.ReactNode, className: string) => (
  <a href={href} className={className}>
    {inner}
  </a>
);

function Gallery() {
  const prefs = usePreferences();
  const { setTheme, setPrivateMode } = prefs;
  useEffect(() => {
    const theme = params.get("theme");
    if (theme === "light" || theme === "dark") setTheme(theme);
    if (params.get("privacy") === "on") setPrivateMode(true);
  }, [setTheme, setPrivateMode]);
  const [open, setOpen] = useState<"sheet" | "wide" | "question" | null>(
    view === "sheet"
      ? "sheet"
      : view === "sheet-wide"
        ? "wide"
        : view === "question"
          ? "question"
          : null,
  );
  const [month, setMonth] = useState("2026-10");
  const [seg, setSeg] = useState("all");
  const [chip, setChip] = useState(true);
  const [pending, setPending] = useState(false);
  const money = (value: number) => <Amount value={value} />;
  return (
    <PrivacyContext.Provider value={prefs.privateMode}>
      <header>
        <TopBar
          title="Pieces"
          back={
            <a
              href="/gallery.html"
              className="ui-icon-btn"
              aria-label="Back to More"
            >
              <Settings size={20} />
            </a>
          }
          tools={
            <>
              <button
                type="button"
                className="ui-icon-btn"
                aria-label={prefs.privateMode ? "Show amounts" : "Hide amounts"}
                onClick={() => prefs.setPrivateMode(!prefs.privateMode)}
              >
                {prefs.privateMode ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
              <button
                type="button"
                className="ui-icon-btn"
                aria-label={`Switch to ${prefs.resolvedTheme === "dark" ? "light" : "dark"} theme`}
                onClick={() =>
                  prefs.setTheme(
                    prefs.resolvedTheme === "dark" ? "light" : "dark",
                  )
                }
              >
                {prefs.resolvedTheme === "dark" ? (
                  <Sun size={20} />
                ) : (
                  <Moon size={20} />
                )}
              </button>
            </>
          }
        />
      </header>
      <main id="main-content" className="ui-page">
        {view === "pieces" && (
          <>
            <Hero label="In hand" figure={money(1_284_050)}>
              <HeroFigure
                label="Clients owe"
                value={money(425_000)}
                icon={<Briefcase />}
                render={link("#clients")}
              />
              <HeroFigure
                label="People owe"
                value={money(60_000)}
                icon={<Users />}
                render={link("#loans")}
              />
              <HeroFigure
                label="You owe"
                value={money(12_500)}
                icon={<HandCoins />}
                render={link("#loans")}
              />
            </Hero>
            <div className="ui-cols ui-cols-2">
              <div className="ui-stack">
                <SectionLabel>Cash and banking</SectionLabel>
                <ListCard>
                  <ListHead left="Cash and banking" right="2" />
                  <ListRow
                    lead={<Avatar name="Harbor Checking" />}
                    title="Harbor Checking"
                    hint="Checking"
                    value={money(842_015)}
                    onClick={() => {}}
                  />
                  <ListRow
                    lead={
                      <Avatar name="Acme Studio Business Reserve Savings" />
                    }
                    title="Acme Studio Business Reserve Savings Account"
                    hint="Savings"
                    value={money(1_284_050)}
                    valueHint="Oct 12"
                    chevron
                    onClick={() => {}}
                  />
                  <ListRow
                    lead={
                      <IconTile>
                        <Settings size={18} />
                      </IconTile>
                    }
                    title="Settings"
                    chevron
                    render={link("#settings")}
                  />
                  <ListRow title="Static row" hint="Not pressable" />
                </ListCard>
                <div className="ui-card">
                  <p className="ui-title">Budget</p>
                  {[
                    ["Groceries", 0.4, 40_000, 100_000],
                    ["Dining", 0.9, 90_000, 100_000],
                    ["Travel", 1.2, 120_000, 100_000],
                  ].map(([name, share, used, limit]) => (
                    <div key={String(name)} className="ui-stack">
                      <ListRow
                        title={String(name)}
                        value={money(Number(used))}
                        valueHint="of $1,000.00"
                      />
                      <ProportionBar
                        share={Number(share)}
                        state={limitState(Number(used), Number(limit))}
                        label={`${name} used`}
                      />
                    </div>
                  ))}
                </div>
              </div>
              <div className="ui-stack">
                <MonthControl month={month} onChange={setMonth} />
                <SegmentedControl
                  label="Kind"
                  value={seg}
                  onChange={setSeg}
                  options={[
                    { value: "all", label: "All" },
                    { value: "expenses", label: "Expenses" },
                    { value: "income", label: "Income" },
                  ]}
                />
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <FilterChip
                    selected={chip}
                    onClick={() => setChip(!chip)}
                    count={3}
                  >
                    Open
                  </FilterChip>
                  <FilterChip selected={false} onClick={() => {}}>
                    Settled
                  </FilterChip>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <StatusPill>Paid</StatusPill>
                  <StatusPill tone="danger">Overdue</StatusPill>
                  <StatusPill tone="warning">Pending</StatusPill>
                  <StatusPill tone="neutral">Archived</StatusPill>
                </div>
                <ListCard>
                  <SwitchRow
                    title="Pending"
                    hint="Not cleared yet"
                    checked={pending}
                    onChange={setPending}
                  />
                </ListCard>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button type="button" className="ui-btn ui-btn-primary">
                    Save
                  </button>
                  <button type="button" className="ui-btn ui-btn-secondary">
                    Cancel
                  </button>
                  <button type="button" className="ui-btn ui-btn-text">
                    Reset
                  </button>
                  <button type="button" className="ui-btn ui-btn-danger">
                    Delete
                  </button>
                </div>
                <div className="ui-card">
                  <EmptyState
                    text="Nothing here yet."
                    action={{ label: "Add account", onClick: () => {} }}
                  />
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    id="open-sheet"
                    className="ui-btn ui-btn-secondary"
                    onClick={() => setOpen("sheet")}
                  >
                    Open sheet
                  </button>
                  <button
                    type="button"
                    className="ui-btn ui-btn-secondary"
                    onClick={() => setOpen("wide")}
                  >
                    Open wide sheet
                  </button>
                  <button
                    type="button"
                    className="ui-btn ui-btn-secondary"
                    onClick={() => setOpen("question")}
                  >
                    Ask a question
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
        {view === "columns" && (
          <>
            <div className="ui-cols ui-cols-2" data-testid="cols-2">
              <div className="ui-card">One</div>
              <div className="ui-card">Two</div>
            </div>
            <div className="ui-cols ui-cols-21" data-testid="cols-21">
              <div className="ui-card">Wide</div>
              <div className="ui-card">Narrow</div>
            </div>
          </>
        )}
        {view === "split" && (
          <div className="ui-split" data-testid="split">
            <ListCard>
              <ListRow
                title="Acme Studio"
                hint="Oldest unpaid 12d ago"
                value={money(120_000)}
                onClick={() => {}}
              />
              <ListRow
                title="Harbor Cafe"
                hint="Oldest unpaid 3d ago"
                value={money(30_000)}
                onClick={() => {}}
              />
            </ListCard>
            <div className="ui-card ui-split-empty" data-testid="split-empty">
              Pick a client
            </div>
          </div>
        )}
      </main>
      <Overlay
        open={open === "sheet" || open === "wide"}
        size={open === "wide" ? "wide" : "default"}
        title="Add account"
        busy={false}
        onDismiss={() => setOpen(null)}
        returnFocusId="open-sheet"
        fallbackFocusId="main-content"
        action={
          <button type="button" className="ui-btn ui-btn-text">
            Reset
          </button>
        }
        footer={
          <button
            type="button"
            className="ui-btn ui-btn-primary"
            onClick={() => setOpen(null)}
          >
            Save
          </button>
        }
      >
        <div className="ui-stack">
          {fields.map((name) => (
            <label key={name} className="ui-stack">
              <span>{name}</span>
              <input
                style={{
                  minHeight: 44,
                  border: "1px solid var(--field-border)",
                  borderRadius: 12,
                  padding: "0 12px",
                }}
              />
            </label>
          ))}
        </div>
      </Overlay>
      <Overlay
        open={open === "question"}
        kind="question"
        title="Delete Harbor Checking?"
        busy={false}
        onDismiss={() => setOpen(null)}
        returnFocusId="open-sheet"
        fallbackFocusId="main-content"
        footer={
          <button
            type="button"
            className="ui-btn ui-btn-danger-filled"
            onClick={() => setOpen(null)}
          >
            Delete
          </button>
        }
      />
    </PrivacyContext.Provider>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing root element");
createRoot(root).render(
  <StrictMode>
    <Gallery />
  </StrictMode>,
);
