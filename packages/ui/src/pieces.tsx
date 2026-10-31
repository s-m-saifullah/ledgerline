import { ChevronRight } from "lucide-react";
import {
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  useId,
  useRef,
} from "react";
import { cn } from "./cn";

/*
 * The shared pieces of the web redesign (ADR 0047), named like the phone's `ui/design/Pieces.kt`. They know
 * nothing about the router or about money: a row that is a link takes `render`, and an amount is passed in
 * as a node (so it goes through the app's money component and follows privacy mode). Their styles are in
 * `pieces.css`; every class starts with `ui-` so they can sit beside the old classes until a screen moves.
 */

/** What a row or a hero figure does when it is pressed: nothing, a click handler, or whatever `render` makes. */
type Press = {
  onClick?: () => void;
  /** Only for a press that is a button: it is then a disabled button (a link cannot be disabled). */
  disabled?: boolean;
  /** Wraps the content in a link (or anything else) that the caller owns, such as the router's `Link`. */
  render?: (inner: ReactNode, className: string) => ReactElement;
};

function pressable(
  className: string,
  inner: ReactNode,
  { onClick, render, disabled }: Press,
) {
  if (render) return render(inner, className);
  if (onClick)
    return (
      <button
        type="button"
        className={className}
        onClick={onClick}
        disabled={disabled}
      >
        {inner}
      </button>
    );
  return <div className={className}>{inner}</div>;
}

/** Up to two letters for an avatar, by the phone's rule: the first letters of the first two words, or the first two of one word. */
export function initialsOf(name: string) {
  const words = name
    .trim()
    .split(/\s+/)
    .filter((word) => /[\p{L}\p{N}]/u.test(word));
  const first = (word: string) => [...word.replace(/[^\p{L}\p{N}]/gu, "")][0];
  if (words.length === 0) return "?";
  if (words.length === 1)
    return [...(words[0] ?? "").replace(/[^\p{L}\p{N}]/gu, "")]
      .slice(0, 2)
      .join("")
      .toUpperCase();
  return words.slice(0, 2).map(first).join("").toUpperCase();
}

/** A round tile with a name's initials on the accent's soft fill: no emoji, nothing to store. */
export function Avatar({ name }: { name: string }) {
  return (
    <span className="ui-avatar" aria-hidden="true">
      {initialsOf(name)}
    </span>
  );
}

/** A square tile for an icon, the other kind of lead a row can have. */
export function IconTile({ children }: { children: ReactNode }) {
  return (
    <span className="ui-tile" aria-hidden="true">
      {children}
    </span>
  );
}

export type LimitState = "within" | "near" | "over";
/** How full a limit is: the accent, the warning at 90 per cent of it and above, red over it (as on the phone). */
export function limitState(used: number, limit: number): LimitState {
  if (limit <= 0) return "within";
  if (used > limit) return "over";
  if (used * 10 >= limit * 9) return "near";
  return "within";
}

/** A track filled to `share` (0 to 1). The text beside it says the same in words, so it is only named, never the sole carrier. */
export function ProportionBar({
  share,
  state = "within",
  label,
}: {
  share: number;
  state?: LimitState;
  label?: string;
}) {
  const percent = Math.round(Math.min(1, Math.max(0, share)) * 100);
  return (
    <div
      className={cn("ui-bar", state !== "within" && `ui-bar-${state}`)}
      role="img"
      aria-label={label ?? `${percent}%`}
    >
      <i style={{ width: `${percent}%` }} />
    </div>
  );
}

export type PillTone = "accent" | "danger" | "warning" | "neutral";
export function StatusPill({
  tone = "accent",
  children,
}: {
  tone?: PillTone;
  children: ReactNode;
}) {
  return <span className={cn("ui-pill", `ui-pill-${tone}`)}>{children}</span>;
}

/** The small capitals heading above a group of rows. */
export function SectionLabel({
  children,
  as: Tag = "p",
  id,
}: {
  children: ReactNode;
  /** A heading when a section is named by it. */
  as?: "p" | "h2";
  id?: string;
}) {
  return (
    <Tag className="ui-section-label" id={id}>
      {children}
    </Tag>
  );
}

