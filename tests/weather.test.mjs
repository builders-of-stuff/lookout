import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { createServer } from "vite";

const server = await createServer({
  server: { middlewareMode: true, watch: null, ws: false },
});
const w = await server.ssrLoadModule("/src/lib/weather.ts");
const { WeatherStation } = await server.ssrLoadModule(
  "/src/lib/weather-station.svelte.ts",
);
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
const originalFetch = globalThis.fetch;
let stored;

const HOUR = 3_600_000;
// 8:30 AM in Toronto.
const NOW = Date.UTC(2026, 8, 27, 12, 30);
const TOP = Date.UTC(2026, 8, 27, 12, 0);

const PARIS = {
  id: "2988507",
  name: "Paris",
  region: "Île-de-France",
  country: "France",
  countryCode: "FR",
  latitude: 48.85341,
  longitude: 2.3488,
  timezone: "Europe/Paris",
};

function hour(offset, extra = {}) {
  return {
    time: TOP + offset * HOUR,
    temp: 12,
    code: 0,
    isDay: true,
    precipChance: 0,
    ...extra,
  };
}

function forecastPayload() {
  const times = Array.from({ length: 30 }, (_, i) => TOP / 1000 + (i - 4) * 3600);
  return {
    timezone: "America/Toronto",
    current: {
      time: NOW / 1000,
      temperature_2m: 12.7,
      apparent_temperature: 10.2,
      relative_humidity_2m: 74,
      dew_point_2m: 8.2,
      is_day: 1,
      weather_code: 1,
      cloud_cover: 4,
      pressure_msl: 1016,
      wind_speed_10m: 13.4,
      wind_direction_10m: 352,
      wind_gusts_10m: 35.3,
      visibility: 21000,
      uv_index: 0.75,
    },
    hourly: {
      time: times,
      temperature_2m: times.map((_, i) => 10 + i / 2),
      // 9:00 is the last full hour at least three hours back from 12:30.
      pressure_msl: times.map((t) => (t === TOP / 1000 - 3 * 3600 ? 1019 : 1016)),
      weather_code: times.map(() => 3),
      is_day: times.map(() => 1),
      precipitation_probability: times.map(() => 5),
      // Open-Meteo stamps each sum at the end of its hour: 1.2 mm between 10 and 11 UTC.
      precipitation: times.map((t) => (t === TOP / 1000 - 3600 ? 1.2 : 0)),
    },
    daily: {
      time: [Date.UTC(2026, 8, 27, 4) / 1000, Date.UTC(2026, 8, 28, 4) / 1000],
      weather_code: [3, 61],
      temperature_2m_max: [23.6, 21.3],
      temperature_2m_min: [11.2, 13.8],
      sunrise: [Date.UTC(2026, 8, 27, 11, 10) / 1000, null],
      wind_gusts_10m_max: [37.4, 30],
    },
  };
}

beforeEach(() => {
  stored = new Map();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key) => stored.get(key) ?? null,
      setItem: (key, value) => stored.set(key, value),
    },
  });
  globalThis.fetch = originalFetch;
});

after(async () => {
  await server.close();
  globalThis.fetch = originalFetch;
  if (originalStorage)
    Object.defineProperty(globalThis, "localStorage", originalStorage);
  else delete globalThis.localStorage;
});

test("wind chill matches the Environment Canada table and stays out of mild air", () => {
  assert.equal(Math.round(w.windChill(-10, 20)), -18);
  assert.equal(Math.round(w.windChill(-20, 30)), -33);
  assert.equal(w.windChill(12, 30), null);
  assert.equal(w.windChill(-5, 3), null);
});

