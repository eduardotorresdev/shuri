<script lang="ts">
  interface Props {
    label?: string;
  }

  let { label = "Carregando…" }: Props = $props();
</script>

<p class="spinner shuri-muted" role="status">{label}</p>

<style>
  .spinner {
    padding: 32px 0;
    font-size: 13px;
    text-align: center;
  }
</style>
