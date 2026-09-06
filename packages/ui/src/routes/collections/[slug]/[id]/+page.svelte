<script lang="ts">
  import { goto, invalidateAll } from "$app/navigation";
  import PageHeader from "$lib/layout/PageHeader.svelte";
  import RecordForm from "$lib/forms/RecordForm.svelte";
  import Alert from "$lib/ui/Alert.svelte";
  import ConfirmDialog from "$lib/ui/ConfirmDialog.svelte";
  import { recordLabel } from "$lib/fields/values.js";
  import type { PageProps } from "./$types.js";

  let { data }: PageProps = $props();

  const base = $derived(`${data.schema.basePath}/collections/${data.collection.slug}`);
  const label = $derived(recordLabel(data.collection, data.record));
  let saved = $state(false);
  let confirming = $state(false);
  let deleteError = $state<unknown>(undefined);

  async function remove(): Promise<void> {
    confirming = false;
    deleteError = undefined;
    try {
      await data.client.remove(data.collection.slug, data.record.id);
      await goto(base, { invalidateAll: true });
    } catch (caught) {
      deleteError = caught;
    }
  }
</script>

<PageHeader
  title={label}
  crumbs={[
    { label: "Página Inicial", href: data.schema.basePath },
    { label: data.collection.plural, href: base },
    { label },
  ]}
/>

<p class="id shuri-mono">{data.record.id}</p>

{#if deleteError}
  <div class="banner">
    <Alert tone="error">
      {deleteError instanceof Error ? deleteError.message : String(deleteError)}
    </Alert>
  </div>
{/if}

{#if saved}
  <div class="banner"><Alert tone="success">Alterações salvas.</Alert></div>
{/if}

<!--
  Keyed on the record's id so moving between two records of the same collection rebuilds the form
  from the new record: without it, Svelte would reuse the component and keep the previous record's
  values in the inputs.
-->
{#key data.record.id}
  <RecordForm
    fields={data.collection.fields}
    record={data.record}
    relationOptions={data.relationOptions}
    cancelHref={base}
    ondelete={() => (confirming = true)}
    onsubmit={async (input) => {
      await data.client.update(data.collection.slug, data.record.id, input);
      saved = true;
      // Re-reads the record so the page shows what the store actually kept, not what was sent.
      await invalidateAll();
    }}
  />
{/key}

<ConfirmDialog
  open={confirming}
  title="Remover registro?"
  message={`"${label}" será removido permanentemente. Essa ação não pode ser desfeita.`}
  onconfirm={() => void remove()}
  oncancel={() => (confirming = false)}
/>

<style>
  .id {
    margin: -18px 0 26px;
    color: var(--shuri-text-faint);
  }

  .banner {
    margin-bottom: 16px;
  }
</style>
