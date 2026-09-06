<script lang="ts">
  import { ICONS, type IconName } from "./icons.js";

  interface Props {
    name: IconName;
    /** The rendered square, in px. The paths are drawn on a 24×24 grid and scale to it. */
    size?: number;
  }

  let { name, size = 16 }: Props = $props();
</script>

<!--
  Always `aria-hidden`: every icon in the admin sits beside the text it illustrates, or inside a
  control that carries its own accessible name. An icon that needed a label of its own would be an
  icon standing in for a word, which this design never does.
-->
<svg
  class="icon"
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="1.8"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  {#each ICONS[name] as d (d)}
    <path {d} />
  {/each}
</svg>

<style>
  .icon {
    display: block;
    flex-shrink: 0;
  }
</style>
