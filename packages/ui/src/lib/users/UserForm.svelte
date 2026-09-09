<script lang="ts">
  import type { Field } from "@shuri/core";
  import type { RecordInput } from "@shuri/store";
  import { issuesByField } from "$shared/index.js";
  import FieldControl from "../fields/FieldControl.svelte";
  import { fieldLabel, formValues, toRecordInput } from "../fields/values.js";
  import IssueSummary from "../forms/IssueSummary.svelte";
  import Button from "../ui/Button.svelte";
  import FormField from "../ui/FormField.svelte";

  interface Props {
    /** The users collection's fields, from `schema.users.collection`. */
    fields: readonly Field[];
    /** The user being edited; absent when creating. */
    user?: RecordInput;
    /** The server's own minimum, so the form states the policy that will actually be enforced. */
    passwordMinLength: number;
    cancelHref: string;
    ondelete?: () => void;
    /** Receives the body to write. Throwing from it shows the error, including per-field issues. */
    onsubmit: (input: RecordInput) => Promise<void>;
  }

  let { fields, user, passwordMinLength, cancelHref, ondelete, onsubmit }: Props =
    $props();

  const editing = $derived(user !== undefined);

  // svelte-ignore state_referenced_locally
  let values = $state(formValues(fields, user));
  let password = $state("");
  let saving = $state(false);
  let error = $state<unknown>(undefined);

  const fieldErrors = $derived(issuesByField(error));

  /**
   * Sends the schema fields plus, when one was typed, the password.
   *
   * An empty box is not an empty password: on the edit screen it means "leave the credential alone",
   * and on the create screen it means an account that has none yet — which is what an OIDC-only user
   * is. Either way it is left out of the body rather than sent as `""`, which the server would
   * refuse as a password too short.
   * @param event - The form's submit event.
   */
  async function handleSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    saving = true;
    error = undefined;
    try {
      const input = toRecordInput(fields, values);
      if (password !== "") input["password"] = password;
      await onsubmit(input);
      password = "";
    } catch (caught) {
      error = caught;
    } finally {
      saving = false;
    }
  }
</script>

<!--
  Not `RecordForm`, though it renders the same controls from the same schema: a user carries one
  thing no record does — a credential that is written but never read back. `RecordForm` binds every
  control to a value it loaded, and there is no value to load here; the box is empty even when a
  password is set, and empty means "unchanged". That is a different form, not a variant of that one.
-->
<form onsubmit={handleSubmit} novalidate>
  {#if error}
    <IssueSummary {error} />
  {/if}

  {#each fields as field (field.name)}
    <FormField
      id="user-{field.name}"
      label={fieldLabel(field)}
      required={field.required}
      error={fieldErrors[field.name]}
    >
      <FieldControl
        {field}
        id="user-{field.name}"
        invalid={fieldErrors[field.name] !== undefined}
        disabled={saving}
        bind:value={values[field.name]}
      />
    </FormField>
  {/each}

  <FormField
    id="user-password"
    label={editing ? "Nova senha" : "Senha"}
    error={fieldErrors["password"]}
    hint={editing
      ? `Deixe em branco para manter a senha atual. Trocá-la encerra as sessões desse usuário. Mínimo de ${passwordMinLength} caracteres.`
      : `Opcional — sem senha, o acesso é só por provedor externo. Mínimo de ${passwordMinLength} caracteres.`}
  >
    <input
      class="shuri-input"
      type="password"
      id="user-password"
      autocomplete="new-password"
      minlength={passwordMinLength}
      disabled={saving}
      aria-invalid={fieldErrors["password"] !== undefined}
      bind:value={password}
    />
  </FormField>

  <div class="actions">
    <Button type="submit" variant="primary" disabled={saving}>
      {saving ? "Salvando…" : editing ? "Salvar" : "Criar usuário"}
    </Button>
    <Button href={cancelHref}>Cancelar</Button>
    {#if ondelete}
      <div class="destructive">
        <Button variant="danger" disabled={saving} onclick={ondelete}>Remover</Button>
      </div>
    {/if}
  </div>
</form>

<style>
  form {
    display: grid;
    gap: 20px;
    width: 100%;
    max-width: 780px;
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-top: 8px;
  }

  .destructive {
    margin-left: auto;
  }
</style>
