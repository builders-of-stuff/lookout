<script lang="ts">
  import { copyText } from "$lib/clipboard";

  let {
    label,
    value,
    hint,
  }: {
    label: string;
    value: string;
    hint?: string;
  } = $props();

  let copied = $state(false);
  let failed = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function copy() {
    const ok = await copyText(value);
    copied = ok;
    failed = !ok;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      copied = false;
      failed = false;
    }, 1600);
  }
</script>

<button
  type="button"
  class="copy-address"
  class:copy-address-copied={copied}
  class:copy-address-failed={failed}
  aria-label="Copy {label} {value}"
  title="Copy {label}"
  onclick={copy}
>
  <span class="copy-address-text">
    <span class="copy-address-label">
      <span class="eyebrow">{label}</span>
      {#if hint}<span class="copy-address-hint">{hint}</span>{/if}
    </span>
    <code>{value}</code>
  </span>
  <span class="copy-address-action" aria-live="polite">
    {#if copied}
      Copied
    {:else if failed}
      Copy failed
    {:else}
      <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"
        ><rect x="6" y="6" width="8" height="9" rx="1" /><path
          d="M10 6V4.5A1.5 1.5 0 0 0 8.5 3h-5A1.5 1.5 0 0 0 2 4.5v8A1.5 1.5 0 0 0 3.5 14H6"
        /></svg
      >
      Copy
    {/if}
  </span>
</button>
