<script lang="ts">
  import type { Asset } from "$lib/types";
  import { findOnDesk } from "$lib/watchlist";
  import {
    isTickerQuery,
    searchMarkets,
    type SearchGroup,
    type SearchHit,
  } from "$lib/search";

  let {
    assets,
    onAdd,
    onFocus,
  }: {
    assets: Asset[];
    onAdd: (asset: Asset) => void;
    onFocus: (id: string) => void;
  } = $props();

  const LABELS: Record<SearchGroup, string> = {
    coin: "Coins",
    dex: "Dex",
    stock: "Stocks & funds",
  };

  let query = $state("");
  let open = $state(false);
  let hits = $state<SearchHit[]>([]);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let active = $state(0);
  let box = $state<HTMLDivElement | undefined>();
  let input = $state<HTMLInputElement | undefined>();

  const groupOrder = $derived<SearchGroup[]>(
    isTickerQuery(query) ? ["stock", "coin", "dex"] : ["coin", "dex", "stock"],
  );
  const orderedHits = $derived(
    groupOrder.flatMap((group) => hits.filter((hit) => hit.group === group)),
  );
  const groups = $derived(
    groupOrder
      .map((group) => ({
        group,
        rows: orderedHits
          .map((hit, index) => ({ hit, index }))
          .filter((row) => row.hit.group === group),
      }))
      .filter((g) => g.rows.length),
  );

  $effect(() => {
    const q = query.trim();
    if (q.length < 1) {
      hits = [];
      loading = false;
      error = null;
      return;
    }
    let cancelled = false;
    loading = true;
    hits = [];
    error = null;
    const handle = window.setTimeout(() => {
      void searchMarkets(q)
        .then((rows) => {
          if (cancelled) return;
          hits = rows;
          active = 0;
          error = rows.length ? null : "Nothing matched.";
        })
        .catch(() => {
          if (cancelled) return;
          hits = [];
          error = "Search failed. Try again in a moment.";
        })
        .finally(() => {
          if (!cancelled) loading = false;
        });
    }, 280);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  });

  $effect(() => {
    function onDoc(e: MouseEvent) {
      if (!box?.contains(e.target as Node)) open = false;
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "/" && !inField(e.target)) {
        e.preventDefault();
        input?.focus();
        open = true;
      }
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  });

  function pick(hit: SearchHit) {
    const existing = findOnDesk(hit.asset, assets);
    if (existing) onFocus(existing.id);
    else onAdd(hit.asset);
    query = "";
    hits = [];
    open = false;
    input?.blur();
  }

  function onKeys(e: KeyboardEvent) {
    if (e.key === "Escape") {
      open = false;
      input?.blur();
      return;
    }
    if (!hits.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      active = (active + 1) % orderedHits.length;
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      active = (active - 1 + orderedHits.length) % orderedHits.length;
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = orderedHits[active];
      if (hit) pick(hit);
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      document
        .getElementById(`search-hit-${active}`)
        ?.scrollIntoView({ block: "nearest" });
    }
  }

  function inField(target: EventTarget | null) {
    if (!(target instanceof HTMLElement)) return false;
    const tag = target.tagName;
    return (
      tag === "INPUT" ||
      tag === "TEXTAREA" ||
      tag === "SELECT" ||
      target.isContentEditable
    );
  }
</script>

<div bind:this={box} class="search-box">
  <label class="sr-only" for="tape-add">Search coins and stocks</label>
  <div class="search-field">
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"
      ><circle cx="8.5" cy="8.5" r="5.5" /><path d="m13 13 4 4" /></svg
    >
    <input
      id="tape-add"
      bind:this={input}
      bind:value={query}
      oninput={() => (open = true)}
      onfocus={() => (open = true)}
      onkeydown={onKeys}
      placeholder="Add a coin, stock, or fund…"
      class="search-input"
      autocomplete="off"
      spellcheck="false"
      role="combobox"
      aria-expanded={open && Boolean(query.trim())}
      aria-controls="tape-add-list"
      aria-autocomplete="list"
      aria-activedescendant={open && hits.length ? `search-hit-${active}` : undefined}
    />
    {#if loading}
      <span class="font-mono text-[10px] uppercase tracking-wider text-ghost">
        Searching…
      </span>
    {:else}
      <kbd class="search-shortcut">/</kbd>
    {/if}
  </div>

  {#if open && query.trim()}
    <div
      id="tape-add-list"
      role="listbox"
      aria-label="Search results"
      class="search-results"
    >
      {#if loading}
        <p class="px-4 py-4 text-xs text-ghost" role="status">Searching the markets…</p>
      {/if}
      {#if error && !hits.length}
        <p class="px-3 py-3 font-mono text-xs text-ghost">{error}</p>
      {/if}
      {#each groups as { group, rows } (group)}
        <div>
          <div
            class="sticky top-0 bg-panel px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.16em] text-copper"
          >
            {LABELS[group]}
          </div>
          {#each rows as { hit, index } (hit.key)}
            {@const onDesk = Boolean(findOnDesk(hit.asset, assets))}
            <button
              type="button"
              id="search-hit-{index}"
              role="option"
              aria-selected={index === active}
              class="search-result flex w-full items-baseline justify-between gap-3 px-4 py-3 text-left {index ===
              active
                ? 'bg-blotter'
                : ''}"
              onmouseenter={() => (active = index)}
              onclick={() => pick(hit)}
            >
              <span class="min-w-0">
                <span class="font-display text-sm font-bold tracking-wide">
                  {hit.asset.symbol}
                </span>
                <span class="ml-2 text-sm text-ghost">{hit.asset.name}</span>
                <span class="search-result-detail">{hit.detail}</span>
              </span>
              <span
                class="shrink-0 font-mono text-[10px] uppercase tracking-wider text-ghost"
              >
                {onDesk ? "✓ Added" : "+ Add"}
              </span>
            </button>
          {/each}
        </div>
      {/each}
    </div>
  {/if}
</div>
