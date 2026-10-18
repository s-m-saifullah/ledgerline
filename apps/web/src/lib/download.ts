import { apiError } from "./api";

/**
 * Fetches a file from the API with the signed-in session and saves it through the browser. The
 * file only ever exists in this tab's memory until it is saved; the server keeps no copy.
 */
export async function downloadFile(path: string, fallbackName: string) {
  const response = await fetch(`/api/v1${path}`, {
    credentials: "same-origin",
  });
  if (!response.ok) throw await apiError(response);
  const name =
    /filename="([^"\r\n]+)"/.exec(
      response.headers.get("content-disposition") ?? "",
    )?.[1] ?? fallbackName;
  saveBlob(await response.blob(), name);
}

/** Saves a file through the browser from memory; the address is released a few seconds later. */
export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
  } finally {
    // Give the browser a moment to start the save before the memory is released.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}
