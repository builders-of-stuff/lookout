import type {
  AirPollen,
  AirPollutantId,
  AirQuality,
  MeasuredAir,
  PressureTrend,
  WeatherAlert,
  WeatherDay,
  WeatherForecast,
  WeatherHour,
  WeatherPlace,
  WeatherReport,
  WeatherUnits,
} from "./types";

// Still the pre-rename Night Tape key, so saved settings carry over.
export const WEATHER_KEY = "night-tape.weather.v1";
export const WEATHER_POLL_MS = 10 * 60_000;
/** How far back the hourly strip and the recap look. */
export const PAST_HOURS = 3;
/** A cached report older than this is worse than a loading state. */
export const WEATHER_CACHE_MS = 3 * 60 * 60_000;

const HOUR = 3_600_000;

export const TORONTO: WeatherPlace = {
  id: "6167865",
  name: "Toronto",
  region: "Ontario",
  country: "Canada",
  countryCode: "CA",
  latitude: 43.70643,
  longitude: -79.39864,
  timezone: "America/Toronto",
};

// NWS covers the states plus these territories.
const NWS_COUNTRIES = new Set(["US", "PR", "GU", "VI", "AS", "MP"]);

/* ------------------------------------------------------------------ sky -- */

export type SkyKind =
  | "clear"
  | "partly"
  | "cloudy"
  | "fog"
  | "drizzle"
  | "rain"
  | "sleet"
  | "snow"
  | "storm";

const WMO: Record<number, [string, SkyKind]> = {
  0: ["Clear", "clear"],
  1: ["Mainly clear", "partly"],
  2: ["Partly cloudy", "partly"],
  3: ["Overcast", "cloudy"],
  45: ["Fog", "fog"],
  48: ["Freezing fog", "fog"],
  51: ["Light drizzle", "drizzle"],
  53: ["Drizzle", "drizzle"],
  55: ["Heavy drizzle", "drizzle"],
  56: ["Freezing drizzle", "sleet"],
  57: ["Heavy freezing drizzle", "sleet"],
  61: ["Light rain", "rain"],
  63: ["Rain", "rain"],
  65: ["Heavy rain", "rain"],
  66: ["Freezing rain", "sleet"],
  67: ["Heavy freezing rain", "sleet"],
  71: ["Light snow", "snow"],
  73: ["Snow", "snow"],
  75: ["Heavy snow", "snow"],
  77: ["Snow grains", "snow"],
  80: ["Light showers", "rain"],
  81: ["Showers", "rain"],
  82: ["Violent showers", "rain"],
  85: ["Snow showers", "snow"],
  86: ["Heavy snow showers", "snow"],
  95: ["Thunderstorms", "storm"],
  96: ["Thunderstorms with hail", "storm"],
  99: ["Severe thunderstorms with hail", "storm"],
};

export function describeSky(code: number): { label: string; kind: SkyKind } {
  const [label, kind] = WMO[code] ?? ["Unsettled", "cloudy"];
  return { label, kind };
}

const WET: Partial<Record<SkyKind, string>> = {
  drizzle: "Drizzle",
  rain: "Rain",
  sleet: "Freezing rain",
  snow: "Snow",
  storm: "Thunderstorms",
};

function wetNoun(code: number): string | undefined {
  if (code >= 80 && code <= 82) return "Showers";
  return WET[describeSky(code).kind];
}

function isWetHour(hour: WeatherHour): boolean {
  return Boolean(wetNoun(hour.code)) && (hour.precipChance ?? 100) >= 40;
}

/**
 * The next run of night hours: its coldest reading and its roughest likely sky.
 * Higher WMO codes are the wetter, stormier ones, but a wet code only counts
 * when that hour clears the same 40% bar as the precipitation outlook.
 */
export function nightAhead(
  hours: WeatherHour[],
): { label: "Tonight" | "Overnight"; low: number; code: number } | null {
  const start = hours.findIndex((hour) => !hour.isDay);
  if (start < 0) return null;
  const end = hours.findIndex((hour, i) => i > start && hour.isDay);
  const night = hours.slice(start, end < 0 ? undefined : end);
  // Drop wet hours the model itself doubts. If that is every hour, call it cloudy.
  const likely = night.filter((hour) => !wetNoun(hour.code) || isWetHour(hour));
  const code = likely.length ? Math.max(...likely.map((hour) => hour.code)) : 3;
  return {
    label: start === 0 ? "Overnight" : "Tonight",
    low: Math.min(...night.map((hour) => hour.temp)),
    code,
  };
}

/**
 * Looking back, the amounts are the better witness than the weather code: a wet
 * code with nothing in the bucket reads as cloud, a measurable amount as rain.
 */
export function settledCode(hour: WeatherHour): number {
  const wet = Boolean(wetNoun(hour.code));
  const fell = (hour.precip ?? 0) >= 0.1;
  if (wet && !fell) return 3;
  if (!wet && fell) return hour.temp <= 0 ? 71 : 61;
  return hour.code;
}

