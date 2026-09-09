<script lang="ts">
  import { goto, invalidateAll } from "$app/navigation";
  import PageHeader from "$lib/layout/PageHeader.svelte";
  import ConfirmDialog from "$lib/ui/ConfirmDialog.svelte";
  import UserForm from "$lib/users/UserForm.svelte";
  import { recordLabel } from "$lib/fields/values.js";
  import type { PageProps } from "./$types.js";

  let { data }: PageProps = $props();

  const base = $derived(`${data.schema.basePath}/users`);
  const collection = $derived(data.users.collection);
  const label = $derived(recordLabel(collection, data.user));
  /** Whether this is the account being used right now — the one the server refuses to delete. */
  const self = $derived(
    data.schema.viewer?.status === "allowed" &&
      data.schema.viewer.user.id === data.user.id,
  );
  let confirming = $state(false);

  async function remove(): Promise<void> {
    confirming = false;
    await data.client.removeUser(data.user.id);
    await goto(base, { invalidateAll: true });
  }
</script>

<PageHeader
  title={label}
  badge={self ? "Você" : undefined}
  crumbs={[
    { label: "Página Inicial", href: data.schema.basePath },
    { label: collection.plural, href: base },
    { label },
  ]}
/>

<UserForm
  fields={collection.fields}
  user={data.user}
  passwordMinLength={data.users.passwordMinLength}
  cancelHref={base}
  ondelete={self ? undefined : () => (confirming = true)}
  onsubmit={async (input) => {
    await data.client.updateUser(data.user.id, input);
    await invalidateAll();
  }}
/>

<ConfirmDialog
  open={confirming}
  title="Remover usuário?"
  message={`"${label}" perde o acesso imediatamente: a conta, as sessões abertas e os vínculos com provedores externos são removidos. Essa ação não pode ser desfeita.`}
  onconfirm={() => void remove()}
  oncancel={() => (confirming = false)}
/>
