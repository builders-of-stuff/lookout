<script lang="ts">
  import AirQualityCell from "$lib/components/air-quality.svelte";
  import PlaceSearch from "$lib/components/place-search.svelte";
  import WeatherIcon from "$lib/components/weather-icon.svelte";
  import { formatTime } from "$lib/format";
  import type { WeatherStation } from "$lib/weather-station.svelte";
  import {
    PAST_HOURS,
    THERMAL_LABEL,
    THERMAL_THRESHOLD,
    WEATHER_POLL_MS,
    beaufort,
    compass,
    describeSky,
    dewComfort,
    distanceUnit,
    ecccHref,
    formatDaylight,
    formatDistance,
    formatHour,
    formatLocalTime,
    formatPrecip,
    formatPressure,
    formatTemp,
    formatWeekday,
    formatWind,
    nightAhead,
    nwsHref,
    pastSummary,
    precipOutlook,
    precipUnit,
    pressureUnit,
    settledCode,
    thermalIndex,
    toTemp,
    usAqiInfo,
    uvLabel,
    visibilityLabel,
    windUnit,
  } from "$lib/weather";

  let { station, now }: { station: WeatherStation; now: number } = $props();

  type Tile = {
    label: string;
    value: string;
    unit?: string;
    note: string;
    arrow?: number;
  };

  const TREND = { rising: "↗ Rising", falling: "↘ Falling", steady: "→ Steady" };
  const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const report = $derived(station.report);
  const units = $derived(station.units);
  const place = $derived(station.place);
  const forecast = $derived(report?.forecast ?? null);
  const zone = $derived(forecast?.timezone ?? place.timezone ?? localZone);
  const minute = $derived(Math.floor(now / 60_000));
  const hours = $derived(
    forecast?.hours
      .filter((hour) => hour.time > minute * 60_000 - 3_600_000)
      .slice(0, 24) ?? [],
  );
  const today = $derived(forecast?.days[0]);
  const sky = $derived(forecast ? describeSky(forecast.now.code) : null);
  const thermal = $derived(forecast ? thermalIndex(forecast, place.countryCode) : null);
  const outlook = $derived(
    forecast ? precipOutlook(forecast.now.code, hours, zone) : "",
  );
  const tonight = $derived.by(() => {
    const night = nightAhead(hours);
    return night && { ...night, sky: describeSky(night.code) };
  });
  const tomorrow = $derived(forecast?.days[1]);
  const official = $derived(
    place.countryCode === "CA"
      ? { label: "Environment Canada", href: ecccHref(place) }
      : place.countryCode === "US"
        ? { label: "weather.gov", href: nwsHref(place) }
        : null,
  );

  const tiles = $derived.by((): Tile[] => {
    if (!forecast || !thermal) return [];
    const n = forecast.now;
    const chill = thermal.kind === "wind-chill";
    let thermalNote: string;
    if (thermal.extreme) {
      thermalNote = `${chill ? "Down to" : "Up to"} ${formatTemp(thermal.extreme.value, units)} · ${formatHour(thermal.extreme.time, zone)}`;
    } else if (chill && n.temp <= THERMAL_THRESHOLD["wind-chill"]) {
      thermalNote = "Wind too light to bite";
    } else {
      thermalNote = chill
        ? `Kicks in at ${formatTemp(THERMAL_THRESHOLD[thermal.kind], units)} and colder`
        : `Kicks in from ${formatTemp(THERMAL_THRESHOLD[thermal.kind], units)} up`;
    }
    return [
      {
        label: "Wind",
        value: formatWind(n.windSpeed, units),
        unit: windUnit(units),
        note: `${compass(n.windDir)} · ${beaufort(n.windSpeed)}`,
        arrow: Number.isFinite(n.windDir) ? n.windDir : undefined,
      },
      {
        label: "Gusts",
        value: formatWind(n.windGust, units),
        unit: windUnit(units),
        note:
          today?.gustMax != null
            ? `Peak ${formatWind(today.gustMax, units)} today`
            : "—",
      },
      {
        label: THERMAL_LABEL[thermal.kind],
        value: thermal.now != null ? formatTemp(thermal.now, units) : "None",
        note: thermalNote,
      },
      {
        label: "Humidity",
        value: percent(n.humidity),
        unit: "%",
        note: `Dew point ${formatTemp(n.dewPoint, units)} · ${dewComfort(n.dewPoint)}`,
      },
      {
        label: "Pressure",
        value: formatPressure(n.pressure, units),
        unit: pressureUnit(units),
        note: n.pressureTrend ? TREND[n.pressureTrend] : "—",
      },
      {
        label: "Visibility",
        value: formatDistance(n.visibility, units),
        unit: distanceUnit(units),
        note: visibilityLabel(n.visibility),
      },
      {
        label: "UV index",
        value: n.uv != null ? String(Math.round(n.uv)) : "—",
        note: `${uvLabel(n.uv)} · peak ${today?.uvMax != null ? Math.round(today.uvMax) : "—"}`,
      },
      {
        label: "Precip today",
        value: formatPrecip(today?.precip, units),
        unit: precipUnit(units),
        note:
          today?.precipChance != null
            ? `${Math.round(today.precipChance)}% chance`
            : "—",
      },
    ];
  });

  // The hourly strip: a few hours back, then now and the day ahead. Anchored to
  // the clock rather than the fetch so a cached report still lines up.
  const timeline = $derived.by(() => {
    if (!forecast) return { columns: [], nowIndex: 0 };
    // Reports cached before the past strip existed have no `past`.
    const all = [...(forecast.past ?? []), ...forecast.hours];
    const current = Math.max(
      0,
      all.findLastIndex((hour) => hour.time <= minute * 60_000),
    );
    const from = Math.max(0, current - PAST_HOURS);
    return { columns: all.slice(from, current + 24), nowIndex: current - from };
  });
  const recap = $derived(pastSummary(timeline.columns.slice(0, timeline.nowIndex)));

  // Hourly temperature trace. Columns are 10 units wide; y is a % of the plot.
  const chart = $derived.by(() => {
    const { columns, nowIndex } = timeline;
    if (columns.length < 2) return null;
    const temps = columns.map((hour) => toTemp(hour.temp, units));
    const min = Math.min(...temps);
    const max = Math.max(...temps);
    const span = max - min || 1;
    const ys = temps.map((t) => 34 + (1 - (t - min) / span) * 50);
    const points = ys.map((y, i) => `${(i + 0.5) * 10},${y.toFixed(2)}`);
    const width = columns.length * 10;
    const fell = columns.slice(0, nowIndex).map((hour) => hour.precip ?? 0);
    return {
      ys,
      width,
      past: nowIndex > 0 ? `M${points.slice(0, nowIndex + 1).join("L")}` : "",
      line: `M${points.slice(nowIndex).join("L")}`,
      area: `M5,100L${points.join("L")}L${width - 5},100Z`,
      // Past bars show amounts; 2 mm/h fills the bar unless something heavier fell.
      rainMax: Math.max(2, ...fell),
    };
  });

  const week = $derived.by(() => {
    const days = forecast?.days ?? [];
    if (!days.length) return null;
    const min = Math.min(...days.map((day) => day.low));
    const max = Math.max(...days.map((day) => day.high));
    return { min, span: max - min || 1 };
  });

  const glanceAir = $derived.by(() => {
    // Older cached reports predate `measured`.
    const measured = report?.measured ?? null;
    if (measured?.kind === "station") {
      const { aqi } = measured.reading;
      return `AQI ${Math.round(aqi)} ${usAqiInfo(aqi).label}`;
    }
    if (report?.air?.usAqi != null)
      return `AQI ~${Math.round(report.air.usAqi)} (model)`;
    return "";
  });

  function percent(value: number) {
    return Number.isFinite(value) ? String(Math.round(value)) : "—";
  }

  function hourLabel(time: number, index: number) {
    if (index === timeline.nowIndex) return "Now";
    const label = formatHour(time, zone);
    return label === "12 AM" ? formatWeekday(time, zone) : label;
  }

  function position(celsius: number) {
    if (!week) return 0;
    return Math.min(100, Math.max(0, ((celsius - week.min) / week.span) * 100));
  }
