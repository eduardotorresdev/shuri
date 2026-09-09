<script lang="ts">
  import type { AdminSetup } from "$shared/schema.js";
  import { runAdminSetup } from "$shared/setup.js";
  import { AdminRequestError, issuesByField } from "$shared/index.js";
  import Alert from "../ui/Alert.svelte";
  import Button from "../ui/Button.svelte";
  import FormField from "../ui/FormField.svelte";
  import AuthCard from "./AuthCard.svelte";

  interface Props {
    setup: AdminSetup;
    title: string;
    /** Run after the account is created — reloading the schema, which then carries the session. */
    oncreated: () => Promise<void>;
  }

  let { setup, title, oncreated }: Props = $props();

  let name = $state("");
  let email = $state("");
  let password = $state("");
  let confirmation = $state("");
  let token = $state("");
  let submitting = $state(false);
  let error = $state<unknown>(undefined);

  const fieldErrors = $derived(issuesByField(error));
  /**
   * Checked here and nowhere else: the server has one password, so it has nothing to compare. This
   * is the whole point of the second field — catching a typo in the one credential that cannot be
   * recovered, before it becomes the only way into the app.
   */
  const mismatch = $derived(confirmation !== "" && confirmation !== password);

  async function handleSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (mismatch) return;

    submitting = true;
    error = undefined;
    try {
      await runAdminSetup(setup, {
        email,
        password,
        ...(name ? { name } : {}),
        ...(setup.tokenRequired ? { token } : {}),
      });
      password = "";
      confirmation = "";
      await oncreated();
    } catch (caught) {
      error = caught;
    } finally {
      submitting = false;
    }
  }
</script>

<!--
  Shown in place of the login form while the app has no account at all. A separate screen rather than
  a mode of the login one: the copy, the fields and the consequence are all different, and offering
  "sign in" on an app nobody can sign in to is the confusing half of a first run.
-->
<AuthCard {title} width={420}>
  <p class="shuri-muted">
    Este app ainda não tem nenhuma conta. Crie a primeira — ela será a sua.
  </p>

  {#if error}
    <Alert tone="error">
      {error instanceof AdminRequestError ? error.message : String(error)}
    </Alert>
  {/if}

  <form onsubmit={handleSubmit}>
    <FormField id="setup-name" label="Nome" error={fieldErrors["name"]}>
      <input
        class="shuri-input"
        id="setup-name"
        type="text"
        autocomplete="name"
        disabled={submitting}
        bind:value={name}
      />
    </FormField>

    <FormField id="setup-email" label="E-mail" required error={fieldErrors["email"]}>
      <input
        class="shuri-input"
        id="setup-email"
        type="email"
        autocomplete="username"
        required
        disabled={submitting}
        bind:value={email}
      />
    </FormField>

    <FormField
      id="setup-password"
      label="Senha"
      required
      error={fieldErrors["password"]}
      hint="Pelo menos 8 caracteres."
    >
      <input
        class="shuri-input"
        id="setup-password"
        type="password"
        autocomplete="new-password"
        required
        minlength={8}
        disabled={submitting}
        bind:value={password}
      />
    </FormField>

    <FormField
      id="setup-confirmation"
      label="Confirme a senha"
      required
      error={mismatch ? "As senhas não conferem." : undefined}
    >
      <input
        class="shuri-input"
        id="setup-confirmation"
        type="password"
        autocomplete="new-password"
        required
        aria-invalid={mismatch}
        disabled={submitting}
        bind:value={confirmation}
      />
    </FormField>

    {#if setup.tokenRequired}
      <FormField
        id="setup-token"
        label="Token de setup"
        required
        error={fieldErrors["token"]}
        hint="Definido por quem publicou este app."
      >
        <input
          class="shuri-input shuri-mono"
          id="setup-token"
          type="text"
          autocomplete="off"
          required
          disabled={submitting}
          bind:value={token}
        />
      </FormField>
    {/if}

    <Button type="submit" variant="primary" disabled={submitting || mismatch}>
      {submitting ? "Criando…" : "Criar conta e entrar"}
    </Button>
  </form>
</AuthCard>

<style>
  p {
    margin: -8px 0 0;
    font-size: 13px;
  }

  form {
    display: grid;
    gap: 16px;
  }
</style>