/** The last few hours in brief: where the temperature started, what fell, the roughest sky. */
export function pastSummary(
  past: WeatherHour[],
): { since: number; startTemp: number; total: number; code: number } | null {
  if (!past.length) return null;
  return {
    since: past[0].time,
    startTemp: past[0].temp,
    total: past.reduce((sum, hour) => sum + (hour.precip ?? 0), 0),
    code: Math.max(...past.map(settledCode)),
  };
}

/** One plain sentence about rain or snow over the next day. */
export function precipOutlook(
  nowCode: number,
  hours: WeatherHour[],
  timeZone?: string,
): string {
  const ahead = hours.slice(1, 25);
  const current = wetNoun(nowCode);
  if (current) {
    const dry = ahead.find((hour) => !isWetHour(hour));
    return dry
      ? `${current} now, easing by ${formatHour(dry.time, timeZone)}`
      : `${current} through the next 24 hours`;
  }
  const wet = ahead.find(isWetHour);
  if (!wet) return "Dry through the next 24 hours";
  const chance = wet.precipChance != null ? ` (${Math.round(wet.precipChance)}%)` : "";
  return `${wetNoun(wet.code)} likely around ${formatHour(wet.time, timeZone)}${chance}`;
}

/* ---------------------------------------------------------- feels-like -- */

/** Environment Canada / NWS wind chill. Defined at ≤ 10 °C with wind ≥ 4.8 km/h. */
export function windChill(tempC: number, windKmh: number): number | null {
  if (!Number.isFinite(tempC) || !Number.isFinite(windKmh)) return null;
  if (tempC > 10 || windKmh < 4.8) return null;
  const v = windKmh ** 0.16;
  return 13.12 + 0.6215 * tempC - 11.37 * v + 0.3965 * tempC * v;
}

/** Canadian humidex. Environment Canada reports it from 20 °C once it reaches 25. */
export function humidex(tempC: number, dewPointC: number): number | null {
  if (!Number.isFinite(tempC) || !Number.isFinite(dewPointC) || tempC < 20) return null;
  const vapour = 6.11 * Math.exp(5417.753 * (1 / 273.16 - 1 / (273.15 + dewPointC)));
  const value = tempC + 0.5555 * (vapour - 10);
  return value >= 25 && value - tempC >= 1 ? value : null;
}

/** NWS heat index (Rothfusz regression with the usual adjustments). From 80 °F, when it adds heat. */
export function heatIndex(tempC: number, humidity: number): number | null {
  if (!Number.isFinite(tempC) || !Number.isFinite(humidity)) return null;
  const t = (tempC * 9) / 5 + 32;
  if (t < 80) return null;
  const rh = humidity;
  let hi = 0.5 * (t + 61 + (t - 68) * 1.2 + rh * 0.094);
  if ((hi + t) / 2 >= 80) {
    hi =
      -42.379 +
      2.04901523 * t +
      10.14333127 * rh -
      0.22475541 * t * rh -
      0.00683783 * t * t -
      0.05481717 * rh * rh +
      0.00122874 * t * t * rh +
      0.00085282 * t * rh * rh -
      0.00000199 * t * t * rh * rh;
    if (rh < 13 && t <= 112) {
      hi -= ((13 - rh) / 4) * Math.sqrt((17 - Math.abs(t - 95)) / 17);
    } else if (rh > 85 && t <= 87) {
      hi += ((rh - 85) / 10) * ((87 - t) / 5);
    }
  }
  // In dry heat the index can dip under the air temperature; that tells no one anything.
  return hi - t >= 1 ? ((hi - 32) * 5) / 9 : null;
}

export type ThermalKind = "wind-chill" | "humidex" | "heat-index";

export type ThermalIndex = {
  kind: ThermalKind;
  now: number | null;
  /** Coldest wind chill or hottest humidex / heat index over the next 24 hours. */
  extreme: { value: number; time: number } | null;
};

export const THERMAL_LABEL: Record<ThermalKind, string> = {
  "wind-chill": "Wind chill",
  humidex: "Humidex",
  "heat-index": "Heat index",
};

/** The °C at which each index starts to count, for the "not a factor" note. */
export const THERMAL_THRESHOLD: Record<ThermalKind, number> = {
  "wind-chill": 10,
  humidex: 20,
  "heat-index": 26.7,
};

export function thermalIndex(
  forecast: WeatherForecast,
  countryCode?: string,
): ThermalIndex {
  const hotKind: ThermalKind = countryCode === "CA" ? "humidex" : "heat-index";
  const hot = (temp: number, dewPoint = NaN, humidity = NaN) =>
    hotKind === "humidex" ? humidex(temp, dewPoint) : heatIndex(temp, humidity);
  const { now, hours } = forecast;
  const chillNow = windChill(now.temp, now.windSpeed);
  const hotNow = hot(now.temp, now.dewPoint, now.humidity);
  let chillPeak: ThermalIndex["extreme"] = null;
  let hotPeak: ThermalIndex["extreme"] = null;
  for (const hour of hours.slice(0, 25)) {
    const chill = windChill(hour.temp, hour.windSpeed ?? NaN);
    if (chill != null && (!chillPeak || chill < chillPeak.value)) {
      chillPeak = { value: chill, time: hour.time };
    }
    const heat = hot(hour.temp, hour.dewPoint, hour.humidity);
    if (heat != null && (!hotPeak || heat > hotPeak.value)) {
      hotPeak = { value: heat, time: hour.time };
    }
  }
  if (chillNow != null)
    return { kind: "wind-chill", now: chillNow, extreme: chillPeak };
  if (hotNow != null) return { kind: hotKind, now: hotNow, extreme: hotPeak };
  if (chillPeak && (!hotPeak || now.temp < 15)) {
    return { kind: "wind-chill", now: null, extreme: chillPeak };
  }
  if (hotPeak) return { kind: hotKind, now: null, extreme: hotPeak };
  return { kind: now.temp >= 20 ? hotKind : "wind-chill", now: null, extreme: null };
}