test("humidex and heat index only show up when the air feels hotter", () => {
  assert.equal(Math.round(w.humidex(30, 20)), 38);
  assert.equal(w.humidex(19, 18), null);
  assert.equal(w.humidex(30, 5), null);
  // NWS table: 90 °F at 60% humidity feels like 100 °F.
  const hot = w.heatIndex(((90 - 32) * 5) / 9, 60);
  assert.ok(Math.abs((hot * 9) / 5 + 32 - 100) <= 1);
  assert.equal(w.heatIndex(24, 90), null);
  assert.equal(w.heatIndex(27.3, 40), null);
});

test("compass, Beaufort, and the everyday labels", () => {
  assert.equal(w.compass(352), "N");
  assert.equal(w.compass(25), "NNE");
  assert.equal(w.compass(-90), "W");
  assert.equal(w.beaufort(0.5), "Calm");
  assert.equal(w.beaufort(13.4), "Gentle breeze");
  assert.equal(w.beaufort(130), "Hurricane force");
  assert.equal(w.dewComfort(8.2), "Dry");
  assert.equal(w.dewComfort(20), "Muggy");
  assert.equal(w.uvLabel(0.75), "Low");
  assert.equal(w.uvLabel(8), "Very high");
  assert.equal(w.pressureTrend(0.4), "steady");
  assert.equal(w.pressureTrend(-3), "falling");
});

test("forecast parser anchors to the current hour and reads the 3-hour pressure trend", () => {
  const f = w.parseForecast(forecastPayload());
  assert.equal(f.timezone, "America/Toronto");
  assert.equal(f.now.time, NOW);
  assert.equal(f.now.temp, 12.7);
  assert.equal(f.now.pressureDelta, -3);
  assert.equal(f.now.pressureTrend, "falling");
  assert.equal(f.hours[0].time, TOP);
  assert.equal(f.hours.length, 25);
  assert.deepEqual(
    f.past.map((h) => h.time),
    [TOP - 3 * HOUR, TOP - 2 * HOUR, TOP - HOUR],
  );
  // Each hour holds what fell during it, so the 1.2 mm lands on the 10:00 hour.
  assert.deepEqual(
    f.past.map((h) => h.precip),
    [0, 1.2, 0],
  );
  assert.equal(f.days.length, 2);
  assert.equal(f.days[0].high, 23.6);
  assert.equal(f.days[0].sunrise, Date.UTC(2026, 8, 27, 11, 10));
  assert.equal(f.days[1].sunrise, undefined);
  assert.equal(f.days[0].gustMax, 37.4);
});

test("forecast parser refuses an empty or failed response", () => {
  assert.throws(() => w.parseForecast({}), /no current conditions/);
  assert.throws(
    () => w.parseForecast({ error: true, reason: "Latitude must be in range" }),
    /Latitude must be in range/,
  );
});

test("precipitation outlook: dry, rain on the way, and rain now", () => {
  const dry = [hour(0), hour(1), hour(2)];
  assert.equal(
    w.precipOutlook(0, dry, "America/Toronto"),
    "Dry through the next 24 hours",
  );

  const wet = [
    hour(0),
    hour(1, { code: 61, precipChance: 30 }),
    hour(2, { code: 63, precipChance: 70 }),
  ];
  assert.equal(
    w.precipOutlook(0, wet, "America/Toronto"),
    "Rain likely around 10 AM (70%)",
  );

  const easing = [
    hour(0, { code: 81 }),
    hour(1, { code: 81, precipChance: 80 }),
    hour(2),
  ];
  assert.equal(
    w.precipOutlook(81, easing, "America/Toronto"),
    "Showers now, easing by 10 AM",
  );
});

