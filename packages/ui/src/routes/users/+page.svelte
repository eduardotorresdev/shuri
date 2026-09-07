<script lang="ts">
  import { goto, invalidateAll } from "$app/navigation";
  import { page } from "$app/state";
  import type { StoreRecord } from "@shuri/store";
  import PageHeader from "$lib/layout/PageHeader.svelte";
  import ListFilters from "$lib/lists/ListFilters.svelte";
  import Pager from "$lib/lists/Pager.svelte";
  import RecordTable from "$lib/lists/RecordTable.svelte";
  import Alert from "$lib/ui/Alert.svelte";
  import Button from "$lib/ui/Button.svelte";
  import ConfirmDialog from "$lib/ui/ConfirmDialog.svelte";
  import EmptyState from "$lib/ui/EmptyState.svelte";
  import { recordLabel } from "$lib/fields/values.js";
  import {
    filterFields,
    filterParams,
    type ListFilters as Filters,
  } from "$lib/lists/filters.js";
  import { PAGE_SIZE } from "$lib/lists/paging.js";
  import type { PageProps } from "./$types.js";

  let { data }: PageProps = $props();

  const base = $derived(`${data.schema.basePath}/users`);
  const filterable = $derived(filterFields(data.collection));
  const filtered = $derived(Object.keys(data.filters).length > 0);
  /** The account this very screen is being read through: the server refuses to delete it. */
  const viewerId = $derived(
    data.schema.viewer?.status === "allowed" ? data.schema.viewer.user.id : undefined,
  );
  let deleteError = $state<unknown>(undefined);
  let pending = $state<StoreRecord | undefined>(undefined);

  function navigate(changes: Record<string, string | undefined>): void {
    const params = new URLSearchParams(page.url.searchParams);
    for (const [key, value] of Object.entries(changes)) {
      if (value === undefined) params.delete(key);
      else params.set(key, value);
    }
    const search = params.size > 0 ? `?${params}` : "";
    void goto(`${base}${search}`, { keepFocus: true, noScroll: true });
  }

  function sortBy(field: string): void {
    const flip = data.order?.field === field && data.order.direction !== "desc";
    navigate({ sort: field, direction: flip ? "desc" : "asc", offset: undefined });
  }

  function applyFilters(filters: Filters): void {
    navigate({ ...filterParams(filterable, filters), offset: undefined });
  }

  async function remove(record: StoreRecord): Promise<void> {
    pending = undefined;
    deleteError = undefined;
    try {
      await data.client.removeUser(record.id);
      await invalidateAll();
    } catch (caught) {
      deleteError = caught;
    }
  }
</script>

<PageHeader
  title={data.collection.plural}
  description="Quem pode entrar no admin. Criar uma conta aqui dá a ela o mesmo acesso que a sua tem."
  crumbs={[
    { label: "Página Inicial", href: data.schema.basePath },
    { label: data.collection.plural },
  ]}
>
  {#snippet actions()}
    <Button variant="primary" size="sm" href="{base}/new">
      + Novo {data.collection.singular.toLowerCase()}
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
  {#if filterable.length > 0}
    <ListFilters fields={filterable} filters={data.filters} onapply={applyFilters} />
  {/if}

  {#if data.records.length === 0 && filtered}
    <EmptyState
      title="Nenhum resultado"
      description="Nenhuma conta corresponde aos filtros aplicados."
    >
      {#snippet action()}
        <Button onclick={() => applyFilters({})}>Limpar filtros</Button>
      {/snippet}
    </EmptyState>
  {:else if data.records.length === 0}
    <!--
      Reachable in practice only with a filter on: you are reading this screen through a session,
      and that session belongs to one of the rows. It is here for the app whose accounts live
      somewhere else entirely.
    -->
    <EmptyState title="Nenhuma conta" description="Nenhum usuário cadastrado ainda.">
      {#snippet action()}
        <Button variant="primary" href="{base}/new">Criar o primeiro usuário</Button>
      {/snippet}
    </EmptyState>
  {:else}
    <RecordTable
      collection={data.collection}
      records={data.records}
      order={data.order}
      href={(record) => `${base}/${record.id}`}
      onsort={sortBy}
      ondelete={(record) => (pending = record)}
      candelete={(record) => record.id !== viewerId}
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
  title="Remover usuário?"
  message={pending
    ? `"${recordLabel(data.collection, pending)}" perde o acesso imediatamente: a conta, as sessões abertas e os vínculos com provedores externos são removidos. Essa ação não pode ser desfeita.`
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
