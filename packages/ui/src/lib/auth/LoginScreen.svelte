<script lang="ts">
  import type { AdminAuth } from "$shared/schema.js";
  import { createAdminAuthClient, signInErrorMessage } from "$shared/auth.js";
  import Alert from "../ui/Alert.svelte";
  import Button from "../ui/Button.svelte";
  import FormField from "../ui/FormField.svelte";
  import AuthCard from "./AuthCard.svelte";

  interface Props {
    /** The auth block of the schema: where to post, and which providers to offer. */
    auth: AdminAuth;
    title: string;
    /** Where an OIDC round trip should land back, normally the admin's own base path. */
    returnTo: string;
    /** Run after a successful sign-in — reloading the schema, which then carries the session. */
    onsignedin: () => Promise<void>;
  }

  let { auth, title, returnTo, onsignedin }: Props = $props();

  // Derived, not captured at init: the component outlives a schema reload, and the client is
  // bound to `auth.basePath`.
  const client = $derived(createAdminAuthClient(auth));

  let email = $state("");
  let password = $state("");
  let submitting = $state(false);
  let error = $state<unknown>(undefined);

  async function handleSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    submitting = true;
    error = undefined;
    try {
      await client.signIn({ email, password });
      // The password is gone from memory before the reload that reveals the admin, so it is not
      // sitting in a component that is about to stay mounted behind it.
      password = "";
      await onsignedin();
    } catch (caught) {
      error = caught;
    } finally {
      submitting = false;
    }
  }
</script>

<!--
  A full-page takeover rather than a route of its own, so signing in leaves the URL alone: whoever
  followed a link straight to a record lands on that record, not on the index.
-->
<AuthCard {title}>
  {#if error}
    <Alert tone="error">{signInErrorMessage(error)}</Alert>
  {/if}

  <form onsubmit={handleSubmit}>
    <FormField id="login-email" label="E-mail">
      <input
        class="shuri-input sunken"
        id="login-email"
        type="email"
        placeholder="voce@empresa.com"
        autocomplete="username"
        required
        disabled={submitting}
        bind:value={email}
      />
    </FormField>

    <FormField id="login-password" label="Senha">
      <input
        class="shuri-input sunken"
        id="login-password"
        type="password"
        placeholder="••••••••"
        autocomplete="current-password"
        required
        disabled={submitting}
        bind:value={password}
      />
    </FormField>

    <Button type="submit" variant="primary" disabled={submitting}>
      {submitting ? "Entrando…" : "Entrar"}
    </Button>
  </form>

  {#if auth.providers.length > 0}
    <div class="divider"><span>ou</span></div>
    <div class="providers">
      {#each auth.providers as provider (provider)}
        <!--
          A real link, not a fetch: an OIDC sign-in is a full-page round trip to another origin,
          which XHR cannot follow.
        -->
        <a class="provider" href={client.oidcUrl(provider, returnTo)}>
          Continuar com {provider}
        </a>
      {/each}
    </div>
  {/if}
</AuthCard>

<style>
  form {
    display: grid;
    gap: 16px;
  }

  /*
   * The login's inputs are tinted rather than white: they sit on a white card, and a white field on
   * white paper has only its border to say it is a field at all.
   */
  .sunken {
    background: var(--shuri-panel);
  }

  .sunken:focus {
    background: var(--shuri-surface);
  }

  .divider {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: 10px;
    font-size: 12px;
    color: var(--shuri-text-faint);
  }

  .divider::before,
  .divider::after {
    content: "";
    height: 1px;
    background: var(--shuri-border);
  }

  .providers {
    display: grid;
    gap: 8px;
  }

  .provider {
    padding: 11px 12px;
    font-size: 14px;
    font-weight: 600;
    text-align: center;
    color: var(--shuri-text);
    border: 1px solid var(--shuri-border-strong);
    border-radius: var(--shuri-radius-md);
    transition: border-color 0.18s var(--shuri-ease);
  }

  .provider:hover {
    color: var(--shuri-text);
    border-color: var(--shuri-accent);
  }
</style>
