<script lang="ts">
  import AssetCard from "$lib/components/asset-card.svelte";
  import FocusPane from "$lib/components/focus-pane.svelte";
  import MoodRail from "$lib/components/mood-rail.svelte";
  import SearchBar from "$lib/components/search-bar.svelte";
  import TickerTape from "$lib/components/ticker-tape.svelte";
  import WeatherRail from "$lib/components/weather-rail.svelte";
  import { desk } from "$lib/desk.svelte";
  import { station } from "$lib/weather-station.svelte";
  import { POLL_MS } from "$lib/assets";
  import { playTripChime, unlockChime } from "$lib/chime";
  import { formatClock, formatTime, usSession } from "$lib/format";
  import { onMount } from "svelte";

  let now = $state(Date.now());
  let notify = $state(
    typeof Notification === "undefined" ? "unsupported" : Notification.permission,
  );
  let logOpen = $state(false);
  let detailsOpen = $state(false);
  let arranging = $state(false);
  let draggingId = $state<string | null>(null);
  let overId = $state<string | null>(null);
  let announcement = $state("");

  const focus = $derived(
    desk.assets.find((a) => a.id === desk.focusId) ?? desk.assets[0],
  );
  const session = $derived(usSession(now));
  const sessionNames = {
    pre: "US pre-market",
    rth: "US market open",
    ah: "US after hours",
    closed: "US market closed",
  };
  const advancing = $derived(
    desk.assets.filter((a) => (desk.quotes[a.id]?.changePct ?? 0) > 0).length,
  );
  const declining = $derived(
    desk.assets.filter((a) => (desk.quotes[a.id]?.changePct ?? 0) < 0).length,
  );
  const toasts = $derived(desk.events.filter((e) => now - e.at < 10_000).slice(0, 3));

  function openDetails(id: string) {
    if (detailsOpen && desk.focusId === id) {
      detailsOpen = false;
      return;
    }
    desk.setFocus(id);
    detailsOpen = true;
  }

  function closeDetails() {
    detailsOpen = false;
  }

  onMount(() => {
    desk.start();
    station.start();
    const unlock = () => unlockChime();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeDetails();
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", onKey);
    const id = setInterval(() => (now = Date.now()), 1000);
    return () => {
      desk.stop();
      station.stop();
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", onKey);
      clearInterval(id);
    };
  });

  async function enableNotes() {
    unlockChime();
    playTripChime();
    if (typeof Notification === "undefined") return;
    notify = await Notification.requestPermission();
  }

  function move(from: string, to: string) {
    desk.moveAsset(from, to);
    const position = desk.assets.findIndex((asset) => asset.id === from);
    announcement = `${desk.assets[position]?.symbol} moved to position ${position + 1}.`;
  }

  function dragStart(e: DragEvent, id: string) {
    draggingId = id;
    e.dataTransfer?.setData("text/plain", id);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
  }

  function dragOver(e: DragEvent, id: string) {
    if (!draggingId) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    overId = id;
  }

  function drop(e: DragEvent, id: string) {
    e.preventDefault();
    const from = e.dataTransfer?.getData("text/plain") || draggingId;
    if (from) move(from, id);
    draggingId = null;
    overId = null;
  }
</script>

