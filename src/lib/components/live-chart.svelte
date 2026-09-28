<script lang="ts">
  import type { Asset, Quote } from "$lib/types";

  let { asset, quote }: { asset: Asset; quote?: Quote } = $props();

  let box = $state<HTMLDivElement | undefined>();

  $effect(() => {
    const el = box;
    const symbol = asset.tradingView;
    if (!el || !symbol || asset.kind === "dex") return;
    el.replaceChildren();
    const container = document.createElement("div");
    container.className = "tradingview-widget-container";
    container.style.height = "100%";
    container.style.width = "100%";
    const widget = document.createElement("div");
    widget.className = "tradingview-widget-container__widget";
    widget.style.height = "100%";
    widget.style.width = "100%";
    const script = document.createElement("script");
    script.src =
      "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.async = true;
    script.type = "text/javascript";
    script.text = JSON.stringify({
      autosize: true,
      symbol,
      interval: "15",
      timezone: "America/Los_Angeles",
      theme: "dark",
      style: "1",
      locale: "en",
      backgroundColor: "#121619",
      gridColor: "rgba(42, 49, 53, 0.4)",
      hide_top_toolbar: false,
      allow_symbol_change: true,
      calendar: false,
      support_host: "https://www.tradingview.com",
    });
    container.append(widget, script);
    el.append(container);
    return () => {
      el.replaceChildren();
    };
  });
</script>

{#if asset.kind === "dex"}
  {#if quote?.pairAddress}
    <iframe
      title="{asset.symbol} DexScreener"
      src="https://dexscreener.com/{asset.chain ??
        'solana'}/{quote.pairAddress}?embed=1&theme=dark&trades=0&info=0"
      class="h-full w-full border-0 bg-blotter"
      allow="clipboard-write"
    ></iframe>
  {:else}
    <div class="flex h-full items-center justify-center font-mono text-xs text-ghost">
      Waiting on a DexScreener pool…
    </div>
  {/if}
{:else if asset.tradingView}
  <div bind:this={box} class="h-full min-h-0 w-full"></div>
{:else}
  <div class="flex h-full items-center justify-center font-mono text-xs text-ghost">
    No live chart for this name.
  </div>
{/if}
