/** Next may reconstruct Request.url with an internal hostname. The browser's
 * destination is the routed Host, not that internal name. This mirrors the
 * existing learning-record origin check and never trusts x-forwarded-host. */
export function isSameOriginClassroomRequest(request: Request): boolean {
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  const value = request.headers.get("origin");
  if (value === null) return true; // Authenticated non-browser clients still need route ACL.
  const url = new URL(request.url);
  const host = request.headers.get("host") ?? url.host;
  if (host.length > 259 || !/^(?:\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9.-]+)(?::[0-9]{1,5})?$/.test(host)) return false;
  const forwardedProtocol = request.headers.get("x-forwarded-proto");
  if (forwardedProtocol !== null && forwardedProtocol !== "http" && forwardedProtocol !== "https") return false;
  const protocol = forwardedProtocol ? `${forwardedProtocol}:` : url.protocol;
  if (protocol !== "http:" && protocol !== "https:") return false;
  try {
    const origin = new URL(value);
    return value === origin.origin && origin.origin === new URL(`${protocol}//${host}`).origin;
  } catch { return false; }
}
