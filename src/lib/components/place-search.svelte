<script lang="ts">
  import type { WeatherPlace } from "$lib/types";
  import { placeLabel, searchPlaces } from "$lib/weather";
  import { tick } from "svelte";

  let {
    place,
    onPick,
  }: {
    place: WeatherPlace;
    onPick: (place: WeatherPlace) => void;
  } = $props();

  let open = $state(false);
  let query = $state("");
  let hits = $state<WeatherPlace[]>([]);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let active = $state(0);
  let box = $state<HTMLDivElement | undefined>();
  let input = $state<HTMLInputElement | undefined>();

  $effect(() => {
    const q = query.trim();
    if (!open || q.split(",")[0].trim().length < 2) {
      hits = [];
      loading = false;
      error = null;
      return;
    }
    let cancelled = false;
    loading = true;
    error = null;
    const handle = window.setTimeout(() => {
      void searchPlaces(q)
        .then((rows) => {
          if (cancelled) return;
          hits = rows;
          active = 0;
          error = rows.length ? null : "No place by that name.";
        })
        .catch(() => {
          if (cancelled) return;
          hits = [];
          error = "Search failed. Try again in a moment.";
        })
        .finally(() => {
          if (!cancelled) loading = false;
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  });

  $effect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!box?.contains(e.target as Node)) close();
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  });

  async function show() {
    if (open) {
      close();
      return;
    }
    open = true;
    await tick();
    input?.focus();
  }

  function close() {
    open = false;
    query = "";
    hits = [];
  }

  function pick(next: WeatherPlace) {
    onPick(next);
    close();
  }

  function onKeys(e: KeyboardEvent) {
    if (e.key === "Escape") {
      // Keep Escape from also closing the details pane behind us.
      e.stopPropagation();
      close();
      box?.querySelector<HTMLButtonElement>(".wx-place-button")?.focus();
      return;
    }
    if (!hits.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      active = (active + 1) % hits.length;
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      active = (active - 1 + hits.length) % hits.length;
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = hits[active];
      if (hit) pick(hit);
    }
  }
</script>

<div bind:this={box} class="wx-place">
  <button
    type="button"
    class="wx-place-button"
    aria-expanded={open}
    aria-controls="wx-place-panel"
    onclick={show}
  >
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"
      ><path
        d="M10 17.5s5.5-5.2 5.5-9.3a5.5 5.5 0 0 0-11 0c0 4.1 5.5 9.3 5.5 9.3Z"
      /><circle cx="10" cy="8.2" r="2" /></svg
    >
    <span class="wx-place-name">{place.name}</span>
    {#if placeLabel(place)}
      <span class="wx-place-region">{placeLabel(place)}</span>
    {/if}
    <span class="sr-only">— change city</span>
    <svg class="wx-place-caret" viewBox="0 0 16 16" fill="none" aria-hidden="true"
      ><path d="m4 6 4 4 4-4" /></svg
    >
  </button>

  {#if open}
    <div id="wx-place-panel" class="wx-place-panel">
      <label class="sr-only" for="wx-place-input">Search for a city</label>
      <div class="search-field">
        <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"
          ><circle cx="8.5" cy="8.5" r="5.5" /><path d="m13 13 4 4" /></svg
        >
        <input
          id="wx-place-input"
          bind:this={input}
          bind:value={query}
          onkeydown={onKeys}
          placeholder="City, e.g. Vancouver or Paris, France"
          class="search-input"
          autocomplete="off"
          spellcheck="false"
          role="combobox"
          aria-expanded={hits.length > 0}
          aria-controls="wx-place-list"
          aria-autocomplete="list"
          aria-activedescendant={hits.length ? `wx-place-${active}` : undefined}
        />
        {#if loading}
          <span class="font-mono text-[10px] uppercase tracking-wider text-ghost"
            >Finding…</span
          >
        {/if}
      </div>
      <div id="wx-place-list" role="listbox" aria-label="Cities" class="wx-place-list">
        {#if error && !hits.length}
          <p class="wx-place-note">{error}</p>
        {:else if !hits.length && !loading}
          <p class="wx-place-note">Type at least two letters.</p>
        {/if}
        {#each hits as hit, index (hit.id)}
          <button
            type="button"
            id="wx-place-{index}"
            role="option"
            aria-selected={index === active}
            class="wx-place-hit"
            class:wx-place-hit-active={index === active}
            onmouseenter={() => (active = index)}
            onclick={() => pick(hit)}
          >
            <span class="wx-place-hit-name">{hit.name}</span>
            <span class="wx-place-hit-region"
              >{[hit.region, hit.country].filter(Boolean).join(", ")}</span
            >
            {#if hit.id === place.id}<span class="wx-place-hit-tag">Current</span>{/if}
          </button>
        {/each}
      </div>
    </div>
  {/if}
</div>
