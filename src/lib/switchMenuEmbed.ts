const SWITCH_MENU_PREFIX = "/switch-menu";
const SWITCH_MENU_PROJECT_PATH = "/engineering/switch-react-menu";

export const SWITCH_MENU_PROJECT_URL = `${SWITCH_MENU_PROJECT_PATH}/`;

function isSwitchMenuProjectReferer(refererUrl: URL, requestOrigin: string): boolean {
  return (
    refererUrl.origin === requestOrigin &&
    (refererUrl.pathname === SWITCH_MENU_PROJECT_PATH ||
      refererUrl.pathname === `${SWITCH_MENU_PROJECT_PATH}/` ||
      refererUrl.pathname.startsWith(`${SWITCH_MENU_PROJECT_PATH}/`))
  );
}

export function isSwitchMenuEmbedRequest(request: Request): boolean {
  const requestUrl = new URL(request.url);
  if (requestUrl.searchParams.get("embed") === "1") return true;

  if (request.headers.get("sec-fetch-dest") === "iframe") return true;

  const referer = request.headers.get("referer");
  if (!referer) return false;

  try {
    const refererUrl = new URL(referer);
    return isSwitchMenuProjectReferer(refererUrl, requestUrl.origin);
  } catch {
    return false;
  }
}

export function isRawgProxyRequestAllowed(request: Request): boolean {
  if (request.method !== "GET") return false;

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "same-site") {
    return false;
  }

  const fetchDest = request.headers.get("sec-fetch-dest");
  if (fetchDest && fetchDest !== "empty") return false;

  const referer = request.headers.get("referer");
  if (!referer) return false;

  try {
    const requestUrl = new URL(request.url);
    const refererUrl = new URL(referer);
    return (
      requestUrl.origin === refererUrl.origin &&
      (refererUrl.pathname === SWITCH_MENU_PREFIX ||
        refererUrl.pathname.startsWith(`${SWITCH_MENU_PREFIX}/`))
    );
  } catch {
    return false;
  }
}

export function switchMenuSecurityHeaders(): HeadersInit {
  return {
    "X-Frame-Options": "SAMEORIGIN",
    "Content-Security-Policy": "frame-ancestors 'self'",
    "Referrer-Policy": "same-origin",
    "Cache-Control": "no-store",
  };
}

export function isSwitchMenuDocumentPath(pathname: string): boolean {
  return (
    pathname === SWITCH_MENU_PREFIX || pathname === `${SWITCH_MENU_PREFIX}/`
  );
}
