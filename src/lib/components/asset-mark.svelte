<script lang="ts">
  import type { Asset } from "$lib/types";

  let { asset, large = false }: { asset: Asset; large?: boolean } = $props();

  const marks: Record<string, [string, string]> = {
    BTC: ["₿", "#edaf65"],
    ETH: ["Ξ", "#b4b8ed"],
    SOL: ["≋", "#9cd8ca"],
    SUI: ["S", "#87bdf1"],
    ZEC: ["Z", "#e3c575"],
    "S&P": ["S&P", "#9eafd3"],
    TSLA: ["T", "#ec9696"],
    ZCAT: ["ZC", "#c9aedc"],
  };
  const mark = $derived(marks[asset.symbol] ?? [asset.symbol.slice(0, 2), "#abb7bf"]);
</script>

<span
  class="asset-mark"
  class:asset-mark-large={large}
  class:asset-mark-small-type={mark[0].length > 1}
  style:--asset-color={mark[1]}
  aria-hidden="true">{mark[0]}</span
>
