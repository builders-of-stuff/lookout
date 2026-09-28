<script lang="ts">
  import AssetMark from "$lib/components/asset-mark.svelte";
  import CopyAddress from "$lib/components/copy-address.svelte";
  import LiveChart from "$lib/components/live-chart.svelte";
  import LocalChart, { type Range } from "$lib/components/local-chart.svelte";
  import {
    formatCompact,
    formatPct,
    formatPrice,
    kindLabel,
    tokenFieldLabel,
  } from "$lib/format";
  import type { AlertKind, AlertRule, Asset, Quote, Tick } from "$lib/types";

  let {
    asset,
    quote,
    ticks,
    rules,
    onAddRule,
    onRemoveRule,
    onDrop,
    onClose,
  }: {
    asset: Asset;
    quote?: Quote;
    ticks: Tick[];
    rules: AlertRule[];
    onAddRule: (kind: AlertKind, value: number) => void;
    onRemoveRule: (id: string) => void;
    onDrop: () => void;
    onClose: () => void;
  } = $props();

  let tab = $state<"full" | "tape">("full");
  let range = $state<Range>("1D");
  let kind = $state<AlertKind>("above");
  let value = $state("");
  let pane = $state<HTMLElement | undefined>();

  const up = $derived((quote?.changePct ?? 0) >= 0);
  const mine = $derived(rules.filter((r) => r.assetId === asset.id));
  const validValue = $derived(Number.isFinite(Number(value)) && Number(value) > 0);
  const links = $derived.by(() => {
    const extra = quote?.pairUrl ? [{ label: "This pool", href: quote.pairUrl }] : [];
    const seen = new Set<string>();
    return [...extra, ...asset.links].filter((l) => {
      if (seen.has(l.href)) return false;
      seen.add(l.href);
      return true;
    });
  });
  $effect(() => {
    const el = pane;
    void asset.id;
    if (!el || typeof window === "undefined") return;
    const frame = window.requestAnimationFrame(() => {
      const rect = el.getBoundingClientRect();
      if (rect.top > 48) el.scrollIntoView({ block: "start", behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  });

  function arm(e: SubmitEvent) {
    e.preventDefault();
    if (!validValue) return;
    onAddRule(kind, Number(value));
    value = "";
  }
</script>

<aside class="focus-pane" bind:this={pane} aria-label="{asset.symbol} details">
  <header class="focus-header">
    <div class="focus-identity">
      <AssetMark {asset} />
      <div class="min-w-0">
        <h2>{asset.symbol}</h2>
        <span>{asset.name} · {kindLabel(asset.kind)}</span>
      </div>
    </div>
    <div class="focus-compact-quote">
      <span class="tabular">{quote ? `$${formatPrice(quote.price)}` : "—"}</span>
      <span
        class="change-badge tabular"
        class:positive={quote && up}
        class:negative={quote && !up}
      >
        {#if quote}<span aria-hidden="true">{up ? "↗" : "↘"}</span>{/if}{formatPct(
          quote?.changePct,
        )}
      </span>
    </div>
    <button
      type="button"
      class="icon-button"
      aria-label="Close {asset.symbol} details"
      onclick={onClose}
    >
      <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"
        ><path d="m4 4 8 8M12 4l-8 8" /></svg
      >
    </button>
  </header>

  {#if asset.tokenAddress}
    <div class="copy-address-stack">
      {#key asset.tokenAddress}
        <CopyAddress
          label={tokenFieldLabel(asset.chain)}
          value={asset.tokenAddress}
          hint={asset.chain}
        />
      {/key}
    </div>
  {/if}

  <div class="chart-toolbar">
    <div class="chart-tabs" aria-label="Chart view">
      <button
        type="button"
        class:active={tab === "full"}
        aria-pressed={tab === "full"}
        onclick={() => (tab = "full")}
        >Full chart <span aria-hidden="true">↗</span></button
      >
      <button
        type="button"
        class:active={tab === "tape"}
        aria-pressed={tab === "tape"}
        onclick={() => (tab = "tape")}>Short tape</button
      >
    </div>
    {#if tab === "tape"}
      <div class="chart-ranges" aria-label="Chart time range">
        {#each ["1H", "4H", "1D", "7D"] as r (r)}
          <button
            type="button"
            class:active={range === r}
            aria-pressed={range === r}
            onclick={() => (range = r as Range)}>{r}</button
          >
        {/each}
      </div>
    {:else}
      <span class="chart-caption"
        >{asset.kind === "dex" ? "DexScreener" : "TradingView"}</span
      >
    {/if}
  </div>

  <div class="chart-stage">
    {#if tab === "full"}<LiveChart {asset} {quote} />{:else}<LocalChart
        {ticks}
        {up}
        {range}
      />{/if}
  </div>

  <div class="focus-lower">
    {#if quote}
      <div class="focus-stats">
        {#if asset.kind === "dex" && quote.windows}
          {#each ["m5", "h1", "h6", "h24"] as key (key)}
            {@const change = quote.windows[key as "m5" | "h1" | "h6" | "h24"]}
            <div>
              <span>{key}</span><b
                class:positive={(change ?? 0) >= 0}
                class:negative={(change ?? 0) < 0}>{formatPct(change)}</b
              >
            </div>
          {/each}
        {:else if quote.dayLow != null && quote.dayHigh != null}
          <div><span>Day low</span><b>${formatPrice(quote.dayLow)}</b></div>
          <div><span>Day high</span><b>${formatPrice(quote.dayHigh)}</b></div>
        {:else}
          <div>
            <span>Market cap</span><b
              >{quote.marketCap != null ? `$${formatCompact(quote.marketCap)}` : "—"}</b
            >
          </div>
          <div>
            <span>24h volume</span><b
              >{quote.volume != null ? `$${formatCompact(quote.volume)}` : "—"}</b
            >
          </div>
        {/if}
      </div>
    {/if}

    <div class="market-links">
      {#each links as link (link.href)}
        <a href={link.href} target="_blank" rel="noreferrer"
          >{link.label} <span aria-hidden="true">↗</span></a
        >
      {/each}
    </div>

    <details class="price-alerts" aria-label="Price alerts">
      <summary class="alert-heading">
        <h3>Price alerts <span class="count-badge">{mine.length}</span></h3>
        <span class="eyebrow">STAY A STEP AHEAD</span>
      </summary>
      <form class="alert-form" onsubmit={arm}>
        <label class="sr-only" for="alert-kind">Alert condition</label>
        <select id="alert-kind" bind:value={kind}>
          <option value="above">Price above</option>
          <option value="below">Price below</option>
          <option value="move">Session move ≥ %</option>
        </select>
        <label class="sr-only" for="alert-value">Alert value</label>
        <input
          id="alert-value"
          bind:value
          inputmode="decimal"
          autocomplete="off"
          required
          placeholder={kind === "move" ? "5%" : "Target price"}
        />
        <button type="submit" class="primary-button" disabled={!validValue}
          >Set alert</button
        >
      </form>
      <div class="alert-rules">
        {#if mine.length === 0}<p>
            A little heads-up when {asset.symbol} hits your level.
          </p>{/if}
        {#each mine as rule (rule.id)}
          <button
            type="button"
            class="alert-rule"
            aria-label="Remove {asset.symbol} {rule.kind} {rule.value} alert"
            onclick={() => onRemoveRule(rule.id)}
          >
            {rule.kind === "move"
              ? `±${rule.value}%`
              : `${rule.kind} $${formatPrice(rule.value)}`}
            <span aria-hidden="true">×</span>
          </button>
        {/each}
      </div>
    </details>
    <div class="focus-footer">
      <span>{quote?.source ?? "Waiting for a quote"}</span><button
        type="button"
        onclick={onDrop}>Remove from watchlist</button
      >
    </div>
  </div>
</aside>
