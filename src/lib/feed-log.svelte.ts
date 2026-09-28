// The last call to each upstream feed in this tab, for the Feeds panel.

export type FeedPing = {
  name: string;
  // True when the call goes through the Worker and counts against its quota.
  worker: boolean;
  at: number;
  ok: boolean;
  status: number | null;
};

// Keyed by the /api/<name> route in worker/api-routes.ts.
const WORKER_FEEDS: Record<string, string> = {
  dex: "DexScreener",
  gt: "GeckoTerminal",
  yahoo: "Yahoo Finance",
  cnbc: "CNBC",
  fng: "Alternative.me",
  "cnn-fng": "CNN Fear & Greed",
  waqi: "WAQI air quality",
  quota: "Cloudflare usage",
};

const DIRECT_FEEDS: Record<string, string> = {
  "api.coingecko.com": "CoinGecko",
  "api.open-meteo.com": "Open-Meteo forecast",
  "air-quality-api.open-meteo.com": "Open-Meteo air quality",
  "geocoding-api.open-meteo.com": "Open-Meteo city search",
  "api.weather.gc.ca": "Environment Canada",
  "api.weather.gov": "US National Weather Service",
};

export const feedLog = $state<Record<string, FeedPing>>({});

function feedOf(url: string) {
  const route = /^\/api\/([^/?]+)/.exec(url)?.[1];
  if (route) return { key: route, name: WORKER_FEEDS[route] ?? route, worker: true };
  let host = url;
  try {
    host = new URL(url).hostname;
  } catch {
    // Not absolute; log it under the raw URL.
  }
  return { key: host, name: DIRECT_FEEDS[host] ?? host, worker: false };
}

// fetch() that also notes the call in the feed log.
export async function trackedFetch(url: string, init?: RequestInit) {
  const { key, ...feed } = feedOf(url);
  try {
    const res = await fetch(url, init);
    feedLog[key] = { ...feed, at: Date.now(), ok: res.ok, status: res.status };
    return res;
  } catch (err) {
    feedLog[key] = { ...feed, at: Date.now(), ok: false, status: null };
    throw err;
  }
}
