// Production server for the Node build (DEPLOY_TARGET=node, the NAS
// container; docs/self-host-plan.md). Plain node:http around Astro's
// standalone handler, which serves dist/client, renders the SSR routes and
// falls back to 404.html. In front of it, in order:
//
//   GET /healthz         200, for the container healthcheck and deploy.sh
//   legacy v2 URLs       301 with the query string, slash or not (src/lib/redirects.mjs)
//   /switch-menu/…       the frame headers vercel.json gives it on Vercel
//
// Env: PORT (4321), HOST (0.0.0.0), and the secrets astro.config.mjs declares.
import { createServer } from "node:http";
import { legacyRedirect } from "./src/lib/redirects.mjs";

// Same values as vercel.json, applied to the document too (Vercel's
// `/switch-menu/:path*` misses `/switch-menu/` itself).
const SWITCH_MENU_HEADERS = {
  "Content-Security-Policy": "frame-ancestors 'self'",
  "X-Frame-Options": "SAMEORIGIN",
  "Referrer-Policy": "same-origin",
};
const isSwitchMenu = (path) => path === "/switch-menu" || path.startsWith("/switch-menu/");

// The entry would start its own server on import in standalone mode.
process.env.ASTRO_NODE_AUTOSTART = "disabled";
const { handler: astro } = await import("./dist/server/entry.mjs");

const server = createServer((req, res) => {
  const url = req.url ?? "/";
  const path = url.split(/[?#]/, 1)[0];

  if (path === "/healthz" && (req.method === "GET" || req.method === "HEAD")) {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    res.end(req.method === "HEAD" ? undefined : "ok\n");
    return;
  }

  const location = legacyRedirect(url);
  if (location) {
    // Vercel's Cache-Control on these, so a changed target is never stuck in a cache.
    res.writeHead(301, { Location: location, "Cache-Control": "public, max-age=0, must-revalidate" });
    res.end();
    return;
  }

  if (isSwitchMenu(path)) {
    for (const [name, value] of Object.entries(SWITCH_MENU_HEADERS)) res.setHeader(name, value);
  }

  astro(req, res);
});

// cloudflared keeps idle origin connections for 90 s. Node's 5 s default
// would close them under it, and a request sent on a closing socket is a 502.
server.keepAliveTimeout = 95_000;
server.headersTimeout = 96_000;

const port = Number(process.env.PORT || 4321);
const host = process.env.HOST || "0.0.0.0";
server.listen(port, host, () => {
  console.log(`[server] listening on http://${host}:${port}`);
});

// docker stop sends SIGTERM; finish in-flight requests, then exit.
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.once(signal, () => {
    server.close(() => process.exit(0));
    server.closeIdleConnections();
    setTimeout(() => process.exit(0), 10_000).unref();
  });
}
