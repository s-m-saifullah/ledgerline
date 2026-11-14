/** What a viewer sees where an owner or editor would have an Add or Edit control: the same sentence on every screen. */
export function ReadOnlyNote() {
  return (
    <p role="status" className="read-only-note">
      You have read-only access to this ledger.
    </p>
  );
}
