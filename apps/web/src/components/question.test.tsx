import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Question } from "./question";

afterEach(cleanup);

const base = {
  open: true,
  title: "Delete Rent?",
  text: "It cannot be undone.",
  confirm: "Delete",
  busy: false,
  error: "",
  returnFocusId: "opener",
  fallbackFocusId: "fallback",
  onDismiss: () => {},
  onConfirm: () => {},
};

describe("Question", () => {
  it("has Cancel and its one confirming word", () => {
    render(<Question {...base} />);
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeEnabled();
  });

  it("keeps its own word while busy, disabled: it never says Working…", () => {
    render(<Question {...base} confirm="Sign out" busy />);
    const button = screen.getByRole("button", { name: "Sign out" });
    expect(button).toBeDisabled();
    expect(screen.queryByText("Working…")).toBeNull();
  });

  it("says what it is doing while busy when it is given the word", () => {
    render(<Question {...base} busy busyLabel="Deleting…" />);
    expect(screen.getByRole("button", { name: "Deleting…" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  });

  it("keeps its confirming word until it is busy, even when it has a busy word", () => {
    render(<Question {...base} busyLabel="Deleting…" />);
    expect(screen.getByRole("button", { name: "Delete" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Deleting…" })).toBeNull();
  });

  it("shows the server's refusal inside the question", () => {
    render(<Question {...base} error="This changed." />);
    expect(screen.getByRole("alert")).toHaveTextContent("This changed.");
  });
});
