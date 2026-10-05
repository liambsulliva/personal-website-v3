import type { MiddlewareHandler } from "astro";
import {
  SWITCH_MENU_PROJECT_URL,
  isSwitchMenuDocumentPath,
  isSwitchMenuEmbedRequest,
  switchMenuSecurityHeaders,
} from "./lib/switchMenuEmbed";

// Switch-menu document requests that are not embeds go to the write-up.
export const onRequest: MiddlewareHandler = async (context, next) => {
  const url = new URL(context.request.url);

  if (isSwitchMenuDocumentPath(url.pathname) && !isSwitchMenuEmbedRequest(context.request)) {
    return Response.redirect(new URL(SWITCH_MENU_PROJECT_URL, context.request.url), 302);
  }

  const response = await next();
  if (isSwitchMenuDocumentPath(url.pathname)) {
    Object.entries(switchMenuSecurityHeaders()).forEach(([header, value]) => {
      response.headers.set(header, value);
    });
  }
  return response;
};
