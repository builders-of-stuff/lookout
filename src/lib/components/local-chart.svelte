<script lang="ts" module>
  export type Range = "1H" | "4H" | "1D" | "7D";
</script>

<script lang="ts">
  import {
    AreaSeries,
    ColorType,
    createChart,
    CrosshairMode,
    type IChartApi,
    type ISeriesApi,
    type UTCTimestamp,
  } from "lightweight-charts";
  import { onMount } from "svelte";
  import type { Tick } from "$lib/types";

  let { ticks, up, range }: { ticks: Tick[]; up: boolean; range: Range } = $props();

  const WINDOW: Record<Range, number> = {
    "1H": 60 * 60 * 1000,
    "4H": 4 * 60 * 60 * 1000,
    "1D": 24 * 60 * 60 * 1000,
    "7D": 7 * 24 * 60 * 60 * 1000,
  };

  let host = $state<HTMLDivElement | undefined>();
  let chart: IChartApi | undefined;
  let series: ISeriesApi<"Area"> | undefined;

  onMount(() => {
    const el = host;
    if (!el) return;
    chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#939e9b",
        fontFamily: "Azeret Mono, ui-monospace, monospace",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "rgba(42,49,53,0.45)" },
        horzLines: { color: "rgba(42,49,53,0.45)" },
      },
      rightPriceScale: { borderColor: "#2a3135" },
      timeScale: {
        borderColor: "#2a3135",
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: { mode: CrosshairMode.Normal },
      handleScroll: true,
      handleScale: true,
    });
    series = chart.addSeries(AreaSeries, {
      lineWidth: 2,
      lineColor: "#8bc9a3",
      topColor: "rgba(139,201,163,0.16)",
      bottomColor: "rgba(10,12,20,0)",
      priceLineVisible: true,
    });
    return () => {
      chart?.remove();
      chart = undefined;
      series = undefined;
    };
  });

  $effect(() => {
    const s = series;
    const c = chart;
    if (!s || !c) return;
    s.applyOptions({
      lineColor: up ? "#8bc9a3" : "#e89998",
      topColor: up ? "rgba(139,201,163,0.16)" : "rgba(232,153,152,0.16)",
    });
    c.timeScale().applyOptions({ secondsVisible: range === "1H" });
    const cutoff = Date.now() - WINDOW[range];
    const sliced = ticks.filter((t) => t.t >= cutoff);
    const data = (sliced.length >= 2 ? sliced : ticks).map((t) => ({
      time: Math.floor(t.t / 1000) as UTCTimestamp,
      value: t.p,
    }));
    s.setData(data);
    c.timeScale().fitContent();
  });
</script>

<div class="relative h-full w-full">
  <div
    bind:this={host}
    class="h-full w-full {ticks.length < 2 ? 'invisible' : ''}"
  ></div>
  {#if ticks.length < 2}
    <div
      class="absolute inset-0 flex items-center justify-center font-mono text-xs text-ghost"
    >
      Collecting short tape in this browser…
    </div>
  {/if}
</div>
