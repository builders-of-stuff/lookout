<script lang="ts">
  import type { AirQuality, MeasuredAir, WeatherPlace } from "$lib/types";
  import {
    POLLUTANT_LABEL,
    STATION_RANGE_KM,
    US_AQI_BANDS,
    formatHour,
    usAqiInfo,
  } from "$lib/weather";

  let {
    air,
    measured,
    place,
    timeZone,
  }: {
    air: AirQuality | null;
    measured: MeasuredAir | null;
    place: WeatherPlace;
    timeZone: string;
  } = $props();

  const reading = $derived(measured?.kind === "station" ? measured.reading : null);
  // Recomputed on each poll, which is often enough for an hours-old label.
  const hoursOld = $derived(
    reading ? Math.floor((Date.now() - reading.observedAt) / 3_600_000) : 0,
  );
  const aqi = $derived(reading?.aqi ?? air?.usAqi ?? null);
  const info = $derived(aqi != null ? usAqiInfo(aqi) : null);
  const pollen = $derived((air?.pollen ?? []).filter((row) => row.value >= 0.5));
  const source = $derived(
    reading
      ? { label: "aqicn.org", href: reading.href }
      : {
          label: "Open-Meteo model",
          href: "https://open-meteo.com/en/docs/air-quality-api",
        },
  );

  const caption = $derived.by(() => {
    if (!reading) return `US AQI · model estimate for ${place.name}`;
    const when = formatHour(reading.observedAt, timeZone);
    return [
      "US AQI",
      reading.station,
      hoursOld >= 2 ? `${when} (${hoursOld}h old)` : when,
      distance(reading.distanceKm),
    ].join(" · ");
  });
  const footnote = $derived.by(() => {
    if (!reading) return "";
    // "Air Quality Ontario - the Ontario Ministry of …" → "Air Quality Ontario"
    const owner = reading.attributions[0]?.split(" - ")[0].trim();
    return [
      reading.dominant && `Main pollutant ${POLLUTANT_LABEL[reading.dominant]}`,
      "Ticks at 50 and 100",
      owner ? `${owner} via WAQI` : "WAQI",
    ]
      .filter(Boolean)
      .join(" · ");
  });

  // Bands are unequal (0–50, 51–100, …), so give each an equal slice of the
  // scale and place the marker proportionally inside its band.
  function scalePosition(value: number) {
    const index = US_AQI_BANDS.findIndex((row) => value <= row.max);
    const band = index < 0 ? US_AQI_BANDS.length - 1 : index;
    const floor = band === 0 ? 0 : US_AQI_BANDS[band - 1].max;
    const ceil = Number.isFinite(US_AQI_BANDS[band].max) ? US_AQI_BANDS[band].max : 500;
    const within = Math.min(1, Math.max(0, (value - floor) / (ceil - floor)));
    return ((band + within) / US_AQI_BANDS.length) * 100;
  }

  function distance(km: number) {
    return km < 1 ? "under 1 km" : `${Math.round(km)} km away`;
  }
</script>

<article
  class="wx-cell wx-air {info ? `aqi-${info.band}` : ''}"
  aria-label="Air quality"
>
  <div class="wx-cell-head">
    <span class="wx-cell-title">Air quality</span>
    <a class="mood-source" href={source.href} target="_blank" rel="noreferrer"
      >{source.label} <span aria-hidden="true">↗</span></a
    >
  </div>

  {#if aqi != null && info}
    <div class="wx-aq-main">
      <div class="wx-aq-score tabular">{Math.round(aqi)}</div>
      <div class="min-w-0">
        <div class="wx-aq-band">{info.label}</div>
        <div class="wx-aq-caption">
          {caption}
        </div>
      </div>
    </div>
    <div class="wx-aqi-scale" aria-hidden="true">
      {#each US_AQI_BANDS as row (row.band)}
        <span class="aqi-{row.band}"></span>
      {/each}
      <i style:left="{scalePosition(aqi)}%"></i>
    </div>
    <p class="wx-aq-advice">{info.advice}</p>
  {/if}

  {#if !reading}
    <p class="wx-aq-notice">
      {#if measured?.kind === "needs-token"}
        Measured readings need a free WAQI token. Get one at
        <a
          href="https://aqicn.org/data-platform/token/"
          target="_blank"
          rel="noreferrer">aqicn.org/data-platform/token</a
        >, add <code>WAQI_TOKEN=…</code> to <code>.env.local</code>, and restart
        <code>pnpm dev</code>.
      {:else if measured?.kind === "none-nearby"}
        No air monitor reporting within {STATION_RANGE_KM} km, so this is a model estimate
        and can run high or low.
      {:else}
        Couldn’t reach the monitor network. This is a model estimate until it’s back.
      {/if}
    </p>
  {/if}

  {#if reading?.pollutants.length}
    <ul class="wx-pollutants" aria-label="Pollutants, as US AQI sub-indices">
      {#each reading.pollutants as row (row.id)}
        {@const band = usAqiInfo(row.aqi)}
        <li
          class="wx-pollutant aqi-{band.band}"
          class:wx-pollutant-main={row.id === reading.dominant}
          title="{POLLUTANT_LABEL[row.id]}: AQI {Math.round(row.aqi)} ({band.label})"
        >
          <span class="wx-pollutant-name">{POLLUTANT_LABEL[row.id]}</span>
          <span class="wx-pollutant-bar" aria-hidden="true"
            ><i style:width="{Math.min(100, (row.aqi / 200) * 100)}%"></i></span
          >
          <span class="wx-pollutant-value tabular">{Math.round(row.aqi)}</span>
        </li>
      {/each}
    </ul>
    <p class="wx-aq-footnote">{footnote}</p>
  {/if}

  {#if pollen.length}
    <div class="wx-pollen" aria-label="Pollen, grains per cubic metre">
      <span>Pollen</span>
      {#each pollen as row (row.id)}
        <b>{row.label} <em class="tabular">{Math.round(row.value)}</em></b>
      {/each}
    </div>
  {/if}
</article>
