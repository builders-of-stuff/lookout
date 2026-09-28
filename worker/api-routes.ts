// The upstream feeds behind /api/<name>/…. The Vite dev server (vite.config.ts)
// and the Cloudflare Worker (worker/index.ts) both proxy from this one table.

const browserHeaders = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  Accept: "application/json",
};

export type ApiRoute = {
  origin: string;
  // Path prefix on the upstream.
  base?: string;
  headers?: Record<string, string>;
  // Append the WAQI_TOKEN secret as ?token=.
  token?: boolean;
};

export const API_ROUTES: Record<string, ApiRoute> = {
  dex: { origin: "https://api.dexscreener.com" },
  gt: { origin: "https://api.geckoterminal.com" },
  yahoo: { origin: "https://query1.finance.yahoo.com", headers: browserHeaders },
  cnbc: { origin: "https://quote.cnbc.com", headers: browserHeaders },
  fng: { origin: "https://api.alternative.me" },
  "cnn-fng": {
    origin: "https://production.dataviz.cnn.io",
    headers: {
      ...browserHeaders,
      Referer: "https://www.cnn.com/",
      Origin: "https://www.cnn.com",
    },
  },
  waqi: { origin: "https://api.waqi.info", token: true },
};

// `rest` is everything after /api/<name>, query string included.
export function upstreamPath(route: ApiRoute, rest: string, waqiToken: string) {
  const path = `${route.base ?? ""}${rest}`;
  if (!route.token) return path;
  return `${path}${path.includes("?") ? "&" : "?"}token=${encodeURIComponent(waqiToken)}`;
}

export function matchApi(path: string): { route: ApiRoute; rest: string } | null {
  const match = /^\/api\/([^/?]+)(.*)$/.exec(path);
  if (!match || !Object.hasOwn(API_ROUTES, match[1])) return null;
  return { route: API_ROUTES[match[1]], rest: match[2] };
}
