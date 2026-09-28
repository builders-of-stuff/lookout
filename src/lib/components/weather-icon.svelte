<script lang="ts">
  import type { SkyKind } from "$lib/weather";

  let {
    kind,
    night = false,
    class: className = "",
  }: { kind: SkyKind; night?: boolean; class?: string } = $props();

  const wet = $derived(
    kind === "drizzle" ||
      kind === "rain" ||
      kind === "sleet" ||
      kind === "snow" ||
      kind === "storm" ||
      kind === "fog",
  );
</script>

{#snippet sun()}
  <circle cx="12" cy="12" r="4" />
  <path
    d="M12 2.75v1.75M12 19.5v1.75M2.75 12h1.75M19.5 12h1.75M5.46 5.46l1.24 1.24M17.3 17.3l1.24 1.24M5.46 18.54l1.24-1.24M17.3 6.7l1.24-1.24"
  />
{/snippet}

{#snippet moon()}
  <path d="M20 13.2A8.2 8.2 0 1 1 10.8 4a6.4 6.4 0 0 0 9.2 9.2Z" />
{/snippet}

<svg class="wx-icon {className}" viewBox="0 0 24 24" fill="none" aria-hidden="true">
  {#if kind === "clear"}
    <g class={night ? "wx-moon" : "wx-sun"}>
      {#if night}{@render moon()}{:else}{@render sun()}{/if}
    </g>
  {:else if kind === "partly"}
    <g class={night ? "wx-moon" : "wx-sun"} transform="translate(1.2 1.2) scale(0.6)">
      {#if night}{@render moon()}{:else}{@render sun()}{/if}
    </g>
    <path
      class="wx-cloud wx-occlude"
      d="M10 20.5h7.25a3.6 3.6 0 0 0 .45-7.17 4.75 4.75 0 0 0-9.1 1.3A2.95 2.95 0 0 0 10 20.5Z"
    />
  {:else if kind === "cloudy"}
    <path
      class="wx-cloud"
      d="M7.5 18.5h9.25a4.25 4.25 0 0 0 .55-8.46 5.75 5.75 0 0 0-11.02 1.6A3.45 3.45 0 0 0 7.5 18.5Z"
    />
  {:else if wet}
    <path
      class="wx-cloud"
      d="M7.5 14.5h9.25a3.75 3.75 0 0 0 .5-7.47 5 5 0 0 0-9.6 1.4A3.05 3.05 0 0 0 7.5 14.5Z"
    />
    {#if kind === "fog"}
      <path class="wx-drop" d="M5 17.5h14M7.5 20.5h9" />
    {:else if kind === "drizzle"}
      <path class="wx-drop" d="M8.5 17.5v1M12 19v1M15.5 17.5v1M10 21.5v.5M14 21.5v.5" />
    {:else if kind === "rain"}
      <path class="wx-drop" d="M9 17l-1.2 3.5M12.8 17l-1.2 3.5M16.6 17l-1.2 3.5" />
    {:else if kind === "sleet"}
      <path class="wx-drop" d="M9 17l-1.2 3.5M16.6 17l-1.2 3.5" />
      <circle class="wx-flake" cx="12.2" cy="19" r="1" />
    {:else if kind === "snow"}
      <circle class="wx-flake" cx="8.5" cy="18" r="1" />
      <circle class="wx-flake" cx="12" cy="20.5" r="1" />
      <circle class="wx-flake" cx="15.5" cy="18" r="1" />
    {:else}
      <path class="wx-bolt" d="M13 15.5 10.5 19h3.2L11.5 22.5" />
    {/if}
  {/if}
</svg>