/* ------------------------------------------------------------- context -- */

const POINTS = [
  "N",
  "NNE",
  "NE",
  "ENE",
  "E",
  "ESE",
  "SE",
  "SSE",
  "S",
  "SSW",
  "SW",
  "WSW",
  "W",
  "WNW",
  "NW",
  "NNW",
];

export function compass(degrees: number): string {
  if (!Number.isFinite(degrees)) return "—";
  const normal = ((degrees % 360) + 360) % 360;
  return POINTS[Math.round(normal / 22.5) % 16];
}

const BEAUFORT: Array<[number, string]> = [
  [1, "Calm"],
  [6, "Light air"],
  [12, "Light breeze"],
  [20, "Gentle breeze"],
  [29, "Moderate breeze"],
  [39, "Fresh breeze"],
  [50, "Strong breeze"],
  [62, "Near gale"],
  [75, "Gale"],
  [89, "Strong gale"],
  [103, "Storm"],
  [118, "Violent storm"],
];

export function beaufort(windKmh: number): string {
  if (!Number.isFinite(windKmh)) return "—";
  for (const [limit, label] of BEAUFORT) if (windKmh < limit) return label;
  return "Hurricane force";
}

export function dewComfort(dewPointC: number): string {
  if (!Number.isFinite(dewPointC)) return "—";
  if (dewPointC < 10) return "Dry";
  if (dewPointC < 16) return "Comfortable";
  if (dewPointC < 19) return "Sticky";
  if (dewPointC < 22) return "Muggy";
  return "Oppressive";
}

export function uvLabel(uv: number | undefined): string {
  if (uv == null || !Number.isFinite(uv)) return "—";
  const n = Math.round(uv);
  if (n <= 2) return "Low";
  if (n <= 5) return "Moderate";
  if (n <= 7) return "High";
  if (n <= 10) return "Very high";
  return "Extreme";
}

export function visibilityLabel(metres: number | undefined): string {
  if (metres == null || !Number.isFinite(metres)) return "—";
  if (metres >= 20_000) return "Excellent";
  if (metres >= 10_000) return "Good";
  if (metres >= 4_000) return "Moderate";
  if (metres >= 1_000) return "Poor";
  return "Fog";
}

export function pressureTrend(delta: number | undefined): PressureTrend | undefined {
  if (delta == null || !Number.isFinite(delta)) return undefined;
  // 0.1 kPa over three hours is the forecaster's line for "steady".
  if (Math.abs(delta) < 1) return "steady";
  return delta > 0 ? "rising" : "falling";
}

/* --------------------------------------------------------- air quality -- */

export type UsAqiBand =
  "good" | "moderate" | "sensitive" | "unhealthy" | "very-unhealthy" | "hazardous";

export const US_AQI_BANDS: Array<{
  band: UsAqiBand;
  max: number;
  label: string;
  advice: string;
}> = [
  { band: "good", max: 50, label: "Good", advice: "Air quality is satisfactory." },
  {
    band: "moderate",
    max: 100,
    label: "Moderate",
    advice: "Unusually sensitive people should ease off long or heavy exertion.",
  },
  {
    band: "sensitive",
    max: 150,
    label: "Unhealthy for sensitive groups",
    advice:
      "People with heart or lung disease, older adults, and kids should cut back.",
  },
  {
    band: "unhealthy",
    max: 200,
    label: "Unhealthy",
    advice: "Everyone should reduce long or heavy exertion outdoors.",
  },
  {
    band: "very-unhealthy",
    max: 300,
    label: "Very unhealthy",
    advice: "Everyone should avoid long or heavy exertion outdoors.",
  },
  {
    band: "hazardous",
    max: Infinity,
    label: "Hazardous",
    advice: "Everyone should avoid all physical activity outdoors.",
  },
];

export function usAqiInfo(aqi: number) {
  return US_AQI_BANDS.find((row) => aqi <= row.max) ?? US_AQI_BANDS.at(-1)!;
}

export const POLLUTANT_LABEL: Record<AirPollutantId, string> = {
  pm25: "PM2.5",
  pm10: "PM10",
  o3: "O₃",
  no2: "NO₂",
  so2: "SO₂",
  co: "CO",
};

const POLLUTANT_IDS = Object.keys(POLLUTANT_LABEL) as AirPollutantId[];

