<script lang="ts">
  import type { AdminUser } from "$shared/schema.js";
  import Alert from "../ui/Alert.svelte";
  import Button from "../ui/Button.svelte";
  import AuthCard from "./AuthCard.svelte";

  interface Props {
    user: AdminUser;
    /** The app's name, so the refusal is branded like the login it came from. */
    title: string;
    onsignout: () => Promise<void>;
  }

  let { user, title, onsignout }: Props = $props();

  let signingOut = $state(false);

  async function signOut(): Promise<void> {
    signingOut = true;
    await onsignout();
    signingOut = false;
  }
</script>

<!--
  Authenticated, and refused by the host's `authorize`. Showing the login form again would be wrong
  twice over: the credentials are correct, and re-entering them changes nothing. So this says who is
  signed in and offers the one action that can help — signing in as somebody else.
-->
<AuthCard {title} width={420}>
  <h2>Sem acesso</h2>
  <Alert tone="error">
    <strong>{user.email}</strong> não tem permissão para usar o admin.
  </Alert>
  <p class="shuri-muted">
    Peça acesso a quem administra o app, ou entre com outra conta.
  </p>
  <Button disabled={signingOut} onclick={signOut}>
    {signingOut ? "Saindo…" : "Sair"}
  </Button>
</AuthCard>

<style>
  h2 {
    font-size: 17px;
    font-weight: 600;
  }

  p {
    margin: 0;
    font-size: 13px;
  }
</style>
