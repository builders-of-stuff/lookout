<script lang="ts">
  import { BAND_LABEL } from "$lib/fear-greed";
  import type { FearGreedBand, FearGreedReading, FearGreedState } from "$lib/types";

  let { mood }: { mood: FearGreedState } = $props();

  const CX = 110;
  const CY = 118;
  const R = 88;
  const BANDS: Array<{ band: FearGreedBand; from: number; to: number }> = [
    { band: "extreme-fear", from: 0, to: 25 },
    { band: "fear", from: 25, to: 45 },
    { band: "neutral", from: 45, to: 55 },
    { band: "greed", from: 55, to: 75 },
    { band: "extreme-greed", from: 75, to: 100 },
  ];

  type TickMark = { x1: number; y1: number; x2: number; y2: number; major: boolean };

  const ticks: TickMark[] = Array.from({ length: 11 }, (_, i) => {
    const score = i * 10;
    const theta = Math.PI * (1 - score / 100);
    const major = i % 5 === 0;
    const inner = major ? R - 11 : R - 6;
    return {
      x1: CX + inner * Math.cos(theta),
      y1: CY - inner * Math.sin(theta),
      x2: CX + (R + 1) * Math.cos(theta),
      y2: CY - (R + 1) * Math.sin(theta),
      major,
    };
  });

  function point(score: number, radius = R) {
    const theta = Math.PI * (1 - score / 100);
    return {
      x: CX + radius * Math.cos(theta),
      y: CY - radius * Math.sin(theta),
    };
  }

  function arcPath(from: number, to: number, radius = R) {
    const start = point(from, radius);
    const end = point(to, radius);
    return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${radius} ${radius} 0 0 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
  }

  function sparkPath(history: number[]) {
    if (history.length < 2) return "";
    const min = Math.min(...history);
    const max = Math.max(...history);
    const span = max - min || 1;
    return history
      .map((value, i) => {
        const x = (i / (history.length - 1)) * 100;
        const y = 18 - ((value - min) / span) * 14 - 2;
        return `${i === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
      })
      .join(" ");
  }

  function needleAngle(score: number) {
    return ((score - 50) / 50) * 90;
  }

  function print(n: number | undefined) {
    return n == null || !Number.isFinite(n) ? "—" : String(Math.round(n));
  }
</script>

{#snippet gauge(reading: FearGreedReading | null, market: string, pending: string)}
  {@const band = reading?.band ?? "neutral"}
  {@const score = reading?.score ?? 50}
  {@const spark = reading ? sparkPath(reading.history) : ""}
  <article
    class="mood-cell band-{band}"
    aria-label={reading
      ? `${market} fear and greed ${print(reading.score)}, ${reading.label}`
      : `${market} fear and greed ${pending}`}
  >
    <div class="mood-cell-head">
      <span class="mood-market">{market}</span>
      {#if reading}
        <a class="mood-source" href={reading.href} target="_blank" rel="noreferrer"
          >{reading.source} <span aria-hidden="true">↗</span></a
        >
      {/if}
    </div>

    <div class="mood-meter">
      <svg class="mood-dial" viewBox="0 0 220 136" aria-hidden="true">
        <path class="mood-arc-track" d={arcPath(0, 100, R)} fill="none" />
        {#each BANDS as slice (slice.band)}
          <path
            class="mood-arc-band mood-arc-{slice.band}"
            d={arcPath(slice.from, slice.to, R)}
            fill="none"
          />
        {/each}
        {#each ticks as tick (tick.x1)}
          <line
            class="mood-tick"
            class:mood-tick-major={tick.major}
            x1={tick.x1}
            y1={tick.y1}
            x2={tick.x2}
            y2={tick.y2}
          />
        {/each}
        <text class="mood-end-label" x="22" y="132">Fear</text>
        <text class="mood-end-label" x="198" y="132" text-anchor="end">Greed</text>
        <g
          class="mood-needle"
          class:mood-needle-live={!!reading}
          style:transform="rotate({needleAngle(score)}deg)"
        >
          <line x1={CX} y1={CY + 10} x2={CX} y2={CY - R + 10} />
          <circle class="mood-hub-ring" cx={CX} cy={CY} r="7" />
          <circle class="mood-hub" cx={CX} cy={CY} r="3.5" />
        </g>
      </svg>
      <div class="mood-readout">
        <div class="mood-score tabular">{reading ? print(reading.score) : "—"}</div>
        <div class="mood-band">{reading ? reading.label : pending}</div>
      </div>
    </div>

    {#if reading}
      <div class="mood-compare">
        {#if reading.previous != null}
          <span>Last <b class="tabular">{print(reading.previous)}</b></span>
        {/if}
        {#if reading.weekAgo != null}
          <span>Week <b class="tabular">{print(reading.weekAgo)}</b></span>
        {/if}
      </div>
      {#if reading.legs?.length}
        <div class="mood-legs" aria-label="{market} components">
          {#each reading.legs as leg (leg.id)}
            <span
              class="mood-leg band-{leg.band}"
              title="{leg.label}: {print(leg.score)} {BAND_LABEL[leg.band]}"
            >
              <i style:height="{Math.max(18, leg.score)}%"></i>
              <em>{leg.label}</em>
            </span>
          {/each}
        </div>
      {:else if spark}
        <svg class="mood-spark" viewBox="0 0 100 20" aria-hidden="true">
          <path d={spark} />
        </svg>
      {/if}
    {/if}
  </article>
{/snippet}

<section class="mood-rail" aria-label="Fear and greed">
  <header class="mood-kicker">
    <span class="eyebrow">FEAR & GREED</span>
    <span>0 fear · 100 greed</span>
  </header>
  <div class="mood-gauges">
    {@render gauge(mood.crypto, "Crypto", "Waiting on a print")}
    {@render gauge(mood.stocks, "Stocks", "Waiting on a print")}
  </div>
</section>