/** A monitor farther away than this is describing somewhere else. */
export const STATION_RANGE_KM = 50;
/**
 * Monitors report hourly but some feeds lag by hours (Paris often runs ~4h
 * behind). An older measurement still beats the model; past this it doesn't.
 */
const STATION_STALE_MS = 8 * HOUR;

const POLLEN: Array<[string, string]> = [
  ["alder_pollen", "Alder"],
  ["birch_pollen", "Birch"],
  ["grass_pollen", "Grass"],
  ["mugwort_pollen", "Mugwort"],
  ["olive_pollen", "Olive"],
  ["ragweed_pollen", "Ragweed"],
];

/* ------------------------------------------------------------- parsing -- */

type Series = Record<string, unknown>;

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function column(series: Series | undefined, key: string): unknown[] {
  const values = series?.[key];
  return Array.isArray(values) ? values : [];
}

function cell(series: Series | undefined, key: string, index: number) {
  return num(column(series, key)[index]);
}

const seconds = (value: number | undefined) =>
  value == null ? undefined : value * 1000;

function checkOpenMeteo(root: { error?: unknown; reason?: unknown } | null) {
  if (root?.error)
    throw new Error(`Open-Meteo: ${String(root.reason ?? "request failed")}`);
}

export function parseForecast(payload: unknown): WeatherForecast {
  const root = payload as {
    timezone?: unknown;
    current?: Series;
    hourly?: Series;
    daily?: Series;
    error?: unknown;
    reason?: unknown;
  } | null;
  checkOpenMeteo(root);
  const c = root?.current ?? {};
  const temp = num(c.temperature_2m);
  const time = seconds(num(c.time));
  if (temp == null || time == null) {
    throw new Error("Open-Meteo returned no current conditions");
  }

  const hourly = root?.hourly;
  const all: WeatherHour[] = [];
  column(hourly, "time").forEach((_, i) => {
    const at = seconds(cell(hourly, "time", i));
    const hourTemp = cell(hourly, "temperature_2m", i);
    if (at == null || hourTemp == null) return;
    all.push({
      time: at,
      temp: hourTemp,
      feelsLike: cell(hourly, "apparent_temperature", i),
      humidity: cell(hourly, "relative_humidity_2m", i),
      dewPoint: cell(hourly, "dew_point_2m", i),
      windSpeed: cell(hourly, "wind_speed_10m", i),
      precipChance: cell(hourly, "precipitation_probability", i),
      // Open-Meteo sums precipitation over the hour *before* each timestamp;
      // shift it so every hour holds what falls during it.
      precip: cell(hourly, "precipitation", i + 1),
      code: cell(hourly, "weather_code", i) ?? 0,
      isDay: cell(hourly, "is_day", i) !== 0,
    });
  });
  const start = Math.max(
    0,
    all.findLastIndex((hour) => hour.time <= time),
  );

  const pressure = num(c.pressure_msl) ?? NaN;
  const pastIndex = column(hourly, "time").findLastIndex(
    (_, i) => (seconds(cell(hourly, "time", i)) ?? Infinity) <= time - 3 * HOUR,
  );
  const pastPressure =
    pastIndex >= 0 ? cell(hourly, "pressure_msl", pastIndex) : undefined;
  const pressureDelta =
    pastPressure != null && Number.isFinite(pressure)
      ? pressure - pastPressure
      : undefined;

  const daily = root?.daily;
  const days: WeatherDay[] = [];
  column(daily, "time").forEach((_, i) => {
    const at = seconds(cell(daily, "time", i));
    const high = cell(daily, "temperature_2m_max", i);
    const low = cell(daily, "temperature_2m_min", i);
    if (at == null || high == null || low == null) return;
    days.push({
      time: at,
      code: cell(daily, "weather_code", i) ?? 0,
      high,
      low,
      precip: cell(daily, "precipitation_sum", i),
      precipChance: cell(daily, "precipitation_probability_max", i),
      windMax: cell(daily, "wind_speed_10m_max", i),
      gustMax: cell(daily, "wind_gusts_10m_max", i),
      uvMax: cell(daily, "uv_index_max", i),
      sunrise: seconds(cell(daily, "sunrise", i)),
      sunset: seconds(cell(daily, "sunset", i)),
      daylight: cell(daily, "daylight_duration", i),
    });
  });

  return {
    timezone: typeof root?.timezone === "string" ? root.timezone : "UTC",
    now: {
      time,
      temp,
      feelsLike: num(c.apparent_temperature) ?? temp,
      humidity: num(c.relative_humidity_2m) ?? NaN,
      dewPoint: num(c.dew_point_2m) ?? NaN,
      windSpeed: num(c.wind_speed_10m) ?? NaN,
      windGust: num(c.wind_gusts_10m) ?? NaN,
      windDir: num(c.wind_direction_10m) ?? NaN,
      pressure,
      pressureDelta,
      pressureTrend: pressureTrend(pressureDelta),
      visibility: num(c.visibility),
      cloudCover: num(c.cloud_cover) ?? NaN,
      uv: num(c.uv_index),
      code: num(c.weather_code) ?? 0,
      isDay: c.is_day !== 0,
    },
    past: all.slice(Math.max(0, start - PAST_HOURS), start),
    hours: all.slice(start, start + 25),
    days,
  };
}

