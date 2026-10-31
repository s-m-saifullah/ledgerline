/** The save error and the refresh button after a definitive failure. */
export function SaveErrors({
  busy,
  error,
  uncertain,
  onRefresh,
}: {
  busy: boolean;
  error: string;
  uncertain: boolean;
  onRefresh: () => void;
}) {
  return (
    <>
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
      {error && !uncertain && (
        <button
          type="button"
          className="ui-btn ui-btn-text"
          disabled={busy}
          onClick={onRefresh}
        >
          Refresh choices
        </button>
      )}
    </>
  );
}
