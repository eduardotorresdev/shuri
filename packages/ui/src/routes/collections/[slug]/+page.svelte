<script lang="ts">
  import { goto, invalidateAll } from "$app/navigation";
  import { page } from "$app/state";
  import type { StoreRecord } from "@shuri/store";
  import PageHeader from "$lib/layout/PageHeader.svelte";
  import Pager from "$lib/lists/Pager.svelte";
  import RecordTable from "$lib/lists/RecordTable.svelte";
  import Alert from "$lib/ui/Alert.svelte";
  import Button from "$lib/ui/Button.svelte";
  import ConfirmDialog from "$lib/ui/ConfirmDialog.svelte";
  import EmptyState from "$lib/ui/EmptyState.svelte";
  import { recordLabel } from "$lib/fields/values.js";
  import { PAGE_SIZE } from "./+page.js";
  import type { PageProps } from "./$types.js";

  let { data }: PageProps = $props();

  const base = $derived(`${data.schema.basePath}/collections/${data.collection.slug}`);
  let deleteError = $state<unknown>(undefined);
  /** The record the confirmation is about, and the only thing that opens the dialog. */
  let pending = $state<StoreRecord | undefined>(undefined);

  /**
   * Rewrites the query string and lets the router re-run `load`, rather than re-fetching by hand:
   * one code path reads a page of records, and the URL stays the description of what is on screen.
   * @param changes - The params to set, or to drop when the value is `undefined`.
   */
  function navigate(changes: Record<string, string | undefined>): void {
    const params = new URLSearchParams(page.url.searchParams);
    for (const [key, value] of Object.entries(changes)) {
      if (value === undefined) params.delete(key);
      else params.set(key, value);
    }
    const search = params.size > 0 ? `?${params}` : "";
    void goto(`${base}${search}`, { keepFocus: true, noScroll: true });
  }

  /**
   * Sorting by the column already sorted flips its direction; sorting by another starts ascending.
   * @param field - The column's field name.
   */
  function sortBy(field: string): void {
    const flip = data.order?.field === field && data.order.direction !== "desc";
    navigate({ sort: field, direction: flip ? "desc" : "asc", offset: undefined });
  }

  async function remove(record: StoreRecord): Promise<void> {
    pending = undefined;
    deleteError = undefined;
    try {
      await data.client.remove(data.collection.slug, record.id);
      await invalidateAll();
    } catch (caught) {
      deleteError = caught;
    }
  }
</script>

<PageHeader
  title={data.collection.plural}
  crumbs={[
    { label: "Página Inicial", href: data.schema.basePath },
    { label: data.collection.plural },
  ]}
>
  {#snippet actions()}
    <Button variant="primary" size="sm" href="{base}/new">
      + Nova {data.collection.singular}
    </Button>
  {/snippet}
</PageHeader>

{#if deleteError}
  <div class="banner">
    <Alert tone="error">
      {deleteError instanceof Error ? deleteError.message : String(deleteError)}
    </Alert>
  </div>
{/if}

<div class="shuri-card">
  {#if data.records.length === 0}
    <EmptyState
      title="Nenhum {data.collection.singular.toLowerCase()} ainda"
      description="Os campos do formulário vêm do schema desta coleção."
    >
      {#snippet action()}
        <Button variant="primary" href="{base}/new">
          Criar o primeiro {data.collection.singular.toLowerCase()}
        </Button>
      {/snippet}
    </EmptyState>
  {:else}
    <RecordTable
      collection={data.collection}
      records={data.records}
      relationLabels={data.relationLabels}
      order={data.order}
      href={(record) => `${base}/${record.id}`}
      onsort={sortBy}
      ondelete={(record) => (pending = record)}
    />
    <Pager
      offset={data.offset}
      limit={PAGE_SIZE}
      count={data.records.length}
      hasMore={data.hasMore}
      onchange={(offset) =>
        navigate({ offset: offset === 0 ? undefined : String(offset) })}
    />
  {/if}
</div>

<ConfirmDialog
  open={pending !== undefined}
  title="Remover registro?"
  message={pending
    ? `"${recordLabel(data.collection, pending)}" será removido permanentemente. Essa ação não pode ser desfeita.`
    : ""}
  onconfirm={() => {
    if (pending) void remove(pending);
  }}
  oncancel={() => (pending = undefined)}
/>

<style>
  .banner {
    margin-bottom: 12px;
  }
</style>