export function parseAirQuality(payload: unknown, nowMs = Date.now()): AirQuality {
  const root = payload as {
    current?: Series;
    error?: unknown;
    reason?: unknown;
  } | null;
  checkOpenMeteo(root);
  const c = root?.current ?? {};
  const pollen: AirPollen[] = [];
  for (const [id, label] of POLLEN) {
    const value = num(c[id]);
    if (value != null) pollen.push({ id, label, value });
  }
  const usAqi = num(c.us_aqi);
  if (usAqi == null && !pollen.length) {
    throw new Error("Open-Meteo returned no air quality reading");
  }
  return { time: seconds(num(c.time)) ?? nowMs, usAqi, pollen };
}

export function distanceKm(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
): number {
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLon = (bLon - aLon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

type Feature = {
  id?: unknown;
  properties?: Record<string, unknown>;
};

function features(payload: unknown): Feature[] {
  const list = (payload as { features?: unknown } | null)?.features;
  return Array.isArray(list) ? (list as Feature[]) : [];
}

/**
 * WAQI's nearest monitor to a point, on the US EPA AQI scale (the same scale
 * IQAir uses). The geo feed always answers with *some* station, so anything
 * far away or stale counts as no reading at all.
 */
export function parseWaqi(
  payload: unknown,
  place: WeatherPlace,
  nowMs = Date.now(),
): MeasuredAir {
  const root = payload as { status?: unknown; data?: unknown } | null;
  if (root?.status === "error") {
    const why = String(root.data ?? "");
    if (/invalid key/i.test(why)) return { kind: "needs-token" };
    throw new Error(`WAQI: ${why || "request failed"}`);
  }
  if (root?.status !== "ok") throw new Error("WAQI returned no reading");
  const data = (root.data ?? {}) as {
    aqi?: unknown;
    dominentpol?: unknown;
    iaqi?: Record<string, { v?: unknown } | undefined>;
    city?: { geo?: unknown; name?: unknown; url?: unknown };
    time?: { iso?: unknown };
    attributions?: unknown;
  };
  // A station between readings reports its AQI as "-".
  const aqi = data.aqi == null || data.aqi === "" ? undefined : num(Number(data.aqi));
  const geo = data.city?.geo;
  const observedAt = Date.parse(String(data.time?.iso ?? ""));
  if (
    aqi == null ||
    !Array.isArray(geo) ||
    num(geo[0]) == null ||
    num(geo[1]) == null ||
    !Number.isFinite(observedAt)
  ) {
    return { kind: "none-nearby" };
  }
  const away = distanceKm(place.latitude, place.longitude, geo[0], geo[1]);
  if (away > STATION_RANGE_KM || nowMs - observedAt > STATION_STALE_MS) {
    return { kind: "none-nearby" };
  }
  const pollutants = POLLUTANT_IDS.flatMap((id) => {
    const value = num(data.iaqi?.[id]?.v);
    return value == null ? [] : [{ id, aqi: value }];
  });
  const attributions = (Array.isArray(data.attributions) ? data.attributions : [])
    .map((row: { name?: unknown }) => (typeof row?.name === "string" ? row.name : ""))
    .filter((name) => name && !/world air quality index/i.test(name));
  return {
    kind: "station",
    reading: {
      aqi,
      dominant: POLLUTANT_IDS.find((id) => id === data.dominentpol),
      pollutants,
      // "Toronto Downtown, Toronto, Canada" → "Toronto Downtown"
      station: String(data.city?.name ?? place.name)
        .split(",")[0]
        .trim(),
      distanceKm: away,
      observedAt,
      attributions,
      href: typeof data.city?.url === "string" ? data.city.url : "https://aqicn.org/",
    },
  };
}

const ALERT_LEVELS: WeatherAlert["level"][] = [
  "warning",
  "watch",
  "advisory",
  "statement",
];
const COLOUR_RANK: Record<string, number> = { red: 0, orange: 1, yellow: 2 };

function sortAlerts(alerts: WeatherAlert[]): WeatherAlert[] {
  return alerts.sort(
    (a, b) =>
      ALERT_LEVELS.indexOf(a.level) - ALERT_LEVELS.indexOf(b.level) ||
      (COLOUR_RANK[a.colour ?? ""] ?? 3) - (COLOUR_RANK[b.colour ?? ""] ?? 3),
  );
}

/** Feeds hard-wrap at ~70 columns; keep the paragraph breaks, drop the rest. */
export function unwrap(text: unknown): string | undefined {
  if (typeof text !== "string" || !text.trim()) return undefined;
  return text
    .trim()
    .replace(/\r/g, "")
    .replace(/([^\n])\n(?!\n)/g, "$1 ")
    .replace(/\n{3,}/g, "\n\n");
}

function capitalize(text: string): string {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

function optionalTime(value: unknown): number | undefined {
  const time = Date.parse(String(value ?? ""));
  return Number.isFinite(time) ? time : undefined;
}

export function ecccHref(place: WeatherPlace): string {
  return `https://weather.gc.ca/en/location/index.html?coords=${place.latitude.toFixed(3)},${place.longitude.toFixed(3)}`;
}

export function nwsHref(place: WeatherPlace): string {
  return `https://forecast.weather.gov/MapClick.php?lat=${place.latitude.toFixed(4)}&lon=${place.longitude.toFixed(4)}`;
}

export function parseEcccAlerts(
  payload: unknown,
  place: WeatherPlace,
  nowMs = Date.now(),
): WeatherAlert[] {
  const seen = new Set<string>();
  const alerts: WeatherAlert[] = [];
  for (const feature of features(payload)) {
    const p = feature.properties ?? {};
    const status = String(p.status_en ?? "").toLowerCase();
    if (status === "ended" || status === "cancelled") continue;
    const expires = optionalTime(p.expiration_datetime);
    const ends = optionalTime(p.event_end_datetime);
    if ((expires != null && expires < nowMs) || (ends != null && ends < nowMs))
      continue;
    const type = String(p.alert_type ?? "").toLowerCase();
    const level = ALERT_LEVELS.find((l) => l === type) ?? "statement";
    const title = capitalize(
      String(p.alert_name_en ?? p.alert_short_name_en ?? "Alert"),
    );
    const key = `${p.alert_code ?? title}:${level}`;
    if (seen.has(key)) continue;
    seen.add(key);
    alerts.push({
      id: String(feature.id ?? p.id ?? key),
      title,
      level,
      colour: typeof p.risk_colour_en === "string" ? p.risk_colour_en : undefined,
      area: typeof p.feature_name_en === "string" ? p.feature_name_en : undefined,
      text: unwrap(p.alert_text_en),
      ends,
      source: "Environment Canada",
      href: ecccHref(place),
    });
  }
  return sortAlerts(alerts);
}

const NWS_COLOUR: Record<string, string> = {
  Extreme: "red",
  Severe: "orange",
  Moderate: "yellow",
};

export function parseNwsAlerts(
  payload: unknown,
  place: WeatherPlace,
  nowMs = Date.now(),
): WeatherAlert[] {
  const seen = new Set<string>();
  const alerts: WeatherAlert[] = [];
  for (const feature of features(payload)) {
    const p = feature.properties ?? {};
    if (p.status !== "Actual" || p.urgency === "Past") continue;
    const expires = optionalTime(p.expires);
    const ends = optionalTime(p.ends);
    if ((expires != null && expires < nowMs) || (ends != null && ends < nowMs))
      continue;
    const title = String(p.event ?? "Alert");
    if (seen.has(title)) continue;
    seen.add(title);
    const lower = title.toLowerCase();
    const level =
      ALERT_LEVELS.find((l) => lower.includes(l)) ??
      (lower.includes("statement") ? "statement" : "advisory");
    alerts.push({
      id: String(p.id ?? feature.id ?? title),
      title,
      level,
      colour: NWS_COLOUR[String(p.severity)],
      area: typeof p.areaDesc === "string" ? p.areaDesc : undefined,
      text: unwrap(p.description),
      instruction: unwrap(p.instruction),
      ends: ends ?? expires,
      source: "National Weather Service",
      href: nwsHref(place),
    });
  }
  return sortAlerts(alerts);
}

export function parsePlaces(payload: unknown, query = ""): WeatherPlace[] {
  const rows = (payload as { results?: unknown } | null)?.results;
  if (!Array.isArray(rows)) return [];
  const places: WeatherPlace[] = [];
  for (const row of rows as Array<Record<string, unknown>>) {
    const latitude = num(row.latitude);
    const longitude = num(row.longitude);
    if (latitude == null || longitude == null || typeof row.name !== "string") continue;
    places.push({
      id: String(row.id ?? `${latitude},${longitude}`),
      name: row.name,
      region: typeof row.admin1 === "string" ? row.admin1 : undefined,
      country: typeof row.country === "string" ? row.country : undefined,
      countryCode: typeof row.country_code === "string" ? row.country_code : undefined,
      latitude,
      longitude,
      timezone: typeof row.timezone === "string" ? row.timezone : undefined,
    });
  }
  // "Toronto, ON" or "Portland, Maine": the geocoder only takes a name, so use
  // anything after the comma to float the matching region to the top.
  const hint = query.split(",").slice(1).join(" ").trim().toLowerCase();
  if (!hint) return places;
  const matches = (place: WeatherPlace) =>
    [place.region, place.country, place.countryCode].some((part) =>
      part?.toLowerCase().startsWith(hint),
    );
  return [...places.filter(matches), ...places.filter((place) => !matches(place))];
}

/* ------------------------------------------------------------ fetching -- */

const FORECAST_FIELDS = {
  current: [
    "temperature_2m",
    "relative_humidity_2m",
    "apparent_temperature",
    "dew_point_2m",
    "is_day",
    "weather_code",
    "cloud_cover",
    "pressure_msl",
    "wind_speed_10m",
    "wind_direction_10m",
    "wind_gusts_10m",
    "visibility",
    "uv_index",
  ],
  hourly: [
    "temperature_2m",
    "apparent_temperature",
    "relative_humidity_2m",
    "dew_point_2m",
    "precipitation_probability",
    "precipitation",
    "weather_code",
    "pressure_msl",
    "wind_speed_10m",
    "is_day",
  ],
  daily: [
    "weather_code",
    "temperature_2m_max",
    "temperature_2m_min",
    "sunrise",
    "sunset",
    "daylight_duration",
    "uv_index_max",
    "precipitation_sum",
    "precipitation_probability_max",
    "wind_speed_10m_max",
    "wind_gusts_10m_max",
  ],
};

const AIR_FIELDS = ["us_aqi", ...POLLEN.map(([id]) => id)];

function coords(place: WeatherPlace) {
  return {
    latitude: place.latitude.toFixed(4),
    longitude: place.longitude.toFixed(4),
  };
}

export function forecastUrl(place: WeatherPlace): string {
  const params = new URLSearchParams({
    ...coords(place),
    current: FORECAST_FIELDS.current.join(","),
    hourly: FORECAST_FIELDS.hourly.join(","),
    daily: FORECAST_FIELDS.daily.join(","),
    timezone: "auto",
    timeformat: "unixtime",
    // Enough history for the past strip and the 3-hour pressure trend.
    past_hours: String(Math.max(PAST_HOURS, 3)),
    forecast_hours: "26",
    forecast_days: "7",
  });
  return `https://api.open-meteo.com/v1/forecast?${params}`;
}

export function airQualityUrl(place: WeatherPlace): string {
  const params = new URLSearchParams({
    ...coords(place),
    current: AIR_FIELDS.join(","),
    timezone: "auto",
    timeformat: "unixtime",
  });
  return `https://air-quality-api.open-meteo.com/v1/air-quality?${params}`;
}

/** Same-origin: the Vite proxy adds WAQI_TOKEN so it never reaches the browser. */
export function waqiUrl(place: WeatherPlace): string {
  return `/api/waqi/feed/geo:${place.latitude.toFixed(4)};${place.longitude.toFixed(4)}/`;
}

const GEOMET = "https://api.weather.gc.ca/collections";

function bbox(place: WeatherPlace, latSpan: number, lonSpan: number) {
  return [
    place.longitude - lonSpan,
    place.latitude - latSpan,
    place.longitude + lonSpan,
    place.latitude + latSpan,
  ]
    .map((n) => n.toFixed(3))
    .join(",");
}

async function getJson(url: string, label: string): Promise<unknown> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`${label} ${res.status}`);
  return res.json();
}

export async function searchPlaces(query: string): Promise<WeatherPlace[]> {
  const name = query.split(",")[0].trim();
  if (name.length < 2) return [];
  const params = new URLSearchParams({
    name,
    count: "8",
    language: "en",
    format: "json",
  });
  return parsePlaces(
    await getJson(
      `https://geocoding-api.open-meteo.com/v1/search?${params}`,
      "Place search",
    ),
    query,
  );
}

async function fetchAlerts(place: WeatherPlace): Promise<WeatherAlert[]> {
  if (place.countryCode === "CA") {
    return parseEcccAlerts(
      await getJson(
        `${GEOMET}/weather-alerts/items?f=json&bbox=${bbox(place, 0.005, 0.005)}&limit=30`,
        "Environment Canada alerts",
      ),
      place,
    );
  }
  if (place.countryCode && NWS_COUNTRIES.has(place.countryCode)) {
    const point = `${place.latitude.toFixed(4)},${place.longitude.toFixed(4)}`;
    return parseNwsAlerts(
      await getJson(
        `https://api.weather.gov/alerts/active?point=${point}`,
        "NWS alerts",
      ),
      place,
    );
  }
  return [];
}

function reason(result: PromiseRejectedResult, label: string): string {
  return result.reason instanceof Error ? result.reason.message : `${label} failed`;
}

export function assembleWeather(
  place: WeatherPlace,
  forecast: PromiseSettledResult<WeatherForecast>,
  air: PromiseSettledResult<AirQuality>,
  measured: PromiseSettledResult<MeasuredAir>,
  alerts: PromiseSettledResult<WeatherAlert[]>,
  nowMs = Date.now(),
): WeatherReport {
  if (forecast.status === "rejected") throw new Error(reason(forecast, "Forecast"));
  const errors: string[] = [];
  const settle = <T>(
    result: PromiseSettledResult<T>,
    fallback: T,
    label: string,
  ): T => {
    if (result.status === "fulfilled") return result.value;
    errors.push(reason(result, label));
    return fallback;
  };
  return {
    place,
    forecast: forecast.value,
    air: settle<AirQuality | null>(air, null, "Air quality"),
    measured: settle<MeasuredAir | null>(measured, null, "WAQI"),
    alerts: settle(alerts, [], "Alerts"),
    errors,
    fetchedAt: nowMs,
  };
}

export async function fetchWeatherReport(place: WeatherPlace): Promise<WeatherReport> {
  const [forecast, air, measured, alerts] = await Promise.allSettled([
    getJson(forecastUrl(place), "Forecast").then(parseForecast),
    getJson(airQualityUrl(place), "Air quality").then((p) => parseAirQuality(p)),
    getJson(waqiUrl(place), "WAQI").then((p) => parseWaqi(p, place)),
    fetchAlerts(place),
  ]);
  return assembleWeather(place, forecast, air, measured, alerts);
}

/* ---------------------------------------------------------- formatting -- */

export function toTemp(celsius: number, units: WeatherUnits): number {
  return units === "imperial" ? (celsius * 9) / 5 + 32 : celsius;
}

export function formatTemp(celsius: number | null | undefined, units: WeatherUnits) {
  if (celsius == null || !Number.isFinite(celsius)) return "—";
  return `${Math.round(toTemp(celsius, units)) || 0}°`;
}

export const windUnit = (units: WeatherUnits) =>
  units === "imperial" ? "mph" : "km/h";

export function formatWind(kmh: number | undefined, units: WeatherUnits): string {
  if (kmh == null || !Number.isFinite(kmh)) return "—";
  return String(Math.round(units === "imperial" ? kmh * 0.621371 : kmh));
}

/** Canada reports pressure in kPa; the US in inches of mercury. */
export const pressureUnit = (units: WeatherUnits) =>
  units === "imperial" ? "inHg" : "kPa";

export function formatPressure(hPa: number | undefined, units: WeatherUnits): string {
  if (hPa == null || !Number.isFinite(hPa)) return "—";
  return units === "imperial" ? (hPa * 0.02953).toFixed(2) : (hPa / 10).toFixed(1);
}

export const distanceUnit = (units: WeatherUnits) =>
  units === "imperial" ? "mi" : "km";

export function formatDistance(
  metres: number | undefined,
  units: WeatherUnits,
): string {
  if (metres == null || !Number.isFinite(metres)) return "—";
  const value = units === "imperial" ? metres / 1609.344 : metres / 1000;
  return value >= 10 ? String(Math.round(value)) : value.toFixed(1);
}

export const precipUnit = (units: WeatherUnits) => (units === "imperial" ? "in" : "mm");

export function formatPrecip(mm: number | undefined, units: WeatherUnits): string {
  if (mm == null || !Number.isFinite(mm)) return "—";
  if (units === "imperial") return (mm / 25.4).toFixed(2);
  return mm >= 10 ? String(Math.round(mm)) : mm.toFixed(1);
}

export function formatHour(ts: number, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", timeZone }).format(ts);
}

export function formatLocalTime(ts: number, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(ts);
}

export function formatWeekday(ts: number, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone }).format(ts);
}

