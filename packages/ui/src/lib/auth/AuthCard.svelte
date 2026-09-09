<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    /** The app's name, which is also where the brand mark's initial comes from. */
    title: string;
    /** Wider than the login's 380px for the setup form, which asks for five fields. */
    width?: number;
    children: Snippet;
  }

  let { title, width = 380, children }: Props = $props();

  const initial = $derived(title.trim().charAt(0).toUpperCase() || "S");
</script>

<!--
  The frame the three signed-out screens share: cream page, one white card, the brand at the top of
  it. They differ in what they ask for, not in how they look, and the admin behind them opens with
  the same mark in the same corner.
-->
<main>
  <div class="card" style="width: {width}px">
    <div class="brand">
      <span class="mark" aria-hidden="true">{initial}</span>
      <h1>{title}</h1>
    </div>
    {@render children()}
  </div>
</main>

<style>
  main {
    display: grid;
    place-items: center;
    min-height: 100dvh;
    padding: 24px;
    background: var(--shuri-bg);
  }

  .card {
    display: flex;
    flex-direction: column;
    gap: 16px;
    max-width: 100%;
    padding: 40px;
    background: var(--shuri-surface);
    border-radius: 16px;
    box-shadow: 0 12px 40px rgb(10 10 10 / 8%);
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 8px;
  }

  .mark {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 34px;
    height: 34px;
    font-size: 18px;
    font-weight: 700;
    color: var(--shuri-c1);
    background: var(--shuri-text);
    border-radius: 10px;
  }

  h1 {
    font-size: 22px;
  }
</style>
