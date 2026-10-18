import { useState } from "react";
import { downloadFile } from "../../lib/download";

/** One download at a time, with a message for the screen: started, or why it did not. */
export function useCsvDownload() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{
    kind: "ok" | "error";
    text: string;
  } | null>(null);
  const start = async (path: string, fallbackName: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await downloadFile(path, fallbackName);
      setMessage({ kind: "ok", text: "Your file is ready." });
    } catch (error) {
      setMessage({
        kind: "error",
        text:
          error instanceof Error && error.message
            ? error.message
            : "We couldn't make the file. Please try again.",
      });
    } finally {
      setBusy(false);
    }
  };
  return { busy, message, start };
}
