<script lang="ts">
  import AssetMark from "$lib/components/asset-mark.svelte";
  import Sparkline from "$lib/components/sparkline.svelte";
  import { copyText } from "$lib/clipboard";
  import {
    formatCompact,
    formatPct,
    formatPrice,
    kindLabel,
    shortenAddress,
  } from "$lib/format";
  import type { Asset, Quote, Tick } from "$lib/types";

  let {
    asset,
    quote,
    ticks,
    active,
    fresh,
    dragging,
    over,
    arranging,
    position,
    total,
    onFocus,
    onRemove,
    onMove,
    onDragStart,
    onDragOver,
    onDrop,
    onDragEnd,
  }: {
    asset: Asset;
    quote?: Quote;
    ticks: Tick[];
    active: boolean;
    fresh: boolean;
    dragging: boolean;
    over: boolean;
    arranging: boolean;
    position: number;
    total: number;
    onFocus: () => void;
    onRemove: () => void;
    onMove: (offset: number) => void;
    onDragStart: (e: DragEvent) => void;
    onDragOver: (e: DragEvent) => void;
    onDrop: (e: DragEvent) => void;
    onDragEnd: () => void;
  } = $props();

  const up = $derived((quote?.changePct ?? 0) >= 0);
  const spark = $derived(ticks.slice(-80).map((t) => t.p));
  let dragged = false;
  let copied = $state(false);
  let copyTimer: ReturnType<typeof setTimeout> | undefined;

  async function copyToken(event: MouseEvent) {
    event.stopPropagation();
    const address = asset.tokenAddress;
    if (!address) return;
    copied = await copyText(address);
    if (copyTimer) clearTimeout(copyTimer);
    copyTimer = setTimeout(() => {
      copied = false;
    }, 1600);
  }
</script>

<div
  class="bay"
  class:bay-live={active}
  class:bay-dragging={dragging}
  class:bay-over={over}
  role="group"
  aria-label="{asset.symbol} {asset.name}"
  data-asset-id={asset.id}
  draggable="true"
  ondragstart={(event) => {
    dragged = true;
    onDragStart(event);
  }}
  ondragover={onDragOver}
  ondrop={onDrop}
  ondragend={() => {
    onDragEnd();
    requestAnimationFrame(() => {
      dragged = false;
    });
  }}
>
  <div class="card-tools">
    <span class="drag-grip" title="Drag to reorder" aria-hidden="true">⠿</span>
    {#if asset.tokenAddress}
      <button
        type="button"
        class="icon-button"
        class:copy-done={copied}
        aria-label={copied
          ? `Copied ${asset.symbol} token address`
          : `Copy ${asset.symbol} token address ${asset.tokenAddress}`}
        title={copied ? "Copied" : `Copy ${shortenAddress(asset.tokenAddress)}`}
        onclick={copyToken}
      >
        {#if copied}
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"
            ><path d="m3 8.5 3 3 7-7" /></svg
          >
        {:else}
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"
            ><rect x="6" y="6" width="8" height="9" rx="1" /><path
              d="M10 6V4.5A1.5 1.5 0 0 0 8.5 3h-5A1.5 1.5 0 0 0 2 4.5v8A1.5 1.5 0 0 0 3.5 14H6"
            /></svg
          >
        {/if}
      </button>
    {/if}
    <button
      type="button"
      class="icon-button remove-button"
      aria-label="Remove {asset.symbol}"
      title="Remove {asset.symbol}"
      onclick={onRemove}
    >
      <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"
        ><path d="m4 4 8 8M12 4l-8 8" /></svg
      >
    </button>
  </div>

  <button
    type="button"
    class="card-content"
    aria-label="View {asset.symbol} chart"
    aria-pressed={active}
    onclick={() => {
      if (!dragged) onFocus();
    }}
  >
    <div class="asset-heading">
      <AssetMark {asset} />
      <div class="asset-identity">
        <span class="asset-symbol">{asset.symbol}</span>
        <span class="asset-name" title={asset.name}>{asset.name}</span>
      </div>
    </div>

    <div class="card-quote">
      <div class="card-price tabular" class:print-fresh={fresh}>
        {quote ? `$${formatPrice(quote.price)}` : "—"}
      </div>
      <div class="card-performance">
        <span
          class="change-badge tabular"
          class:positive={quote && up}
          class:negative={quote && !up}
        >
          {#if quote}<span aria-hidden="true">{up ? "↗" : "↘"}</span>{/if}
          {formatPct(quote?.changePct)}
        </span>
        <span class="period-label"
          >{asset.kind === "crypto" || asset.kind === "dex" ? "24h" : "session"}</span
        >
      </div>
    </div>

    <div class="card-spark">
      {#if spark.length >= 2}
        <Sparkline points={spark} {up} />
      {:else}
        <div class="spark-pending"><span>Awaiting price history</span></div>
      {/if}
    </div>

    <div class="card-meta">
      <span>{kindLabel(asset.kind)}</span>
      {#if quote?.marketCap != null}
        <span>MCap <b>${formatCompact(quote.marketCap)}</b></span>
      {:else if quote?.volume != null}
        <span>Vol <b>{formatCompact(quote.volume)}</b></span>
      {:else}
        <span
          >{asset.kind === "crypto" || asset.kind === "dex"
            ? "Always open"
            : "US market"}</span
        >
      {/if}
    </div>
  </button>

  {#if arranging}
    <div class="reorder-controls">
      <span class="tabular"
        >{String(position + 1).padStart(2, "0")} / {String(total).padStart(
          2,
          "0",
        )}</span
      >
      <div class="flex gap-1">
        <button
          type="button"
          class="icon-button"
          disabled={position === 0}
          aria-label="Move {asset.symbol} earlier"
          title="Move earlier"
          onclick={() => onMove(-1)}>←</button
        >
        <button
          type="button"
          class="icon-button"
          disabled={position === total - 1}
          aria-label="Move {asset.symbol} later"
          title="Move later"
          onclick={() => onMove(1)}>→</button
        >
      </div>
    </div>
  {/if}
</div>
