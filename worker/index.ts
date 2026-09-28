import { createRemoteJWKSet, jwtVerify } from "jose";
import { matchApi, upstreamPath } from "./api-routes.ts";

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  // Zero Trust team name: the <team> in <team>.cloudflareaccess.com.
  ACCESS_TEAM?: string;
  WAQI_TOKEN?: string;
}

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;

// Access sends its signed token as this header, and the browser also carries
// it in the CF_Authorization cookie. Cloudflare's static-asset router does not
// pass ctx.access on to this Worker, so fall back to either copy.
function accessToken(request: Request) {
  const header = request.headers.get("Cf-Access-Jwt-Assertion");
  if (header) return header;
  const cookie = request.headers.get("Cookie") ?? "";
  return /(?:^|;\s*)CF_Authorization=([^;]+)/.exec(cookie)?.[1] ?? null;
}

// Cloudflare Access stops strangers before they reach the Worker. This second
// check keeps /api closed if Access is ever switched off or misconfigured, so
// nobody without a login can spend the quota. Any token signed by the team
// passes, which is fine while Lookout is the team's only Access app.
// Returns why the request is refused, or null once it is signed in.
async function refusal(request: Request, env: Env) {
  if (!env.ACCESS_TEAM) return "ACCESS_TEAM is not set in wrangler.jsonc.";
  const token = accessToken(request);
  if (!token) return "No Cloudflare Access login reached the Worker. Sign in first.";
  const issuer = `https://${env.ACCESS_TEAM}.cloudflareaccess.com`;
  jwks ??= createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
  try {
    await jwtVerify(token, jwks, { issuer });
    return null;
  } catch (err) {
    const reason = err instanceof Error ? err.message : "invalid token";
    return `Cloudflare Access login rejected: ${reason}`;
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: { access?: unknown }) {
    const url = new URL(request.url);
    // wrangler.jsonc only routes /api/* here; the rest is the static build.
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);

    const refused = ctx.access ? null : await refusal(request, env);
    if (refused) return new Response(refused, { status: 403 });
    const hit = matchApi(url.pathname + url.search);
    if (!hit) return new Response("Unknown feed", { status: 404 });
    if (request.method !== "GET") return new Response("GET only", { status: 405 });

    // Fresh headers only: the visitor's cookies include the Access session.
    // Some APIs refuse a request with no User-Agent.
    const target =
      hit.route.origin + upstreamPath(hit.route, hit.rest, env.WAQI_TOKEN ?? "");
    try {
      const upstream = await fetch(target, {
        headers: hit.route.headers ?? {
          "User-Agent": "lookout",
          Accept: "application/json",
        },
      });
      return new Response(upstream.body, {
        status: upstream.status,
        headers: {
          "Content-Type": upstream.headers.get("Content-Type") ?? "application/json",
          "Cache-Control": "no-store",
        },
      });
    } catch {
      return new Response("Upstream feed unreachable", { status: 502 });
    }
  },
};
