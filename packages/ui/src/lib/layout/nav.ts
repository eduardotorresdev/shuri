import type { AdminGlobal, AdminSchema } from "$shared/schema.js";
import type { IconName } from "../ui/icons.js";

/** One entry of the sidebar: what it is called, where it goes, and how it is drawn. */
export interface NavItem {
  label: string;
  href: string;
  icon: IconName;
  /**
   * Where "create one" goes, for an entry that holds many records. Absent for a global, which is a
   * single record that already exists — the index draws the shortcut only for the entries that have
   * one.
   */
  newHref?: string;
}

/**
 * One step of the trail above a page title. The last step is the current screen and carries no
 * `href` — a link to where you already are is a link nobody can use.
 */
export interface Crumb {
  label: string;
  href?: string;
}

/** A titled run of sidebar entries — "Coleções", or one group per global category. */
export interface NavGroup {
  title: string;
  items: readonly NavItem[];
}

/**
 * Groups globals by their declared category, preserving the order each category was first seen in.
 *
 * `GlobalCategory` exists precisely so an admin can group them (its own doc comment says so), and
 * declaration order is the only ordering an author controls — sorting alphabetically would silently
 * override it.
 * @param globals - The declared globals.
 * @param basePath - The path the admin is mounted at, prefixed onto each entry's href.
 * @returns One group per category, in first-declaration order.
 */
function groupGlobals(
  globals: readonly AdminGlobal[],
  basePath: string,
): readonly NavGroup[] {
  const groups = new Map<string, NavItem[]>();

  for (const global of globals) {
    const items = groups.get(global.category) ?? [];
    items.push({
      label: global.title,
      href: `${basePath}/globals/${global.slug}`,
      icon: "global",
    });
    groups.set(global.category, items);
  }

  return [...groups].map(([title, items]) => ({ title, items }));
}

/**
 * Builds the whole navigation from the schema: collections first, then the globals grouped by
 * category. A group with no entries is left out rather than rendered empty.
 *
 * Both the sidebar and the index draw from this one function — the index is the same list of
 * destinations laid out as cards, so a schema that navigates one way navigates the other.
 * @param schema - The admin schema to build navigation from.
 * @returns The navigation's groups, in display order.
 */
export function navGroups(schema: AdminSchema): readonly NavGroup[] {
  const base = schema.basePath;
  const collections: NavGroup = {
    title: "Coleções",
    items: schema.collections.map((collection) => ({
      label: collection.plural,
      href: `${base}/collections/${collection.slug}`,
      icon: "collection",
      newHref: `${base}/collections/${collection.slug}/new`,
    })),
  };

  // Its own group, last, rather than an entry among the collections: accounts are not content, and
  // an app's own `users`-shaped collection (a profile, an author) would sit in that list beside it.
  const access: NavGroup = {
    title: "Acesso",
    items: schema.users
      ? [
          {
            label: schema.users.collection.plural,
            href: `${base}/users`,
            icon: "user",
            newHref: `${base}/users/new`,
          },
        ]
      : [],
  };

  return [collections, ...groupGlobals(schema.globals, base), access].filter(
    (group) => group.items.length > 0,
  );
}

/**
 * Whether a nav entry is the one currently open. A prefix match, not equality, so a record's own
 * page keeps its collection highlighted in the sidebar.
 * @param href - The entry's path.
 * @param pathname - The current path.
 * @returns Whether `href` is the open entry.
 */
export function isActive(href: string, pathname: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
