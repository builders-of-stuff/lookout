export type AssetKind = "crypto" | "dex" | "equity" | "index";

export type AssetLink = {
  label: string;
  href: string;
};

export type Asset = {
  id: string;
  symbol: string;
  name: string;
  kind: AssetKind;
  geckoId?: string;
  yahooSymbol?: string;
  cnbcSymbol?: string;
  tokenAddress?: string;
  chain?: string;
  tradingView?: string;
  dexEmbed?: string;
  links: AssetLink[];
};

export type Quote = {
  id: string;
  price: number;
  changePct: number;
  changeAbs: number;
  marketCap?: number;
  volume?: number;
  liquidity?: number;
  dayLow?: number;
  dayHigh?: number;
  windows?: {
    m5?: number;
    h1?: number;
    h6?: number;
    h24?: number;
  };
  source: string;
  asOf: number;
  pairAddress?: string;
  pairUrl?: string;
};

export type Tick = {
  t: number;
  p: number;
};

export type AlertKind = "above" | "below" | "move";

export type AlertRule = {
  id: string;
  assetId: string;
  kind: AlertKind;
  value: number;
  enabled: boolean;
  lastFiredAt?: number;
};

export type AlertEvent = {
  id: string;
  ruleId: string;
  assetId: string;
  message: string;
  at: number;
  price: number;
};

export type DeskState = {
  quotes: Record<string, Quote>;
  ticks: Record<string, Tick[]>;
  rules: AlertRule[];
  events: AlertEvent[];
  focusId: string;
  /** The user's complete watchlist, in display order. Defaults only seed a new desk. */
  assets: Asset[];
};

export type FearGreedBand =
  "extreme-fear" | "fear" | "neutral" | "greed" | "extreme-greed";

export type FearGreedMarket = "crypto" | "stocks";

export type FearGreedLeg = {
  id: string;
  label: string;
  score: number;
  band: FearGreedBand;
};

export type FearGreedReading = {
  market: FearGreedMarket;
  score: number;
  band: FearGreedBand;
  label: string;
  asOf: number;
  previous?: number;
  weekAgo?: number;
  history: number[];
  legs?: FearGreedLeg[];
  source: string;
  href: string;
};

export type FearGreedState = {
  crypto: FearGreedReading | null;
  stocks: FearGreedReading | null;
  errors: string[];
  updatedAt: number | null;
};

export type WeatherUnits = "metric" | "imperial";

export type WeatherPlace = {
  id: string;
  name: string;
  region?: string;
  country?: string;
  countryCode?: string;
  latitude: number;
  longitude: number;
  timezone?: string;
};

export type PressureTrend = "rising" | "falling" | "steady";

/** Raw readings stay metric (°C, km/h, hPa, m, mm); the UI converts on display. */
export type WeatherNow = {
  time: number;
  temp: number;
  feelsLike: number;
  humidity: number;
  dewPoint: number;
  windSpeed: number;
  windGust: number;
  windDir: number;
  pressure: number;
  pressureTrend?: PressureTrend;
  pressureDelta?: number;
  visibility?: number;
  cloudCover: number;
  uv?: number;
  code: number;
  isDay: boolean;
};

export type WeatherHour = {
  time: number;
  temp: number;
  feelsLike?: number;
  humidity?: number;
  dewPoint?: number;
  windSpeed?: number;
  precipChance?: number;
  /** mm that fell, or is forecast to fall, during the hour starting at `time`. */
  precip?: number;
  code: number;
  isDay: boolean;
};

export type WeatherDay = {
  time: number;
  code: number;
  high: number;
  low: number;
  precip?: number;
  precipChance?: number;
  windMax?: number;
  gustMax?: number;
  uvMax?: number;
  sunrise?: number;
  sunset?: number;
  daylight?: number;
};

export type WeatherForecast = {
  timezone: string;
  now: WeatherNow;
  /** The hours just before the current one, oldest first. */
  past: WeatherHour[];
  hours: WeatherHour[];
  days: WeatherDay[];
};

export type AirPollen = {
  id: string;
  label: string;
  value: number;
};

/** Open-Meteo's modelled air: the fallback when no monitor is close enough. */
export type AirQuality = {
  time: number;
  usAqi?: number;
  pollen: AirPollen[];
};

export type AirPollutantId = "pm25" | "pm10" | "o3" | "no2" | "so2" | "co";

export type AirReading = {
  /** US EPA AQI measured at the nearest monitoring station. */
  aqi: number;
  dominant?: AirPollutantId;
  /** Per-pollutant sub-indices on the same US AQI scale. */
  pollutants: Array<{ id: AirPollutantId; aqi: number }>;
  station: string;
  distanceKm: number;
  observedAt: number;
  attributions: string[];
  href: string;
};

export type MeasuredAir =
  | { kind: "station"; reading: AirReading }
  | { kind: "needs-token" }
  | { kind: "none-nearby" };

export type WeatherAlert = {
  id: string;
  title: string;
  level: "warning" | "watch" | "advisory" | "statement";
  colour?: string;
  area?: string;
  text?: string;
  instruction?: string;
  ends?: number;
  source: string;
  href: string;
};

export type WeatherReport = {
  place: WeatherPlace;
  forecast: WeatherForecast;
  air: AirQuality | null;
  measured: MeasuredAir | null;
  alerts: WeatherAlert[];
  errors: string[];
  fetchedAt: number;
};
