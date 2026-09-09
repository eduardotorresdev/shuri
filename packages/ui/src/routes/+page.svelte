<script lang="ts">
  import { navGroups } from "$lib/layout/nav.js";
  import EmptyState from "$lib/ui/EmptyState.svelte";
  import Icon from "$lib/ui/Icon.svelte";
  import type { PageProps } from "./$types.js";

  let { data }: PageProps = $props();

  const { schema } = $derived(data);
  /**
   * The same groups the sidebar is built from, laid out as cards. The index is not a second listing
   * of the schema — it is the sidebar with room to breathe, so the two can never disagree.
   */
  const groups = $derived(navGroups(schema));
</script>

<h1>{schema.title}</h1>

{#if groups.length === 0}
  <div class="shuri-card">
    <EmptyState
      title="Nenhuma coleção ou global"
      description={`Declare uma coleção em create({ collections }) e ela aparece aqui no próximo boot.`}
    />
  </div>
{:else}
  <div class="sections">
    {#each groups as group (group.title)}
      <section>
        <h2 class="shuri-eyebrow">{group.title}</h2>
        <ul>
          {#each group.items as item (item.href)}
            <li>
              <a class="card" href={item.href}>
                <span class="ico"><Icon name={item.icon} size={26} /></span>
                <span class="txt">
                  <span class="label">{item.label}</span>
                  <span class="sub">
                    {item.newHref ? "Coleção de registros" : "Registro único"}
                  </span>
                </span>
              </a>
              <!--
                Outside the card's anchor, not inside it: a link inside a link is not valid HTML, and
                the browser would resolve the click to whichever it felt like.
              -->
              {#if item.newHref}
                <a class="cta" href={item.newHref} title="Criar em {item.label}">
                  <span class="shuri-sr-only">Criar em {item.label}</span>
                  <Icon name="plus" size={16} />
                </a>
              {/if}
            </li>
          {/each}
        </ul>
      </section>
    {/each}
  </div>
{/if}

<style>
  h1 {
    margin-bottom: 32px;
  }

  .sections {
    display: flex;
    flex-direction: column;
    gap: 32px;
  }

  h2 {
    margin-bottom: 12px;
  }

  ul {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 16px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    position: relative;
  }

  .card {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 20px;
    /* Room for the create button, which floats over the card's own right edge. */
    padding-right: 66px;
    color: var(--shuri-text);
    background: var(--shuri-surface);
    border-radius: var(--shuri-radius);
    box-shadow: var(--shuri-shadow);
  }

  .ico {
    flex-shrink: 0;
    width: 34px;
    color: var(--shuri-c3);
    transition: transform 0.18s var(--shuri-ease);
    transform-origin: center left;
  }

  .card:hover {
    color: var(--shuri-text);
  }

  .card:hover .ico {
    transform: scale(1.18);
  }

  .txt {
    display: grid;
    min-width: 0;
    transition: padding-left 0.18s var(--shuri-ease);
  }

  .card:hover .txt {
    padding-left: 5px;
  }

  /* Wraps rather than truncating: a global's title is the only thing on the card worth reading. */
  .label {
    font-size: 16px;
    font-weight: 600;
    line-height: 1.25;
  }

  .sub {
    margin-top: 3px;
    font-size: 12px;
    font-weight: 400;
    color: var(--shuri-text-muted);
  }

  .cta {
    display: flex;
    align-items: center;
    justify-content: center;
    position: absolute;
    top: 50%;
    right: 20px;
    width: 34px;
    height: 34px;
    color: var(--shuri-panel);
    background: var(--shuri-text);
    border-radius: 50%;
    transform: translateY(-50%);
    transition:
      background 0.18s var(--shuri-ease),
      scale 0.18s var(--shuri-ease);
  }

  .cta:hover {
    color: var(--shuri-panel);
    background: var(--shuri-accent);
    scale: 1.05;
  }
</style>