</script>

<section
  class="wx-rail"
  class:wx-collapsed={station.collapsed}
  aria-label="Weather and air quality"
>
  <header class="wx-head">
    <div class="wx-head-place">
      <span class="eyebrow">WEATHER</span>
      <PlaceSearch {place} onPick={(next) => station.setPlace(next)} />
      {#if forecast && formatLocalTime(now, zone) !== formatLocalTime(now)}
        <span class="wx-local tabular">{formatLocalTime(now, zone)} local</span>
      {/if}
    </div>

    {#if station.collapsed && forecast && sky}
      <div class="wx-glance" aria-label="Weather summary">
        <WeatherIcon kind={sky.kind} night={!forecast.now.isDay} />
        <b class="tabular">{formatTemp(forecast.now.temp, units)}</b>
        <span>{sky.label}</span>
        {#if today}
          <span class="tabular"
            >H {formatTemp(today.high, units)} · L {formatTemp(today.low, units)}</span
          >
        {/if}
        {#if glanceAir}<span>{glanceAir}</span>{/if}
        {#if report?.alerts.length}
          <span class="wx-glance-alert">{report.alerts[0].title}</span>
        {/if}
      </div>
    {/if}

    <div class="wx-head-tools">
      <div class="wx-units" role="group" aria-label="Units">
        <button
          type="button"
          aria-pressed={units === "metric"}
          onclick={() => station.setUnits("metric")}>°C</button
        >
        <button
          type="button"
          aria-pressed={units === "imperial"}
          onclick={() => station.setUnits("imperial")}>°F</button
        >
      </div>
      <button
        type="button"
        class="icon-button wx-toggle"
        aria-expanded={!station.collapsed}
        aria-controls="wx-body"
        aria-label={station.collapsed ? "Show weather details" : "Hide weather details"}
        onclick={() => station.toggle()}
      >
        <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"
          ><path d="m4 10 4-4 4 4" /></svg
        >
      </button>
    </div>
  </header>

  {#if !station.collapsed}
    <div id="wx-body">
      {#if !report || !forecast || !sky || !thermal}
        <div class="wx-empty" role="status">
          {#if station.status === "error"}
            <p>Couldn’t reach the forecast for {place.name}. {station.error}</p>
            <button type="button" class="quiet-button" onclick={() => station.refresh()}
              >Try again</button
            >
          {:else}
            <p>Reading the sky over {place.name}…</p>
          {/if}
        </div>
      {:else}
        {#if report.alerts.length}
          <div class="wx-alerts">
            {#each report.alerts as alert (alert.id)}
              <details class="wx-alert wx-alert-{alert.colour ?? 'plain'}">
                <summary>
                  <span class="wx-alert-level">{alert.level}</span>
                  <span class="wx-alert-title">{alert.title}</span>
                  {#if alert.ends}
                    <span class="wx-alert-until tabular"
                      >until {formatWeekday(alert.ends, zone)}
                      {formatLocalTime(alert.ends, zone)}</span
                    >
                  {/if}
                </summary>
                <div class="wx-alert-body">
                  {#if alert.text}<p>{alert.text}</p>{/if}
                  {#if alert.instruction}<p>{alert.instruction}</p>{/if}
                  <a href={alert.href} target="_blank" rel="noreferrer"
                    >{alert.source} <span aria-hidden="true">↗</span></a
                  >
                </div>
              </details>
            {/each}
          </div>
        {/if}

        <div class="wx-grid">
          <article class="wx-cell wx-now" aria-label="Current conditions">
            <div class="wx-now-main">
              <WeatherIcon
                kind={sky.kind}
                night={!forecast.now.isDay}
                class="wx-now-icon"
              />
              <div class="wx-now-temp tabular">
                {formatTemp(forecast.now.temp, units)}
              </div>
              <div class="wx-now-side">
                <div class="wx-now-sky">{sky.label}</div>
                <div class="wx-now-feels">
                  Feels like <b class="tabular"
                    >{formatTemp(forecast.now.feelsLike, units)}</b
                  >
                </div>
              </div>
            </div>
            {#if today}
              <div class="wx-now-hilo tabular">
                <span>High <b>{formatTemp(today.high, units)}</b></span>
                <span>Low <b>{formatTemp(today.low, units)}</b></span>
                <span>Cloud <b>{percent(forecast.now.cloudCover)}%</b></span>
              </div>
            {/if}
            <p class="wx-now-outlook">{outlook}</p>
            <div class="wx-ahead">
              {#if recap}
                {@const recapSky = describeSky(recap.code)}
                <div class="wx-ahead-row">
                  <span class="wx-ahead-when">Past {PAST_HOURS}h</span>
                  <WeatherIcon
                    kind={recapSky.kind}
                    night={!timeline.columns[timeline.nowIndex - 1]?.isDay}
                  />
                  <span class="wx-ahead-sky"
                    >{recap.total >= 0.2
                      ? `${formatPrecip(recap.total, units)} ${precipUnit(units)} of ${recapSky.kind === "snow" ? "snow" : "rain"}`
                      : `${recapSky.label}, dry`}</span
                  >
                  <span class="wx-ahead-temp tabular"
                    ><b>{formatTemp(recap.startTemp, units)}</b> →
                    <b>{formatTemp(forecast.now.temp, units)}</b></span
                  >
                </div>
              {/if}
              {#if tonight}
                <div class="wx-ahead-row">
                  <span class="wx-ahead-when">{tonight.label}</span>
                  <WeatherIcon kind={tonight.sky.kind} night />
                  <span class="wx-ahead-sky">{tonight.sky.label}</span>
                  <span class="wx-ahead-temp tabular"
                    >Low <b>{formatTemp(tonight.low, units)}</b></span
                  >
                </div>
              {/if}
              {#if tomorrow}
                {@const tomorrowSky = describeSky(tomorrow.code)}
                <div class="wx-ahead-row">
                  <span class="wx-ahead-when">Tomorrow</span>
                  <WeatherIcon kind={tomorrowSky.kind} />
                  <span class="wx-ahead-sky"
                    >{tomorrowSky.label}{(tomorrow.precipChance ?? 0) >= 20
                      ? ` · ${Math.round(tomorrow.precipChance!)}%`
                      : ""}</span
                  >
                  <span class="wx-ahead-temp tabular"
                    ><b>{formatTemp(tomorrow.low, units)}</b> /
                    <b>{formatTemp(tomorrow.high, units)}</b></span
                  >
                </div>
              {/if}
            </div>
            {#if today?.sunrise && today.sunset}
              <div class="wx-now-sun tabular">
                <span
                  ><svg viewBox="0 0 16 16" fill="none" aria-hidden="true"
                    ><path
                      d="M2 12h12M4.5 12a3.5 3.5 0 0 1 7 0M8 3v4M6 5l2-2 2 2"
                    /></svg
                  >{formatLocalTime(today.sunrise, zone)}</span
                >
                <span
                  ><svg viewBox="0 0 16 16" fill="none" aria-hidden="true"
                    ><path
                      d="M2 12h12M4.5 12a3.5 3.5 0 0 1 7 0M8 3v4M6 5l2 2 2-2"
                    /></svg
                  >{formatLocalTime(today.sunset, zone)}</span
                >
                <span>{formatDaylight(today.daylight)} of light</span>
              </div>
            {/if}
          </article>

          <article class="wx-cell wx-conditions" aria-label="Conditions">
            <div class="wx-tiles">
              {#each tiles as tile (tile.label)}
                <div class="wx-tile">
                  <span class="wx-tile-label">{tile.label}</span>
                  <span class="wx-tile-value tabular">
                    {#if tile.arrow != null}
                      <svg
                        class="wx-wind-arrow"
                        viewBox="0 0 16 16"
                        fill="none"
                        aria-hidden="true"
                        style:transform="rotate({tile.arrow + 180}deg)"
                        ><path d="M8 13V3M4.5 6.5 8 3l3.5 3.5" /></svg
                      >
                    {/if}
                    <b>{tile.value}</b>{#if tile.unit}<small>{tile.unit}</small>{/if}
                  </span>
                  <span class="wx-tile-note">{tile.note}</span>
                </div>
              {/each}
            </div>
          </article>

          <AirQualityCell
            air={report.air}
            measured={report.measured ?? null}
            {place}
            timeZone={zone}
          />

          <article
            class="wx-cell wx-hours"
            aria-label="Past {PAST_HOURS} hours and next 24 hours"
          >
            <div class="wx-cell-head">
              <span class="wx-cell-title">Past {PAST_HOURS}h · next 24h</span>
              <span class="wx-cell-hint"
                >Precip: {precipUnit(units)} fallen · chance ahead</span
              >
            </div>
            {#if chart}
              <div class="wx-hours-scroll">
                <div class="wx-hours-grid" style:--cols={timeline.columns.length}>
                  <svg
                    class="wx-hours-trace"
                    viewBox="0 0 {chart.width} 100"
                    preserveAspectRatio="none"
                    aria-hidden="true"
                  >
                    <defs>
                      <linearGradient id="wx-trace-fill" x1="0" x2="0" y1="0" y2="1">
                        <stop
                          offset="0"
                          stop-color="currentColor"
                          stop-opacity="0.16"
                        />
                        <stop offset="1" stop-color="currentColor" stop-opacity="0" />
                      </linearGradient>
                    </defs>
                    <path class="wx-trace-area" d={chart.area} />
                    {#if chart.past}<path class="wx-trace-past" d={chart.past} />{/if}
                    <path class="wx-trace-line" d={chart.line} />
                  </svg>
                  {#each timeline.columns as hour, i (hour.time)}
                    {@const past = i < timeline.nowIndex}
                    {@const hourSky = describeSky(past ? settledCode(hour) : hour.code)}
                    {@const fell = hour.precip ?? 0}
                    <div
                      class="wx-hour"
                      class:wx-hour-past={past}
                      class:wx-hour-now={i === timeline.nowIndex}
                      title="{hourLabel(hour.time, i)}: {hourSky.label}, {formatTemp(
                        hour.temp,
                        units,
                      )}{past
                        ? `, ${formatPrecip(fell, units)} ${precipUnit(units)} fell`
                        : hour.precipChance != null
                          ? `, ${Math.round(hour.precipChance)}% chance of precip`
                          : ''}"
                    >
                      <span class="wx-hour-time">{hourLabel(hour.time, i)}</span>
                      <WeatherIcon kind={hourSky.kind} night={!hour.isDay} />
                      <span class="wx-hour-plot">
                        <i style:top="{chart.ys[i]}%"></i>
                        <b class="tabular" style:top="{chart.ys[i]}%"
                          >{formatTemp(hour.temp, units)}</b
                        >
                      </span>
                      <span class="wx-hour-rain">
                        {#if past}
                          <i
                            class="wx-hour-fell"
                            style:height="{Math.max(2, (fell / chart.rainMax) * 100)}%"
                          ></i>
                        {:else}
                          <i style:height="{Math.max(2, hour.precipChance ?? 0)}%"></i>
                        {/if}
                      </span>
                      <span class="wx-hour-chance tabular">
                        {#if past}
                          {fell >= 0.1 ? formatPrecip(fell, units) : ""}
                        {:else}
                          {(hour.precipChance ?? 0) >= 10
                            ? `${Math.round(hour.precipChance!)}%`
                            : ""}
                        {/if}
                      </span>
                    </div>
                  {/each}
                </div>
              </div>
            {/if}
          </article>

          <article class="wx-cell wx-days" aria-label="Seven day forecast">
            <div class="wx-cell-head">
              <span class="wx-cell-title">7 days</span>
              <span class="wx-cell-hint">Low · high</span>
            </div>
            <ol class="wx-day-list">
              {#each forecast.days as day, i (day.time)}
                {@const daySky = describeSky(day.code)}
                <li class="wx-day" title={daySky.label}>
                  <span class="wx-day-name"
                    >{i === 0 ? "Today" : formatWeekday(day.time, zone)}</span
                  >
                  <WeatherIcon kind={daySky.kind} />
                  <span class="wx-day-chance tabular"
                    >{(day.precipChance ?? 0) >= 10
                      ? `${Math.round(day.precipChance!)}%`
                      : ""}</span
                  >
                  <span class="wx-day-low tabular">{formatTemp(day.low, units)}</span>
                  <span class="wx-day-range" aria-hidden="true">
                    <i
                      style:left="{position(day.low)}%"
                      style:right="{100 - position(day.high)}%"
                    ></i>
                    {#if i === 0}
                      <em style:left="{position(forecast.now.temp)}%"></em>
                    {/if}
                  </span>
                  <span class="wx-day-high tabular">{formatTemp(day.high, units)}</span>
                </li>
              {/each}
            </ol>
          </article>
        </div>

        <footer class="wx-foot">
          <span>
            <a href="https://open-meteo.com/" target="_blank" rel="noreferrer"
              >Open-Meteo</a
            >
            {#if official}
              ·
              <a href={official.href} target="_blank" rel="noreferrer"
                >{official.label}</a
              >
            {/if}
            <span class="footer-divider">/</span>
            {station.status === "error"
              ? `Couldn’t refresh — showing ${formatTime(report.fetchedAt)}`
              : `Updated ${formatTime(report.fetchedAt)}`}
            <span class="footer-divider">/</span> Every {WEATHER_POLL_MS / 60_000} min
          </span>
          {#if report.errors.length}
            <span class="wx-foot-warn">Partial: {report.errors.join(" · ")}</span>
          {/if}
        </footer>
      {/if}
    </div>
  {/if}
</section>
