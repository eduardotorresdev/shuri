<script lang="ts">
  import { invalidateAll } from "$app/navigation";
  import { page } from "$app/state";
  import { createAdminAuthClient } from "$shared/auth.js";
  import ForbiddenScreen from "$lib/auth/ForbiddenScreen.svelte";
  import LoginScreen from "$lib/auth/LoginScreen.svelte";
  import SetupScreen from "$lib/auth/SetupScreen.svelte";
  import UserMenu from "$lib/auth/UserMenu.svelte";
  import AdminShell from "$lib/layout/AdminShell.svelte";
  // oxlint-disable-next-line import/no-unassigned-import -- a stylesheet has nothing to bind
  import "$lib/styles/admin.css";
  import type { LayoutProps } from "./$types.js";

  let { data, children }: LayoutProps = $props();

  const schema = $derived(data.schema);
  const auth = $derived(schema.auth);
  const viewer = $derived(schema.viewer);

  /**
   * Re-reads the schema, which is what carries the session's effect: signed in it comes back with
   * the collections, signed out it comes back as the shell. One request decides which screen shows,
   * so there is no second source of truth about who is logged in.
   */
  async function refresh(): Promise<void> {
    await invalidateAll();
  }

  async function signOut(): Promise<void> {
    if (auth) await createAdminAuthClient(auth).signOut();
    await refresh();
  }
</script>

<svelte:head>
  <title>{schema.title}</title>
</svelte:head>

<!--
  Four states, and only the last renders the admin. The order matters: `viewer` is present exactly
  when `auth` is, so an app with no auth falls straight through to the shell as before. `setup` comes
  first because it is the only one that can be true before any account exists.
-->
{#if auth?.setup && viewer?.status === "setup"}
  <SetupScreen setup={auth.setup} title={schema.title} oncreated={refresh} />
{:else if auth && viewer?.status === "anonymous"}
  <LoginScreen
    {auth}
    title={schema.title}
    returnTo={schema.basePath}
    onsignedin={refresh}
  />
{:else if viewer?.status === "forbidden"}
  <ForbiddenScreen user={viewer.user} title={schema.title} onsignout={signOut} />
{:else}
  <AdminShell {schema} pathname={page.url.pathname}>
    {#snippet actions(collapsed)}
      {#if viewer?.status === "allowed"}
        <UserMenu user={viewer.user} {collapsed} onsignout={signOut} />
      {/if}
    {/snippet}
    {@render children()}
  </AdminShell>
{/if}
