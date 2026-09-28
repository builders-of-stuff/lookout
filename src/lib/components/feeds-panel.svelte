<script lang="ts">
  import { feedLog } from "$lib/feed-log.svelte";
  import { formatAgo, formatTime } from "$lib/format";
  import { quota } from "$lib/quota.svelte";

  let { now }: { now: number } = $props();

  const feeds = $derived(
    Object.values(feedLog).sort((a, b) => a.name.localeCompare(b.name)),
  );
  const report = $derived(quota.report);
  const share = $derived(report ? Math.min(1, report.used / report.limit) : 0);
  const lookoutRequests = $derived(report?.lookout ?? 0);
  const otherRequests = $derived(report ? report.used - lookoutRequests : 0);
  // The allowance resets at midnight UTC.
  const resetAt = $derived.by(() => {
    const d = new Date(now);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  });
  const resetIn = $derived.by(() => {
    const minutes = Math.max(0, Math.round((resetAt - now) / 60_000));
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  });
  const resetClock = $derived(
    new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(
      resetAt,
    ),
  );
</script>

<section id="feeds-panel" class="activity-panel feeds-panel">
  <h2>Feeds</h2>

  <div class="quota">
    <div class="quota-head">
      <span class="eyebrow">WORKER REQUESTS TODAY</span>
      {#if report}
        <span class="tabular"
          >{report.used.toLocaleString()} / {report.limit.toLocaleString()}</span
        >
      {/if}
    </div>
    <div
      class="quota-bar"
      class:quota-high={share >= 0.8}
      role="meter"
      aria-label="Worker requests used today"
      aria-valuemin={0}
      aria-valuemax={report?.limit ?? 100_000}
      aria-valuenow={report?.used ?? 0}
    >
      <span style:width="{share * 100}%"></span>
    </div>
    <p>
      {#if report}
        Resets at {resetClock} (in {resetIn}). Lookout {lookoutRequests.toLocaleString()}{otherRequests
          ? `, other Workers ${otherRequests.toLocaleString()}`
          : ""}. As of {formatTime(Date.parse(report.asOf))}; Cloudflare’s count can lag
        a few minutes.
      {:else if quota.error}
        {quota.error}
      {:else}
        Checking usage…
      {/if}
    </p>
  </div>

  <ul class="feed-list">
    {#each feeds as feed (feed.name)}
      <li>
        <span
          class="status-dot"
          class:status-open={feed.ok}
          class:status-failing={!feed.ok}
        ></span>
        <span class="feed-name">{feed.name}</span>
        <span class="feed-route">{feed.worker ? "Worker" : "Direct"}</span>
        <time title={formatTime(feed.at)}>{formatAgo(feed.at, now)}</time>
        <span class="feed-status tabular" class:negative={!feed.ok}
          >{feed.status ?? "failed"}</span
        >
      </li>
    {:else}
      <li>No calls yet in this tab.</li>
    {/each}
  </ul>
  <p>
    Last call to each feed from this tab. Direct calls go from your browser and don’t
    count toward the Worker quota.
  </p>
</section>