export function formatDaylight(secondsOfLight: number | undefined): string {
  if (secondsOfLight == null || !Number.isFinite(secondsOfLight)) return "—";
  const minutes = Math.round(secondsOfLight / 60);
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

export function placeLabel(place: WeatherPlace): string {
  return [
    place.region,
    place.countryCode === "CA" || place.countryCode === "US"
      ? place.countryCode
      : place.country,
  ]
    .filter(Boolean)
    .join(", ");
}

/* --------------------------------------------------------- persistence -- */

export type WeatherPrefs = {
  place: WeatherPlace;
  units: WeatherUnits;
  collapsed: boolean;
  report: WeatherReport | null;
};

function isPlace(value: unknown): value is WeatherPlace {
  if (!value || typeof value !== "object") return false;
  const place = value as WeatherPlace;
  return (
    typeof place.id === "string" &&
    typeof place.name === "string" &&
    num(place.latitude) != null &&
    num(place.longitude) != null
  );
}

export function loadWeatherPrefs(nowMs = Date.now()): WeatherPrefs {
  const fallback: WeatherPrefs = {
    place: TORONTO,
    units: "metric",
    collapsed: false,
    report: null,
  };
  try {
    if (typeof localStorage === "undefined") return fallback;
    const raw = localStorage.getItem(WEATHER_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<WeatherPrefs> | null;
    if (!parsed || typeof parsed !== "object") return fallback;
    const place = isPlace(parsed.place) ? parsed.place : TORONTO;
    const report = parsed.report;
    const fresh =
      report &&
      report.place?.id === place.id &&
      report.forecast?.now &&
      Array.isArray(report.forecast.hours) &&
      nowMs - (report.fetchedAt ?? 0) < WEATHER_CACHE_MS;
    return {
      place,
      units: parsed.units === "imperial" ? "imperial" : "metric",
      collapsed: parsed.collapsed === true,
      report: fresh ? report : null,
    };
  } catch {
    return fallback;
  }
}

export function saveWeatherPrefs(prefs: WeatherPrefs): boolean {
  try {
    localStorage.setItem(WEATHER_KEY, JSON.stringify(prefs));
    return true;
  } catch {
    // The cached report is disposable; the chosen city and units are not.
    try {
      localStorage.setItem(WEATHER_KEY, JSON.stringify({ ...prefs, report: null }));
      return true;
    } catch {
      return false;
    }
  }
}