export function EmptyState({
  text,
  action,
}: {
  text: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="ui-empty">
      <p>{text}</p>
      {action && (
        <button
          type="button"
          className="ui-btn ui-btn-secondary"
          onClick={action.onClick}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

/** A filter that is on or off, with an optional count. */
export function FilterChip({
  selected,
  onClick,
  count,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  count?: number;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="ui-chip"
      aria-pressed={selected}
      onClick={onClick}
    >
      {children}
      {count !== undefined && (
        <>
          {" "}
          <span className="ui-chip-count">{count}</span>
        </>
      )}
    </button>
  );
}

export type SegmentOption<T extends string> = { value: T; label: string };
/** Two to four choices in one track. One radio group: the chosen option is the tab stop and the arrow keys move it. */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled,
}: {
  label: string;
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (event: KeyboardEvent, from: number) => {
    const last = options.length - 1;
    const target =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? from === last
          ? 0
          : from + 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? from === 0
            ? last
            : from - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : -1;
    const next = options[target];
    if (!next) return;
    event.preventDefault();
    onChange(next.value);
    refs.current[target]?.focus();
  };
  return (
    <div className="ui-seg" role="radiogroup" aria-label={label}>
      {options.map((option, index) => (
        // biome-ignore lint/a11y/useSemanticElements: a styled button in a roving radio group, so the track looks like the phone's
        <button
          key={option.value}
          ref={(node) => {
            refs.current[index] = node;
          }}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          disabled={disabled}
          tabIndex={option.value === value ? 0 : -1}
          onClick={() => onChange(option.value)}
          onKeyDown={(event) => move(event, index)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** One bordered card of grouped rows. */
export function ListCard({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("ui-card ui-list", className)}>{children}</div>;
}

/** The line above some rows inside a card: a name on the left and, if there is one, a figure on the right. */
export function ListHead({
  left,
  right,
}: {
  left: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="ui-list-head">
      <span>{left}</span>
      {right !== undefined && <span>{right}</span>}
    </div>
  );
}

export const rowClass = "ui-row";
type RowProps = {
  lead?: ReactNode;
  title: string;
  /** One short line. It is a string, not a node, on purpose: a hint is never a paragraph (ADR 0046). */
  hint?: string;
  value?: ReactNode;
  valueHint?: string;
  chevron?: boolean;
};

/** The inside of a row, for a caller that builds its own link element. */
export function RowBody({
  lead,
  title,
  hint,
  value,
  valueHint,
  chevron,
}: RowProps) {
  return (
    <>
      {lead}
      <span className="ui-row-main">
        <span className="ui-row-title">{title}</span>
        {hint && <span className="ui-row-hint">{hint}</span>}
      </span>
      {(value !== undefined || valueHint) && (
        <span className="ui-row-end">
          {value}
          {valueHint && <span className="ui-row-hint">{valueHint}</span>}
        </span>
      )}
      {chevron && (
        <span className="ui-row-chevron" aria-hidden="true">
          <ChevronRight size={18} />
        </span>
      )}
    </>
  );
}

/** A row: an optional lead, a title with at most one short hint, and a trailing value with at most one hint of its own. */
export function ListRow({
  onClick,
  render,
  disabled,
  ...row
}: RowProps & Press) {
  const press: Press = {};
  if (onClick) press.onClick = onClick;
  if (disabled) press.disabled = disabled;
  if (render) press.render = render;
  return pressable(
    cn(
      rowClass,
      (onClick || render) && "ui-row-press",
      !onClick && !render && "ui-row-static",
    ),
    <RowBody {...row} />,
    press,
  );
}

/** A row with one switch. The whole row is the switch, so the target is the row's height; the hint describes it. */
export function SwitchRow({
  title,
  hint,
  checked,
  onChange,
  disabled,
}: {
  title: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={`${id}-t`}
      aria-describedby={hint ? `${id}-h` : undefined}
      disabled={disabled}
      className="ui-row ui-row-press ui-switch-row"
      onClick={() => onChange(!checked)}
    >
      <span className="ui-row-main">
        <span className="ui-row-title" id={`${id}-t`}>
          {title}
        </span>
        {hint && (
          <span className="ui-row-hint" id={`${id}-h`}>
            {hint}
          </span>
        )}
      </span>
      <span className="ui-switch" aria-hidden="true" />
    </button>
  );
}

/** The deep accent card with the one big figure; small figures (`HeroFigure`) go under it. */
export function Hero({
  label,
  figure,
  children,
}: {
  label: string;
  figure: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="ui-hero">
      <p className="ui-hero-label">{label}</p>
      <p className="ui-hero-figure">{figure}</p>
      {children && <div className="ui-hero-figs">{children}</div>}
    </section>
  );
}

/** One small figure in a hero: an optional icon, a label that never wraps, and the value. */
export function HeroFigure({
  label,
  value,
  icon,
  onClick,
  render,
}: {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
} & Press) {
  const press: Press = {};
  if (onClick) press.onClick = onClick;
  if (render) press.render = render;
  return pressable(
    cn("ui-hero-fig", (onClick || render) && "ui-hero-fig-press"),
    <>
      <span className="ui-hero-fig-label">
        {icon}
        {label}
      </span>
      <span className="ui-hero-fig-value">{value}</span>
    </>,
    press,
  );
}