test("looking back, amounts overrule the weather code", () => {
  assert.equal(w.settledCode(hour(0, { code: 61, precip: 0 })), 3);
  assert.equal(w.settledCode(hour(0, { code: 2, precip: 0.8 })), 61);
  assert.equal(w.settledCode(hour(0, { code: 2, precip: 0.8, temp: -2 })), 71);
  assert.equal(w.settledCode(hour(0, { code: 63, precip: 2 })), 63);

  const recap = w.pastSummary([
    hour(-3, { temp: 9, code: 0 }),
    hour(-2, { temp: 10, code: 61, precip: 0.6 }),
    hour(-1, { temp: 12, code: 3, precip: 0.3 }),
  ]);
  assert.equal(recap.since, TOP - 3 * HOUR);
  assert.equal(recap.startTemp, 9);
  assert.ok(Math.abs(recap.total - 0.9) < 1e-9);
  assert.equal(w.describeSky(recap.code).kind, "rain");
  assert.equal(w.pastSummary([]), null);
});

test("night ahead ignores rain codes the model gives little chance", () => {
  const night = [
    hour(0),
    hour(1, { isDay: false, temp: 15 }),
    hour(2, { isDay: false, temp: 11, code: 61, precipChance: 10 }),
    hour(3, { isDay: false, temp: 13 }),
    hour(4, { isDay: true, temp: 9 }),
  ];
  const quiet = w.nightAhead(night);
  assert.equal(quiet.label, "Tonight");
  assert.equal(quiet.low, 11);
  assert.equal(w.describeSky(quiet.code).kind, "clear");

  night[3] = hour(3, { isDay: false, temp: 13, code: 63, precipChance: 60 });
  assert.equal(w.describeSky(w.nightAhead(night).code).kind, "rain");
  assert.equal(w.nightAhead([hour(0, { isDay: false })]).label, "Overnight");
  assert.equal(w.nightAhead([hour(0)]), null);
});

test("thermal index looks ahead for tonight's wind chill", () => {
  const forecast = {
    timezone: "America/Toronto",
    now: { temp: 12, windSpeed: 20, dewPoint: 5, humidity: 60 },
    hours: [
      hour(0, { temp: 12, windSpeed: 20 }),
      hour(10, { temp: 2, windSpeed: 25 }),
      hour(14, { temp: -1, windSpeed: 30 }),
    ],
    days: [],
  };
  const index = w.thermalIndex(forecast, "CA");
  assert.equal(index.kind, "wind-chill");
  assert.equal(index.now, null);
  assert.equal(index.extreme.time, TOP + 14 * HOUR);
  assert.equal(Math.round(index.extreme.value), -8);

  const muggy = {
    ...forecast,
    now: { temp: 30, windSpeed: 5, dewPoint: 20, humidity: 55 },
  };
  assert.equal(w.thermalIndex(muggy, "CA").kind, "humidex");
  assert.equal(w.thermalIndex(muggy, "US").kind, "heat-index");
});

test("modelled air keeps the headline AQI and any pollen", () => {
  const air = w.parseAirQuality(
    {
      current: {
        time: TOP / 1000,
        us_aqi: 28,
        grass_pollen: 3.2,
        birch_pollen: null,
      },
    },
    NOW,
  );
  assert.equal(air.usAqi, 28);
  assert.equal(air.time, TOP);
  assert.deepEqual(air.pollen, [{ id: "grass_pollen", label: "Grass", value: 3.2 }]);
  assert.throws(() => w.parseAirQuality({ current: {} }), /no air quality/);
});

test("US AQI bands", () => {
  assert.equal(w.usAqiInfo(17).band, "good");
  assert.equal(w.usAqiInfo(50).band, "good");
  assert.equal(w.usAqiInfo(51).band, "moderate");
  assert.equal(w.usAqiInfo(151).band, "unhealthy");
  assert.equal(w.usAqiInfo(420).band, "hazardous");
});

// Shaped like a real api.waqi.info geo feed for Toronto Downtown.
function waqi(overrides = {}) {
  return {
    status: "ok",
    data: {
      aqi: 17,
      idx: 5914,
      dominentpol: "pm25",
      attributions: [
        { name: "Air Quality Ontario - the Ontario Ministry of the Environment" },
        { name: "World Air Quality Index Project" },
      ],
      city: {
        geo: [43.6436, -79.3886],
        name: "Toronto Downtown, Toronto, Canada",
        url: "https://aqicn.org/city/canada/ontario/toronto-downtown",
      },
      iaqi: {
        pm25: { v: 17 },
        o3: { v: 16 },
        no2: { v: 8.2 },
        h: { v: 74 },
        t: { v: 13 },
      },
      time: { iso: new Date(TOP).toISOString() },
      ...overrides,
    },
  };
}

