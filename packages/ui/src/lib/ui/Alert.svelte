<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    tone?: "error" | "success" | "info";
    children: Snippet;
  }

  let { tone = "info", children }: Props = $props();
</script>

<!--
  `role="alert"` on the error tone only: it interrupts a screen reader mid-sentence, which is right
  for a failed save and wrong for a confirmation the user already expected.
-->
<div class="alert {tone}" role={tone === "error" ? "alert" : "status"}>
  {@render children()}
</div>

<style>
  .alert {
    padding: 12px 14px;
    font-size: 13px;
    border-radius: var(--shuri-radius-md);
  }

  /*
   * Error is the tertiary colour, not a red of its own. The design has four colours and this is the
   * one that means "destructive or wrong" — a fifth would be the only red on the screen.
   */
  .error {
    color: var(--shuri-danger-deep);
    background: var(--shuri-danger-soft);
  }

  .success {
    color: var(--shuri-accent-deep);
    background: var(--shuri-accent-soft);
  }

  .info {
    color: var(--shuri-text-muted);
    background: var(--shuri-surface-alt);
  }
</style>
