<script lang="ts">
  import { invalidateAll } from "$app/navigation";
  import PageHeader from "$lib/layout/PageHeader.svelte";
  import RecordForm from "$lib/forms/RecordForm.svelte";
  import Alert from "$lib/ui/Alert.svelte";
  import type { PageProps } from "./$types.js";

  let { data }: PageProps = $props();

  let saved = $state(false);
</script>

<!--
  A global is one record with no list above it, so this page is the form and nothing else: no
  "new", no "delete", and no link back to a collection that doesn't exist.
-->
<PageHeader
  title={data.global.title}
  badge={data.global.category}
  crumbs={[
    { label: "Página Inicial", href: data.schema.basePath },
    { label: data.global.title },
  ]}
/>

{#if saved}
  <div class="banner"><Alert tone="success">Alterações salvas.</Alert></div>
{/if}

{#key data.global.slug}
  <RecordForm
    fields={data.global.fields}
    record={data.record}
    relationOptions={data.relationOptions}
    onsubmit={async (input) => {
      await data.client.updateGlobal(data.global.slug, input);
      saved = true;
      await invalidateAll();
    }}
  />
{/key}

<style>
  .banner {
    margin-bottom: 16px;
  }
</style>
