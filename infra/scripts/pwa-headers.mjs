/**
 * Checks what the web container sends for the installable app (ADR 0041): the manifest and the service worker
 * are served with the right type and are never cached. Takes plain { status, headers } objects and returns the
 * problems found, so it can be tested without a network.
 */
export function pwaHeaderProblems({ manifest, worker, missingWorker }) {
  const problems = [];
  const type = (response) =>
    (response.headers["content-type"] ?? "").toLowerCase();
  const noStore = (response) =>
    (response.headers["cache-control"] ?? "")
      .toLowerCase()
      .includes("no-store");
  if (manifest.status !== 200) problems.push("manifest is not served");
  else {
    if (!type(manifest).includes("json"))
      problems.push("manifest has the wrong type");
    if (!noStore(manifest)) problems.push("manifest is cacheable");
  }
  if (worker.status !== 200) problems.push("service worker is not served");
  else {
    if (!type(worker).includes("javascript"))
      problems.push("service worker has the wrong type");
    if (!noStore(worker)) problems.push("service worker is cacheable");
  }
  if (missingWorker !== undefined && missingWorker.status !== 404)
    problems.push("a missing worker file is not a 404");
  return problems;
}
