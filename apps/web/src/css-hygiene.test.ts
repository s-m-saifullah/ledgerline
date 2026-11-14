import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Dead styles cannot creep back: every class a stylesheet defines is used by a component, and every custom
// property a stylesheet reads is defined. This is about leftovers, not about the look (see `css-contract.test.ts`).
const roots = [
  resolve(__dirname),
  resolve(__dirname, "../../../packages/ui/src"),
];

const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
};

const all = roots.flatMap((root) => walk(root));
const cssFiles = all.filter((file) => file.endsWith(".css"));
const isTest = (file: string) =>
  /\.test\.tsx?$/.test(file) || /[\\/]test-support[\\/]/.test(file);
const sourceFiles = all.filter(
  (file) => /\.tsx?$/.test(file) && !isTest(file) && !file.endsWith(".d.ts"),
);
const source = sourceFiles.map((file) => readFileSync(file, "utf8")).join("\n");
const read = (file: string) =>
  readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/url\([^)]*\)/g, "url()")
    .replace(/"[^"]*"|'[^']*'/g, '""');
const name = (file: string) => relative(resolve(__dirname, "../../.."), file);

/** The class names a stylesheet's selectors mention (not its values, not attribute selectors). */
const classesOf = (css: string) => {
  const found = new Set<string>();
  for (const prelude of css.matchAll(/([^{};]+)\{/g)) {
    const selector = (prelude[1] ?? "").replace(/\[[^\]]*\]/g, "");
    if (selector.trim().startsWith("@")) continue;
    for (const match of selector.matchAll(/\.([A-Za-z_][\w-]*)/g))
      if (match[1]) found.add(match[1]);
  }
  return found;
};

const escapeRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");
// Names a component builds at run time (`ui-pill-${tone}`), so no whole word of them appears in the source.
// Each entry gives the start of the template as it is written in the component and the names it can make
// (`null`: any), so a dead class that merely starts the same way is still found. Each template must really
// exist (checked below), so this list cannot go stale.
const runtimeNames: Record<string, string[] | null> = {
  "ui-pill-": null,
  "ui-bar-": null,
  "more-g": ["1", "2", "3"],
  "set-": ["accent", "danger"],
  "--chart-": null,
};
const builtAtRunTime = (token: string) =>
  Object.entries(runtimeNames).some(
    ([prefix, rest]) =>
      token.startsWith(prefix) &&
      (rest === null || rest.includes(token.slice(prefix.length))),
  );
/** Used as a whole word in some component, or as one of the names built at run time. */
const mentions = (text: string, token: string) =>
  new RegExp(`(?<![\\w-])${escapeRegExp(token)}(?![\\w-])`).test(text) ||
  builtAtRunTime(token);

describe("names built at run time", () => {
  it.each(Object.keys(runtimeNames))("%s is built by a component", (prefix) => {
    expect(source).toContain(`${prefix}\${`);
  });
});

describe("stylesheets carry no dead classes", () => {
  it.each(cssFiles.map((file) => [name(file), file] as const))(
    "%s",
    (_label, file) => {
      const dead = [...classesOf(read(file))].filter(
        (cls) => !mentions(source, cls),
      );
      expect(dead).toEqual([]);
    },
  );
});

describe("custom properties", () => {
  const defined = new Set<string>();
  const read_ = new Map<string, string[]>();
  for (const file of cssFiles) {
    const css = read(file);
    for (const match of css.matchAll(/(--[\w-]+)\s*:/g))
      if (match[1]) defined.add(match[1]);
    for (const match of css.matchAll(/var\((--[\w-]+)/g)) {
      if (!match[1]) continue;
      read_.set(match[1], [...(read_.get(match[1]) ?? []), name(file)]);
    }
  }
  const setInSource = (token: string) => mentions(source, token);

  it("are defined wherever a stylesheet reads them", () => {
    const missing = [...read_.keys()].filter(
      (token) =>
        !defined.has(token) &&
        !setInSource(token) &&
        !token.startsWith("--radix-"),
    );
    expect(missing).toEqual([]);
  });

  it("are read somewhere when a stylesheet defines them", () => {
    // `--color-*` feed Tailwind's utilities (`@theme`), not our own rules.
    const unused = [...defined].filter(
      (token) =>
        !token.startsWith("--color-") &&
        !read_.has(token) &&
        !setInSource(token),
    );
    expect(unused).toEqual([]);
  });
});

describe("the old money component is gone", () => {
  it("has no file and no `.amount` rule", () => {
    expect(existsSync(resolve(__dirname, "components/amount.tsx"))).toBe(false);
    const rules = cssFiles.filter((file) =>
      classesOf(read(file)).has("amount"),
    );
    expect(rules.map(name)).toEqual([]);
  });
});

describe("the old button family is gone", () => {
  const legacy = [
    "button",
    "secondary-button",
    "text-button",
    "icon-button",
    "danger-action",
  ];
  it("is defined by no stylesheet", () => {
    const found = cssFiles.flatMap((file) =>
      [...classesOf(read(file))]
        .filter((cls) => legacy.includes(cls))
        .map((cls) => `${name(file)} .${cls}`),
    );
    expect(found).toEqual([]);
  });

  it("is used by no component (use `ui-btn`, `ui-btn-secondary`, `ui-btn-text`, `ui-icon-btn`)", () => {
    // The class names in every `className="..."` and `className={...}`: one token per word of each string.
    const tokens = (text: string) =>
      [...text.matchAll(/className=(?:"([^"]*)"|\{([^}\n]*)\})/g)].flatMap(
        (attribute) =>
          [
            ...(attribute[1] ?? attribute[2] ?? "").matchAll(
              /["'`]([^"'`]*)["'`]/g,
            ),
          ]
            .map((literal) => literal[1] ?? "")
            .concat(attribute[1] ?? [])
            .flatMap((words) => words.split(/\s+/)),
      );
    const used = sourceFiles
      .filter((file) =>
        tokens(readFileSync(file, "utf8")).some((word) =>
          legacy.includes(word),
        ),
      )
      .map(name);
    expect(used).toEqual([]);
  });
});

describe("there is one search field", () => {
  it('has the only `type="search"` input of a page (the command palette has its own)', () => {
    const found = sourceFiles
      .filter((file) => /type="search"/.test(readFileSync(file, "utf8")))
      .map(name)
      .sort();
    expect(found).toEqual([
      "apps/web/src/components/search-field.tsx",
      "apps/web/src/features/shell/palette.tsx",
    ]);
  });

  it("has the only stylesheet rules for a search box", () => {
    const own = cssFiles
      .filter((file) => /-search\s+(?:input|svg)|\.ui-search/.test(read(file)))
      .map(name);
    expect(own).toEqual(["apps/web/src/components/search-field.css"]);
  });
});

describe("the old page frame is gone", () => {
  it("has no `.main-content` rule (the page frame is `ui-page`)", () => {
    const found = cssFiles
      .filter((file) => classesOf(read(file)).has("main-content"))
      .map(name);
    expect(found).toEqual([]);
  });
});
