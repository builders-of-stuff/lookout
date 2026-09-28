# Night Tape

A local market desk for the names you already bounce between CoinMarketCap, DexScreener, and TradingView. SvelteKit 5, runs entirely in the browser.

```bash
pnpm install
pnpm run dev
```

Opens at [http://localhost:5173](http://localhost:5173). Quotes stay in this browser (`localStorage`). Locally the Vite dev server proxies the feeds; online a small Cloudflare Worker does (see [Put it online](#put-it-online)). No API key is required. One optional free token turns on measured air quality (see [Weather](#weather)).

Polling pauses while the tab is hidden. Coming back after a missed cycle refreshes at once.

## What's on the blotter

| Name                    | Source      | Live chart                         |
| ----------------------- | ----------- | ---------------------------------- |
| BTC, ZEC, SOL, SUI, ETH | CoinGecko   | TradingView embed + outbound links |
| ZCAT (Anonymous Cat)    | DexScreener | DexScreener embed                  |
| TSLA, SPCX, S&P 500     | CNBC        | TradingView embed                  |

Short-term sparklines and the **Short tape** tab are built from seeded history plus every poll (20s), kept in `localStorage`. **Full chart** is the real TradingView advanced chart or the DexScreener pool chart.

The **Fear & Greed** strip sits above the blotter: crypto from Alternative.me, US stocks from CNN. Click a card when you want the chart, alerts, and outbound links — there is no persistent IN FOCUS column.

Under it, the **Weather** panel follows one city (Toronto until you pick another). It covers conditions, feels-like, wind chill or humidex, today's high and low, wind and gusts, humidity and dew point, the pressure trend, visibility, UV, precipitation, sunrise and sunset, the past 3 hours (what the temperature did and how much fell), tonight and tomorrow, the next 24 hours, and 7 days. Air quality is the US AQI measured at the nearest monitoring station (via WAQI, the same scale IQAir uses), with a per-pollutant breakdown, plus pollen where Open-Meteo has it (Europe). Active warnings from Environment Canada or the US National Weather Service appear across the top.

Each bay links out to TradingView, DexScreener, CMC, Yahoo, or Solscan depending on the name.

## Does this cost money?

For this repo: **no.**

| Feed                | Cost             | Notes                                                                                                                                                                                             |
| ------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CoinGecko Demo      | Free             | Majors. Called straight from the browser (CORS-open); a proxy would share Cloudflare's rate-limited IPs.                                                                                          |
| DexScreener         | Free, no key     | ZCAT + any future meme.                                                                                                                                                                           |
| GeckoTerminal       | Free             | ZCAT candles when the pool quotes USD-like prices.                                                                                                                                                |
| CNBC quote feed     | Free, unofficial | Equities / SPX in one batched request.                                                                                                                                                            |
| Alternative.me F&G  | Free, no key     | Crypto fear & greed, daily. Vite proxy.                                                                                                                                                           |
| CNN Fear & Greed    | Free, unofficial | US stock sentiment plus the seven component readings. Vite proxy; needs a browser-like User-Agent.                                                                                                |
| Yahoo chart API     | Free, unofficial | Optional 1-day seed for the stock short-tape. Ignored if Yahoo 429s.                                                                                                                              |
| TradingView widgets | Free             | Same charts you already use. The licensed Charting Library is **not** used.                                                                                                                       |
| Open-Meteo          | Free, no key     | Forecast and city search, plus a modelled air-quality estimate used only when no monitor is available. Called directly from the browser (CORS-open); free for non-commercial use, ~10k calls/day. |
| Environment Canada  | Free, no key     | GeoMet API weather alerts for Canadian cities.                                                                                                                                                    |
| WAQI (aqicn.org)    | Free token       | Measured AQI from official monitors (Air Quality Ontario for Toronto). Optional; the Vite proxy adds `WAQI_TOKEN` so it never reaches the browser. Non-commercial use.                            |
| NWS (weather.gov)   | Free, no key     | Active watches, warnings, and advisories for US cities.                                                                                                                                           |
| CoinMarketCap       | Not used         | Basic plan is free with a key (~10k credits/mo) but the key cannot sit in a browser app. A tiny proxy would be required. CoinGecko covers the same majors.                                        |

Paid upgrades only if you outgrow this: CMC Pro, Polygon / Twelve Data for stocks, TradingView Charting Library for a white-label TV clone.

## Put it online

`pnpm run deploy` builds the site and ships it as a Cloudflare Worker. The page files are static assets (free, unlimited); only `/api/*` runs the Worker, which proxies the same feeds as the dev server (`worker/api-routes.ts` is the one table both read). Cloudflare Access puts a login in front of the whole Worker. The Worker also checks the Access login itself, so `/api` stays closed (403) if Access is ever off.

1. Create a Cloudflare account and open **Zero Trust**. Pick a team name and the **Free** plan (it asks for a card; the free plan is not charged).
2. Put the team name in `wrangler.jsonc` as `ACCESS_TEAM` (the `<team>` in `<team>.cloudflareaccess.com`).
3. `pnpm exec wrangler login`, then `pnpm run deploy`. It prints the `https://night-tape.<you>.workers.dev` URL.
4. Optional: `pnpm exec wrangler secret put WAQI_TOKEN` and paste the token.
5. Dashboard → **Workers & Pages** → `night-tape` → **Access** → **Protect this Worker behind Access** → **All traffic**, allow your email, **Apply Access**.
6. Open the URL in a private window. You should get the Cloudflare login first, then the desk.

To try the Worker build locally, `pnpm run preview:worker` (port 8787). The `access.dev` block in `wrangler.jsonc` makes `wrangler dev` act signed in. Put `WAQI_TOKEN=…` in `.dev.vars` for air quality there.

Free-plan budget: 100,000 Worker requests a day. The default desk makes 2 per 20-second poll (CoinGecko goes direct), so roughly 8,600 for a tab left visible all day.

## Weather

For measured air quality, get a free token at [aqicn.org/data-platform/token](https://aqicn.org/data-platform/token/) (name and email; the token arrives by email), then:

```bash
echo "WAQI_TOKEN=your-token" >> .env.local
pnpm run dev   # restart so Vite picks it up
```

`.env.local` is gitignored. Without a token, or when no monitor within 50 km has reported in the last 8 hours, the panel shows Open-Meteo's model estimate and labels it as one. The model can run noticeably high or low.

Click the city name to search for another one (`Paris, France` or `London, ON` narrows it down). °C/°F switches temperature, wind, pressure (kPa / inHg), visibility, and precipitation together. The chevron folds the panel into a one-line summary. City, units, and the folded state save in this browser (`night-tape.weather.v1`) and sync between tabs. The forecast refreshes every 10 minutes.

Wind chill and humidex use the Environment Canada formulas and only show when they apply: wind chill at 10 °C or colder with some wind, humidex from 20 °C. US cities use the NWS heat index instead of humidex. When neither applies right now, the tile shows the coldest wind chill or hottest humidex expected in the next 24 hours.

## Alerts

Arm a tripwire on the focused name: price above, price below, or session move ≥ N%. Trips show as lamp toasts, in the trip log, a short desk-bell chime, and as desktop notifications if you click **Enable alerts**.

## Add a name

Use the watchlist search (`/` to focus). It hunts CoinGecko, DexScreener, and Yahoo at once:

- Coins → CoinGecko + TradingView
- Memes / mint addresses → DexScreener
- Tickers (NVDA, SPY, `BRK-B`) → CNBC quotes + TradingView

Selections, card order, focused asset, and price alerts save immediately in this browser. Drag cards to reorder, or choose **Arrange** and use the arrows with a keyboard or touch. Remove any card with **×** or **Remove from watchlist**, including S&P 500 and the final card. An empty watchlist stays empty until you add something.

The starter list in `src/lib/assets.ts` only seeds a new desk. Existing saved data migrates automatically, preserving custom assets, hidden starters, and order. The `night-tape.v1` localStorage entry now stores the complete ordered watchlist in `assets`; it is never merged with the defaults after migration. Re-added assets go at the end. Changes sync between open tabs on the same origin. If storage is full, cached quote history is discarded before your choices; if saving is unavailable, the UI says so.

Run `pnpm test` for persistence regressions, `pnpm run check` for Svelte/TypeScript validation, and `pnpm run build` for the production build.
