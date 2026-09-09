<script lang="ts">
  import { goto } from "$app/navigation";
  import PageHeader from "$lib/layout/PageHeader.svelte";
  import RecordForm from "$lib/forms/RecordForm.svelte";
  import type { PageProps } from "./$types.js";

  let { data }: PageProps = $props();

  const base = $derived(`${data.schema.basePath}/collections/${data.collection.slug}`);
  const title = $derived(`Nova ${data.collection.singular}`);
</script>

<PageHeader
  {title}
  crumbs={[
    { label: "Página Inicial", href: data.schema.basePath },
    { label: data.collection.plural, href: base },
    { label: title },
  ]}
/>

<RecordForm
  fields={data.collection.fields}
  relationOptions={data.relationOptions}
  submitLabel="Criar"
  cancelHref={base}
  onsubmit={async (input) => {
    const created = await data.client.create(data.collection.slug, input);
    // Straight to the new record's own page: it is where the author lands after every other save,
    // and it proves the record exists with the id the store assigned it.
    await goto(`${base}/${created.id}`);
  }}
/>
