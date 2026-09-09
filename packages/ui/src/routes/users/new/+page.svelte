<script lang="ts">
  import { goto } from "$app/navigation";
  import PageHeader from "$lib/layout/PageHeader.svelte";
  import UserForm from "$lib/users/UserForm.svelte";
  import type { PageProps } from "./$types.js";

  let { data }: PageProps = $props();

  const base = $derived(`${data.schema.basePath}/users`);
  const collection = $derived(data.users.collection);
</script>

<PageHeader
  title="Novo {collection.singular.toLowerCase()}"
  crumbs={[
    { label: "Página Inicial", href: data.schema.basePath },
    { label: collection.plural, href: base },
    { label: `Novo ${collection.singular.toLowerCase()}` },
  ]}
/>

<UserForm
  fields={collection.fields}
  passwordMinLength={data.users.passwordMinLength}
  cancelHref={base}
  onsubmit={async (input) => {
    const created = await data.client.createUser(input);
    await goto(`${base}/${created.id}`);
  }}
/>
