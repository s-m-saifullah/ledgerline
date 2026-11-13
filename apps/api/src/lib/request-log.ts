/**
 * Requests left out of the request log. The container checks the health route every few seconds, which would be
 * about 17,000 lines a day of nothing; every other request is still logged (its id, method and status only).
 */
export function isQuietRequest(url: string) {
  return url.split("?")[0] === "/api/health";
}
