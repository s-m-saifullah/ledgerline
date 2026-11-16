import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// A money movement is a "transaction" everywhere a person can read it (WP-11c-2): never "entry" or "entries".
// This reads the text a person can see (string literals, template text and JSX text) with TypeScript's own parser,
// so a variable called `entry`, a class called `entry-form` and a file called `entry-row.tsx` are not words, and a
// sentence split over several lines in JSX cannot hide from it.
const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
};
const roots = [
  resolve(__dirname),
  resolve(__dirname, "../../../packages/shared/src"),
];
const files = roots
  .flatMap((root) => walk(root))
  .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))
  .filter((file) => !/[\\/](gallery|test-support)[\\/]/.test(file));
const rel = (file: string) =>
  relative(resolve(__dirname, "../../.."), file).replaceAll("\\", "/");

/** The word, but not inside a name: `entry-form`, `entry.date`, `$entry` and `entries_list` do not count. */
const word = /(?<![-\w.$])[Ee]ntr(?:y|ies)(?![-\w])/;

/** Every piece of text in some code that could end up on a screen. */
function visibleText(name: string, code: string): string[] {
  const source = ts.createSourceFile(
    name,
    code,
    ts.ScriptTarget.Latest,
    true,
    name.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    const text =
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isJsxText(node);
    const path =
      ts.isStringLiteral(node) &&
      (ts.isImportDeclaration(node.parent) ||
        ts.isExportDeclaration(node.parent) ||
        ts.isLiteralTypeNode(node.parent));
    if (text && !path) found.push(node.text);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe("the word for a money movement", () => {
  it("is transaction: no visible text says entry or entries", () => {
    const offenders = files.flatMap((file) =>
      visibleText(file, readFileSync(file, "utf8"))
        .filter((text) => word.test(text))
        .map(
          (text) =>
            `${rel(file)}: ${text.replace(/\s+/g, " ").trim().slice(0, 90)}`,
        ),
    );
    expect(offenders).toEqual([]);
  });

  it("does read what a person sees: it finds the word in a string, a template and JSX text, and not in a name", () => {
    const probe = (code: string) =>
      visibleText("sample.tsx", code).filter((text) => word.test(text));
    expect(probe('const a = "No entries yet.";')).toHaveLength(1);
    expect(probe("const a = `${n} entries`;")).toHaveLength(1);
    expect(probe("const a = <p>Delete this\n  entry?</p>;")).toHaveLength(1);
    expect(probe('const a = "An entry\u2019s direction";')).toHaveLength(1);
    expect(
      probe('const entry = 1; const b = <i className="entry-form" />;'),
    ).toHaveLength(0);
    expect(probe("const d = entry.date + entries.length;")).toHaveLength(0);
    expect(probe('import x from "./entry-row"; const q = "a";')).toHaveLength(
      0,
    );
  });
});