test("WAQI reading: nearest monitor, sub-indices, and the real data owner", () => {
  const measured = w.parseWaqi(waqi(), w.TORONTO, NOW);
  assert.equal(measured.kind, "station");
  const r = measured.reading;
  assert.equal(r.aqi, 17);
  assert.equal(r.dominant, "pm25");
  assert.equal(r.station, "Toronto Downtown");
  assert.ok(r.distanceKm > 6 && r.distanceKm < 8);
  assert.equal(r.observedAt, TOP);
  // Weather keys (h, t) in iaqi are not pollutants.
  assert.deepEqual(r.pollutants, [
    { id: "pm25", aqi: 17 },
    { id: "o3", aqi: 16 },
    { id: "no2", aqi: 8.2 },
  ]);
  assert.deepEqual(r.attributions, [
    "Air Quality Ontario - the Ontario Ministry of the Environment",
  ]);
  assert.match(r.href, /aqicn\.org\/city\/canada/);
});

test("WAQI: missing token, far or stale monitors, and outages", () => {
  assert.deepEqual(w.parseWaqi({ status: "error", data: "Invalid key" }, w.TORONTO), {
    kind: "needs-token",
  });
  assert.throws(
    () => w.parseWaqi({ status: "error", data: "Over quota" }, w.TORONTO),
    /WAQI: Over quota/,
  );
  // The geo feed answers with the nearest monitor on Earth, however far.
  const kingston = waqi({ city: { geo: [44.23, -76.48], name: "Kingston" } });
  assert.equal(w.parseWaqi(kingston, w.TORONTO, NOW).kind, "none-nearby");
  // A few hours behind is still a measurement; most of a day behind is not.
  const lagging = waqi({ time: { iso: new Date(TOP - 4 * HOUR).toISOString() } });
  assert.equal(w.parseWaqi(lagging, w.TORONTO, NOW).kind, "station");
  const stale = waqi({ time: { iso: new Date(TOP - 9 * HOUR).toISOString() } });
  assert.equal(w.parseWaqi(stale, w.TORONTO, NOW).kind, "none-nearby");
  assert.equal(w.parseWaqi(waqi({ aqi: "-" }), w.TORONTO, NOW).kind, "none-nearby");
  assert.equal(w.parseWaqi(waqi({ aqi: null }), w.TORONTO, NOW).kind, "none-nearby");
});

test("WAQI goes through the dev proxy so the token stays server-side", () => {
  assert.equal(w.waqiUrl(w.TORONTO), "/api/waqi/feed/geo:43.7064;-79.3986/");
});

test("Environment Canada alerts drop ended ones, dedupe zones, and rank warnings first", () => {
  const alert = (id, props) => ({
    id,
    properties: {
      alert_code: "FTA",
      alert_type: "advisory",
      alert_name_en: "frost advisory",
      risk_colour_en: "yellow",
      status_en: "issued",
      expiration_datetime: new Date(NOW + 6 * HOUR).toISOString(),
      alert_text_en: "Frost is expected tonight.\nCover plants.\n\nLocations: GTA.",
      ...props,
    },
  });
  const alerts = w.parseEcccAlerts(
    {
      features: [
        alert("a"),
        alert("b"),
        alert("c", {
          alert_code: "HT",
          alert_type: "warning",
          alert_name_en: "heat warning",
          risk_colour_en: "orange",
        }),
        alert("d", { alert_code: "RF", status_en: "ended" }),
        alert("e", {
          alert_code: "SQ",
          expiration_datetime: new Date(NOW - HOUR).toISOString(),
        }),
      ],
    },
    w.TORONTO,
    NOW,
  );
  assert.deepEqual(
    alerts.map((a) => [a.title, a.level, a.colour]),
    [
      ["Heat warning", "warning", "orange"],
      ["Frost advisory", "advisory", "yellow"],
    ],
  );
  assert.equal(
    alerts[1].text,
    "Frost is expected tonight. Cover plants.\n\nLocations: GTA.",
  );
  assert.match(alerts[0].href, /weather\.gc\.ca/);
});