<div class="desk-shell">
  <header class="desk-header">
    <div class="brand">
      <div class="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 32 32" fill="none"
          ><path d="M5 23V9l11 14V9M21 9h7M24.5 9v14" /></svg
        >
      </div>
      <div>
        <h1>Lookout<span class="brand-period">.</span></h1>
        <p>Your markets. Your rhythm.</p>
      </div>
    </div>
    <div class="header-right">
      <div class="market-status">
        <span class="status-dot" class:status-open={session === "rth"}></span>
        <span>{sessionNames[session]}</span>
        <span class="header-clock tabular">{formatClock(now)}</span>
      </div>
      <div class="header-actions">
        {#if notify !== "granted" && notify !== "unsupported"}
          <button type="button" class="quiet-button" onclick={enableNotes}>
            <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"
              ><path d="M15 7a5 5 0 0 0-10 0c0 6-2 6-2 7h14c0-1-2-1-2-7ZM8 17h4" /></svg
            >
            Enable alerts
          </button>
        {/if}
        <button
          type="button"
          class="quiet-button"
          class:button-selected={logOpen}
          aria-expanded={logOpen}
          aria-controls="trip-log"
          onclick={() => (logOpen = !logOpen)}
        >
          Activity <span class="count-badge">{desk.events.length}</span>
        </button>
      </div>
    </div>
  </header>

  {#if desk.assets.length}
    <TickerTape
      assets={desk.assets}
      quotes={desk.quotes}
      flashed={desk.flashed}
      {now}
    />
  {/if}

  <div class="workspace">
    <MoodRail mood={desk.mood} />
    <WeatherRail {station} {now} />

    <div class="workspace-toolbar">
      <div>
        <div class="eyebrow">THE OVERVIEW</div>
        <div class="watchlist-title">
          <h2>Your watchlist</h2>
          <span class="asset-count tabular"
            >{String(desk.assets.length).padStart(2, "0")}</span
          >
        </div>
        <div class="watchlist-subtitle">
          <span class="positive">↗ {advancing} advancing</span>
          <span class="negative">↘ {declining} declining</span>
        </div>
      </div>
      <div class="watchlist-actions">
        <SearchBar
          assets={desk.assets}
          onAdd={(asset) => {
            void desk.addAsset(asset).then((id) => {
              detailsOpen = true;
              desk.setFocus(id);
            });
          }}
          onFocus={openDetails}
        />
      </div>
    </div>

    <div class="desk-meta">
      <div class="flex flex-wrap items-center gap-3">
        <button
          type="button"
          class="arrange-button"
          class:button-selected={arranging}
          aria-pressed={arranging}
          onclick={() => (arranging = !arranging)}
        >
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"
            ><rect x="2" y="2" width="4" height="4" rx="1" /><rect
              x="10"
              y="2"
              width="4"
              height="4"
              rx="1"
            /><rect x="2" y="10" width="4" height="4" rx="1" /><rect
              x="10"
              y="10"
              width="4"
              height="4"
              rx="1"
            /></svg
          >
          {arranging ? "Done arranging" : "Arrange"}
        </button>
        <span class="arrange-hint"
          >{arranging
            ? "Drag cards or use the arrows below."
            : "Drag to make it yours."}</span
        >
      </div>
      <span class="save-status" class:save-failed={desk.saved === false} role="status">
        {#if desk.saved === false}
          Changes couldn’t be saved in this browser
        {:else if desk.saved}
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"
            ><path d="m3 8 3 3 7-7" /></svg
          >
          Saved to this browser
        {/if}
      </span>
    </div>

    {#if desk.errors.length > 0 && desk.assets.length}
      <details class="feed-notice">
        <summary
          >Some prices couldn’t refresh. Retrying every {POLL_MS / 1000}s.</summary
        >
        <p>{desk.errors.join(" · ")}</p>
      </details>
    {/if}

    <main
      class="desk-grid"
      class:with-details={detailsOpen && !!focus}
      class:desk-empty={!desk.assets.length}
    >
      <section class="watchlist-grid" aria-label="Watchlist">
        {#each desk.assets as asset, index (asset.id)}
          <AssetCard
            {asset}
            quote={desk.quotes[asset.id]}
            ticks={desk.ticks[asset.id] ?? []}
            active={detailsOpen && focus?.id === asset.id}
            fresh={now - (desk.flashed[asset.id] ?? 0) < 2800}
            dragging={draggingId === asset.id}
            over={overId === asset.id && draggingId !== asset.id}
            {arranging}
            position={index}
            total={desk.assets.length}
            onFocus={() => openDetails(asset.id)}
            onRemove={() => {
              desk.removeAsset(asset.id);
              if (!desk.assets.length) detailsOpen = false;
            }}
            onMove={(offset) => {
              const target = desk.assets[index + offset];
              if (target) move(asset.id, target.id);
            }}
            onDragStart={(e) => dragStart(e, asset.id)}
            onDragOver={(e) => dragOver(e, asset.id)}
            onDrop={(e) => drop(e, asset.id)}
            onDragEnd={() => {
              draggingId = null;
              overId = null;
            }}
          />
        {:else}
          <div class="empty-watchlist">
            <div class="empty-mark" aria-hidden="true">＋</div>
            <div class="eyebrow">A CLEAN SLATE</div>
            <h3>Make room for your next move.</h3>
            <p>Search for a coin, stock, or fund to build your watchlist.</p>
            <button
              type="button"
              class="primary-button"
              onclick={() => document.getElementById("tape-add")?.focus()}
              >Add your first asset <span aria-hidden="true">↗</span></button
            >
          </div>
        {/each}
      </section>
      {#if detailsOpen && focus}
        <FocusPane
          asset={focus}
          quote={desk.quotes[focus.id]}
          ticks={desk.ticks[focus.id] ?? []}
          rules={desk.rules}
          onAddRule={(kind, value) => desk.addRule(focus.id, kind, value)}
          onRemoveRule={(id) => desk.removeRule(id)}
          onDrop={() => {
            desk.removeAsset(focus.id);
            if (!desk.assets.length) detailsOpen = false;
          }}
          onClose={closeDetails}
        />
      {/if}
    </main>

    {#if logOpen}
      <section id="trip-log" class="activity-panel">
        <div class="flex items-center justify-between gap-3">
          <h2>Alert activity</h2>
          <button type="button" class="quiet-button" onclick={() => desk.clearEvents()}
            >Clear activity</button
          >
        </div>
        {#if desk.events.length === 0}
          <p>All quiet. Triggered price alerts will appear here.</p>
        {:else}
          <ul>
            {#each desk.events.slice(0, 12) as event (event.id)}
              <li><time>{formatTime(event.at)}</time><span>{event.message}</span></li>
            {/each}
          </ul>
        {/if}
      </section>
    {/if}

    <footer class="desk-footer">
      <span
        ><span class="status-dot" class:status-open={desk.status === "live"}></span>
        {desk.status === "live"
          ? "Connected"
          : desk.status === "error"
            ? "Reconnecting"
            : desk.assets.length
              ? "Connecting"
              : "Ready when you are"}
        <span class="footer-divider">/</span> Refreshes every {POLL_MS / 1000}s
      </span>
      <span
        >{desk.updatedAt
          ? `Last update ${formatTime(desk.updatedAt)}`
          : "A little signal. A lot less noise."}</span
      >
    </footer>
  </div>

  <span class="sr-only" aria-live="polite">{announcement}</span>
  <div class="toast-stack" aria-live="polite">
    {#each toasts as event (event.id)}<div class="alert-toast">
        {event.message}
      </div>{/each}
  </div>
</div>
