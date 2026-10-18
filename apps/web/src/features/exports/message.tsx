export function DownloadMessage({
  message,
}: {
  message: { kind: "ok" | "error"; text: string } | null;
}) {
  if (!message) return null;
  return message.kind === "error" ? (
    <p role="alert" className="field-error">
      {message.text}
    </p>
  ) : (
    <p role="status" className="muted">
      {message.text}
    </p>
  );
}