test("NWS alerts skip replaced, expired, and test messages", () => {
  const alert = (props) => ({
    properties: {
      status: "Actual",
      urgency: "Expected",
      severity: "Severe",
      event: "Coastal Flood Warning",
      expires: new Date(NOW + HOUR).toISOString(),
      ends: new Date(NOW + 6 * HOUR).toISOString(),
      description: "* WHAT...Two to three feet of\ninundation.",
      ...props,
    },
  });
  const alerts = w.parseNwsAlerts(
    {
      features: [
        alert({ id: "1" }),
        alert({ id: "2", event: "Wind Advisory", severity: "Moderate" }),
        alert({ id: "3", event: "Coastal Flood Advisory", urgency: "Past" }),
        alert({
          id: "4",
          event: "Heat Advisory",
          expires: new Date(NOW - HOUR).toISOString(),
        }),
        alert({ id: "5", event: "Tornado Warning", status: "Test" }),
      ],
    },
    { ...PARIS, countryCode: "US", latitude: 40.7128, longitude: -74.006 },
    NOW,
  );
  assert.deepEqual(
    alerts.map((a) => [a.title, a.level, a.colour]),
    [
      ["Coastal Flood Warning", "warning", "orange"],
      ["Wind Advisory", "advisory", "yellow"],
    ],
  );
  assert.equal(alerts[0].text, "* WHAT...Two to three feet of inundation.");
  assert.equal(alerts[0].ends, NOW + 6 * HOUR);
});

test("place search floats the region named after a comma", () => {
  const payload = {
    results: [
      {
        id: 1,
        name: "London",
        latitude: 51.5,
        longitude: -0.12,
        admin1: "England",
        country: "United Kingdom",
        country_code: "GB",
      },
      {
        id: 2,
        name: "London",
        latitude: 42.98,
        longitude: -81.23,
        admin1: "Ontario",
        country: "Canada",
        country_code: "CA",
      },
      { id: 3, name: "Broken" },
    ],
  };
  assert.deepEqual(
    w.parsePlaces(payload, "London, ON").map((p) => p.region),
    ["Ontario", "England"],
  );
  assert.deepEqual(
    w.parsePlaces(payload, "London").map((p) => p.id),
    ["1", "2"],
  );
});

test("a dead side feed does not sink the forecast, but a dead forecast does", () => {
  const forecast = { status: "fulfilled", value: w.parseForecast(forecastPayload()) };
  const report = w.assembleWeather(
    w.TORONTO,
    forecast,
    { status: "rejected", reason: new Error("Air quality 503") },
    { status: "fulfilled", value: null },
    { status: "rejected", reason: new Error("Environment Canada alerts 500") },
    NOW,
  );
  assert.equal(report.air, null);
  assert.deepEqual(report.alerts, []);
  assert.deepEqual(report.errors, ["Air quality 503", "Environment Canada alerts 500"]);
  assert.equal(report.fetchedAt, NOW);
  assert.throws(
    () =>
      w.assembleWeather(
        w.TORONTO,
        { status: "rejected", reason: new Error("Forecast 502") },
        { status: "fulfilled", value: null },
        { status: "fulfilled", value: null },
        { status: "fulfilled", value: [] },
      ),
    /Forecast 502/,
  );
});

