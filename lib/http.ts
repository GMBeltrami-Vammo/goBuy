/**
 * CSRF defense-in-depth for same-origin-only endpoints.
 *
 * NextAuth's session cookie is SameSite=Lax, which already blocks the cookie
 * from being sent on cross-site POSTs. These checks add an explicit, consistent
 * layer and — importantly — also cover same-site sub-origins and the GET export
 * (Lax DOES send the cookie on top-level cross-site GET navigations).
 */

/** True when the request's Origin matches its Host (or no Origin header — e.g. same-origin GET). */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin) return true; // no Origin header → not a cross-site fetch/POST
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * Stricter check for endpoints triggered only by our own `fetch()` (never a
 * direct navigation), e.g. the XLSX export. Requires the browser's
 * Sec-Fetch-Site to be same-origin, which blocks both cross-site fetch and
 * cross-site top-level navigation. Falls back to the Origin/Host check for
 * clients that don't send Sec-Fetch-* (very old browsers).
 */
export function isSameOriginFetch(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site) return site === "same-origin";
  return isSameOrigin(request);
}