test("units convert from the metric readings", () => {
  assert.equal(w.formatTemp(12.7, "metric"), "13°");
  assert.equal(w.formatTemp(-0.4, "metric"), "0°");
  assert.equal(w.formatTemp(15, "imperial"), "59°");
  assert.equal(w.formatWind(29.3, "imperial"), "18");
  assert.equal(w.formatPressure(1016, "metric"), "101.6");
  assert.equal(w.formatPressure(1016, "imperial"), "30.00");
  assert.equal(w.formatDistance(21000, "metric"), "21");
  assert.equal(w.formatDistance(4500, "metric"), "4.5");
  assert.equal(w.formatPrecip(31, "imperial"), "1.22");
  assert.equal(w.formatDaylight(42921.6), "11h 55m");
});

test("Toronto is the default, and the chosen city and units come back", () => {
  const fresh = w.loadWeatherPrefs(NOW);
  assert.equal(fresh.place.name, "Toronto");
  assert.equal(fresh.units, "metric");
  assert.equal(fresh.report, null);

  const report = { place: PARIS, forecast: { now: {}, hours: [] }, fetchedAt: NOW };
  assert.equal(
    w.saveWeatherPrefs({ place: PARIS, units: "imperial", collapsed: true, report }),
    true,
  );
  const back = w.loadWeatherPrefs(NOW + HOUR);
  assert.equal(back.place.id, PARIS.id);
  assert.equal(back.units, "imperial");
  assert.equal(back.collapsed, true);
  assert.equal(back.report.fetchedAt, NOW);
  // A cached sky from hours ago is dropped rather than shown as current.
  assert.equal(w.loadWeatherPrefs(NOW + 4 * HOUR).report, null);
});

test("junk storage falls back to Toronto; a full quota keeps the city", () => {
  stored.set(
    w.WEATHER_KEY,
    JSON.stringify({ place: { name: "No coords" }, units: "kelvin" }),
  );
  const junk = w.loadWeatherPrefs(NOW);
  assert.equal(junk.place.id, w.TORONTO.id);
  assert.equal(junk.units, "metric");

  let writes = 0;
  globalThis.localStorage.setItem = (key, value) => {
    writes += 1;
    if (value.includes('"report":{')) throw new Error("QuotaExceededError");
    stored.set(key, value);
  };
  const report = { place: PARIS, forecast: { now: {}, hours: [] }, fetchedAt: NOW };
  assert.equal(
    w.saveWeatherPrefs({ place: PARIS, units: "metric", collapsed: false, report }),
    true,
  );
  assert.equal(writes, 2);
  assert.equal(JSON.parse(stored.get(w.WEATHER_KEY)).place.id, PARIS.id);
});

test("switching cities mid-request never shows the old city's reply", async () => {
  const pending = new Map();
  globalThis.fetch = (url) =>
    new Promise((resolve) => {
      const { hostname, searchParams } = new URL(url, "http://localhost:5173");
      const reply = (body) =>
        resolve({ ok: true, status: 200, json: async () => body });
      // Hold only the forecast, so the test decides which city answers first.
      if (hostname === "api.open-meteo.com") {
        pending.set(searchParams.get("latitude"), reply);
      } else if (hostname === "air-quality-api.open-meteo.com") {
        reply({ current: { us_aqi: 10 } });
      } else if (hostname === "localhost") {
        reply({ status: "error", data: "Invalid key" });
      } else reply({ features: [] });
    });
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

  const desk = new WeatherStation();
  const toronto = desk.refresh();
  await tick();
  desk.setPlace(PARIS);
  await tick();
  pending.get(PARIS.latitude.toFixed(4))(forecastPayload());
  await tick();
  pending.get(w.TORONTO.latitude.toFixed(4))(forecastPayload());
  await toronto;
  await tick();

  assert.equal(desk.place.id, PARIS.id);
  assert.equal(desk.report.place.id, PARIS.id);
  assert.equal(desk.status, "live");
});
