# @shuri/ui

The visual admin: a CMS whose entire UI — navigation, list tables, forms, controls — is **generated
from the declared schema**. It holds no knowledge of any particular collection, so a field added to
`collections.ts` shows up as a form input on the next boot, with nothing to rebuild here.

It ships two ways, and they are the same code:

- **The whole app**, a SvelteKit SPA served by `createAdminHandler`, mounted into an app through
  `create()`'s `handlers`.
- **The components**, exported from `@shuri/ui/components`, for embedding a schema-driven table or
  form into an app of your own.

Pass `options.auth` and it sits behind a login, guarding the REST routes it edits through — and it
gains the Users screens, since the accounts that sign in are the one thing an admin behind a login
has to be able to manage. Omit it and **there is no access control at all**: mounting the admin then
exposes an editing UI for every collection the REST routes already serve, to whoever can reach them,
and no Users screens exist to gate.

## Tree

```
src/
  shared/                     the contract, shared by the server and the browser
    schema.ts                  AdminSchema/AdminCollection/AdminGlobal/AdminApiPaths/AdminAuth/AdminUsers/AdminViewer
    errors.ts                   AdminRequestError, issuesByField
    client.ts                    fetchAdminSchema, createAdminClient, encodeQuery
    auth.ts                       createAdminAuthClient, signInErrorMessage
    index.ts
  server/                     the HTTP side: Node/Deno/Bun/Workers, no Svelte
    handler.ts                 createAdminHandler: the schema route plus the bundle
    index.ts                    re-exports the server surface and `shared/`
    auth/
      types.ts                   AdminSessionSource, AdminAuthOptions
      access.ts                   resolveAdminAuth/toViewer: who is asking, and may they edit?
      guard.ts                     createAdminGuard, AdminForbiddenError
      protect.ts                    writesToApi (default) / everythingUnderApi
      user.ts                        toAdminUser: AuthUser -> the three fields the header shows
      setup-types.ts                  AdminSetupSource/AdminSetupOptions
      setup-validate.ts                validateSetupBody/toCredentials
      setup.ts                          createAdminSetupHandler: the first-account route
      test-support.ts                    stubSessions/asUser
    schema/
      build.ts                   buildAdminSchema/shellSchema/adminUsers: schemas -> the admin's document
      handler.ts                  createAdminSchemaHandler: GET {basePath}/schema.json, per session
    users/
      routes.ts                  matchUsersRoute
      handler.ts                  createAdminUsersHandler: {basePath}/api/users, behind `authorize`
    assets/
      types.ts                   AdminAsset/AdminAssets
      load.ts                     loadAdminAssets: reads build/ into memory, once, at startup
      handler.ts                   createAdminAssetsHandler: serves it, with the SPA fallback
      content-type.ts               contentTypeOf: extension -> content type
      etag.ts                        weakEtag: FNV-1a over an asset's bytes
    test/admin.test.ts          integration test over the composed handler
  lib/                        the components, exported as @shuri/ui/components
    index.ts                   the barrel
    layout/
      AdminShell.svelte          sidebar + the rounded panel the screens are drawn on
      SideNav.svelte              the nav rows, collapsed or not
      PageHeader.svelte            breadcrumbs, title, badge, actions
      nav.ts                        navGroups/isActive/NavItem/Crumb: schema -> navigation
    fields/
      FieldControl.svelte        the one place a field's `type` becomes a control
      TextControl.svelte / TextareaControl.svelte / EmailControl.svelte
      NumberControl.svelte / BooleanControl.svelte / SelectControl.svelte
      RelationControl.svelte
      values.ts                   emptyValue/formValues/toRecordInput/formatCell/recordLabel
      relations.ts                 loadRelationOptions/relationLabels
    forms/
      RecordForm.svelte          fields -> a whole form, with per-field server issues
      IssueSummary.svelte         the error banner
    lists/
      RecordTable.svelte         collection -> a sortable table
      ListFilters.svelte          the filter bar: chips, and the panel behind them
      FilterControl.svelte         a field's type -> the control that filters it
      Pager.svelte                  offset paging
      columns.ts                     listColumns/isSortable
      filters.ts                      filterOps/filterFields/readFilters/formFilters/toWhere
      paging.ts                        PAGE_SIZE, shared by every list
    users/
      UserForm.svelte            the account form: schema fields, plus the write-only password
    auth/
      AuthCard.svelte            the cream page and white card the three signed-out screens share
      SetupScreen.svelte          the first-account form, shown while no account exists
      LoginScreen.svelte           email/password plus the OIDC buttons the schema advertises
      ForbiddenScreen.svelte        signed in, refused by `authorize`
      UserMenu.svelte                the sidebar's user card, and "Sair"
    ui/                        Button, Alert, Spinner, EmptyState, FormField, ConfirmDialog, Icon
      icons.ts                   the seven icon paths, drawn by Icon.svelte
    styles/admin.css           tokens and shared classes, exported as @shuri/ui/admin.css
    styles/fonts/              Space Grotesk, subset and bundled (see its NOTICE.md)
  routes/                     the SvelteKit app (SPA, no SSR)
    +layout.ts / +layout.svelte     loads the schema once, draws the shell
    +page.svelte                     the index of collections and globals
    +error.svelte                     stands alone: the layout's own load can fail
    collections/[slug]/+page.*        list
    collections/[slug]/new/+page.*    create
    collections/[slug]/[id]/+page.*   edit and delete
    globals/[slug]/+page.*            the single-record form
    users/+page.*                      the accounts list
    users/new/+page.* , users/[id]/+page.*   create, edit and delete an account
```

## What each part does

- **shared/schema.ts** — `AdminSchema` is the whole contract. The browser draws every screen from
  it and nothing else, which is why the admin needs no per-collection code and why a schema change
  needs no rebuild of this package.
- **server/schema/build.ts** — projects the declared `CollectionSchema[]`/`GlobalSchema[]` onto that
  document, applying the same two visibility flags `@shuri/api` applies to responses:
  `servableCollections` drops an `internal` collection, `visibleFields` drops a `hidden` field. Both
  come from `@shuri/core`'s `redact.ts` rather than being re-decided here — a hidden field left in
  would be rendered as an input whose every save is a 400 the author can do nothing about. It also
  derives `labelField`, the first `text`/`email` field, which is what lets a list's first column and
  a relation picker read as names with no configuration.
- **server/assets/load.ts** — reads the built bundle off disk **once, eagerly, at startup**. That
  turns a per-request `stat`+`read` — and the path-traversal question that comes with resolving a
  request path against a directory — into a `Map.get` that cannot escape the map, and it fails at
  boot where a missing build is obvious. It is the only module in the package that touches a
  filesystem; `createAdminHandler` takes the map as data, so a runtime without `node:fs` supplies
  its own.
- **server/assets/handler.ts** — serves a file when the path names one, and `index.html` when it
  doesn't, because those paths belong to the client router: reloading
  `/admin/collections/posts/abc` has to return the app, which then routes the URL itself. Paths
  ending in an extension are excluded from that fallback — a missing `.js` must 404 rather than come
  back as HTML the browser reports as a syntax error two layers from the cause.
- **server/handler.ts** — composes the three, in the one order that works: the guard (which reaches
  well outside `basePath`), then the schema route, then the assets. Schema before assets because
  both live under `basePath` and the assets handler answers everything there, so `schema.json` would
  come back as `index.html` the other way round. Takes the declared schemas rather than a `Core` or a
  `Store`, because it needs nothing else: the admin reads and writes from the browser, over the
  app's own REST routes.
- **server/auth/** — the whole of authentication, in one folder for the same reason `@shuri/api` has
  a `visibility/` one: `ls src/server/auth` should answer "where is access decided, and did we miss a
  path?" in full.
  - `access.ts` resolves one value, `AdminAccess`, with all three answers in it — anonymous,
    forbidden, allowed. The schema handler turns it into a `viewer` and the guard into a status code;
    two separate checks could disagree, and disagreeing here means serving a document to somebody the
    guard would have refused.
  - `guard.ts` protects **the app's REST routes**, not the admin's pages. That is the only place a
    guard can do anything: the admin edits through those routes and holds no data of its own, so
    refusing to serve `/admin` would be theatre with the records still one `curl` away.
  - The bundle and the schema document stay public by design. The login form is drawn from that
    document, so gating it would leave a signed-out visitor nothing to sign in _with_; the document
    withholds every collection and global instead, so all an anonymous caller learns is that an admin
    exists and where to post.
  - `protect.ts` defaults to **writes only**. Reads are what a headless CMS's API is for — the site
    consuming it holds no session — and closing them would change how an app behaves merely because
    it gained an admin. `everythingUnderApi` closes them, at the cost of a public API.
  - `authorize` is the entire authorization story, and it defaults to _any session_. `@shuri/auth`
    has no roles; inventing some here would put a second, weaker permission model beside whatever the
    host already has. **With open signup and the default, anyone who registers can edit everything.**
    (`@shuri/better-auth` does have roles, through better-auth's `admin` plugin — `authorize` then
    reads `session.user.role`.)
  - `AdminSessionSource` is the whole of what the admin needs from an auth implementation, which is
    why swapping one in costs nothing here: `@shuri/better-auth` satisfies it and every screen below
    is unchanged. `signInPath`/`signOutPath` exist for the same reason — `@shuri/auth` serves
    `/auth/login`, better-auth serves `/api/auth/sign-in/email`, and the admin is told which.
  - `user.ts` whitelists three fields off `AuthUser`, which carries an index signature — every extra
    field a host declares on `users` would otherwise ride along into a document served to anonymous
    callers.
- **lib/styles/admin.css** — the design, in one file. Four theme colours (`--shuri-c1`…`c4`) and
  nothing else is themeable: the paper (cream page, lighter panel, white cards) and the ink are what
  make the admin legible, so they are fixed. The `-deep` and `-tint` variants are derived from the
  four with `color-mix`, so overriding `--shuri-c2` moves its text and wash colours with it. The
  admin is **light only** — the design has one palette, and a dark theme invented beside it would be
  a second design nobody drew.
- **lib/auth/** — the three screens the layout switches between, one per `AdminViewer` status that
  is not `allowed`. Each is a full-page takeover rather than a route, so signing in leaves the URL
  alone and whoever followed a link to a record lands on that record.
- **server/auth/setup.ts** — the first-run flow: while the app has no account, the admin shows a form
  that creates one instead of a login form that nothing would accept.
  - `required()` is asked **twice** per attempt: once to refuse early, and again inside a lock
    immediately before creating. The second is the one that matters — without it two requests
    arriving together both see "no account yet" and both create an administrator. The lock is a
    promise chain, so it serialises within one process; two processes racing needs a unique
    constraint on the users table, or the token.
  - Setup is necessarily **unauthenticated** — there is no account to authenticate against — so on a
    public URL it is a race to claim the admin. `token` closes that, and the schema advertises
    `tokenRequired` so the form knows to ask. Compared in constant time, since `===` on strings
    returns early and leaks how much matched.
  - The guard refuses a protected write during the window exactly as it does for `anonymous`: an app
    with no account has no administrator either, and first-run must not be a hole.
  - The `setup` block **disappears from the schema document** the moment an account exists, which is
    also the moment the route starts answering 409. That is why `advertised` is a function rather
    than a value.
  - A live session wins over `required()`: an account demonstrably exists, whatever the host's
    predicate currently says.
- **shared/auth.ts#signInErrorMessage** — collapses 400 and 401 into one sentence. `@shuri/auth`
  answers a wrong password and an unknown email identically on purpose, and the 400's own text names
  an internal field path (`body.password`); anything else keeps its message, since a 500 is not a
  typo.
- **lib/fields/FieldControl.svelte** — the single `type` switch in the package. Supporting a new
  field type added to `@shuri/core` is one branch here plus a component beside it; nothing else in
  the admin knows the union exists.
- **lib/fields/values.ts** — the round trip between stored records and form state. Every control is
  bound to a _defined_ value (`emptyValue`), because an input that flips between `undefined` and a
  string flips between uncontrolled and controlled mid-keystroke and the browser resets the caret.
  `toRecordInput` strips the empties back out on submit, which is what keeps an optional field
  optional — an untouched `email` sent as `""` fails the store's format check for a value nobody
  entered. `false` and `0` are kept: both are values an author chose.
- **lib/fields/relations.ts** — loads a relation field's options one request per _referenced
  collection_, not per field or per row, and `relationLabels` turns them into the `id -> label`
  lookup a table resolves its cells through.
- **lib/ui/ConfirmDialog.svelte** — a native `<dialog>` opened with `showModal()`, which is where
  the focus trap, the inert page behind and the Escape key come from for free. Deleting goes through
  it rather than `confirm()`, whose box belongs to the browser and looks like nothing else here.
- **lib/forms/RecordForm.svelte** — fields in, one form out, with the server's `issues` indexed by
  field (`issuesByField`) so `"title" is required` lands under the title input instead of in a
  banner. Validation is the store's: this form sends the write and renders what comes back.
- **shared/client.ts** — every REST call the admin makes, against the base paths the schema
  advertises, turning a non-2xx into an `AdminRequestError` carrying `issues`. `fetchAdminSchema` is
  separate because it produces `createAdminClient`'s argument: the schema names the paths, so the
  data client can't exist before it has been read.
- **server/users/** — the Users screens' data routes, at `{basePath}/api/users`, delegating to
  `@shuri/auth`'s `AuthApi.users`. Three things about them are deliberate:
  - **They are inside the admin's mount, not on the REST surface.** `users` stays `internal: true`,
    so it is served nowhere else; this is the one door into it, and it is behind the admin's own
    `authorize`.
  - **They check that gate themselves**, rather than leaning on `createAdminGuard`: the guard covers
    the app's REST base paths, and these paths are deliberately outside them. Reads are guarded too
    — the default `protect` leaves REST reads open because a headless CMS's content is meant to be
    read, and a list of email addresses is not content.
  - **`/api/users`, not `/users`.** The latter is the Users _page_, and the client router owns every
    path under `basePath` that isn't a file; a data route there answers the browser's page request
    with JSON. (Caught exactly that way, by loading the page.)
    The screens appear when the host's auth offers user administration — `app.auth` carries `users`,
    so passing it is enough — and `auth.users: false` leaves them out. **Whoever may use the admin may
    mint an account**, which with the default `authorize` means minting an administrator.
- **lib/users/UserForm.svelte** — the account form. Not `RecordForm`, though it renders the same
  controls from the same schema: a user carries one thing no record does, a credential that is
  written and never read back. The box is empty even when a password is set, and empty means
  "unchanged" (on edit) or "no password yet, sign-in is federated only" (on create) — never `""`.
- **lib/lists/filters.ts** — which fields a list can be filtered by, and the whole round trip
  between a URL, the filter form and the store's `Where`. The operators are chosen per field type —
  `contains` on prose, the six comparisons on a number, `eq` on a closed set — and a multi-valued
  field gets none, since every operator compares against a single value and a filter on a stored
  list would quietly match nothing. `isValidFilter` is the one gate: a hand-edited URL, an empty box
  and a select left on "todos" all fail it and are dropped rather than queried with, because the
  store would answer `readingMinutes = "abc"` with an empty list an author reads as "no records".
  Composed from `@shuri/validate` (`object`/`oneOf`/`refine`), like every other schema-shaped check
  in the repo.
- **lib/lists/ListFilters.svelte** — the applied filters as chips, and the panel that edits them.
  The panel is a real `<form>` and its controls are uncontrolled: what the author types lives in the
  DOM until submit, so there is no draft state to keep in sync with the URL and no navigation can
  reset a half-typed filter. Applying is one gesture for the whole panel — several filters usually
  change together, and applying each on change would be a page load per keystroke. A chip's `×` is
  the exception, and immediate: it acts on what is filtered right now, not on a draft.
- **routes/collections/[slug]/+page.ts** — asks for `PAGE_SIZE + 1` records and shows `PAGE_SIZE`:
  the REST list route answers with records and no total, so the extra record is how the pager learns
  a next page exists without a second round trip. Sort, filters and page live in the URL — one param
  per filter, spelling out its operator (`?f.title=contains:svelte`), so a narrowed list is a link
  that can be shared and edited by hand.

## Build and mount

```
pnpm --filter @shuri/ui build       # vite build -> build/, then tsgo -> dist/
```

```ts
import { create } from "@shuri/sdk";
import { createAdminHandler } from "@shuri/ui";

const app = create({
  collections,
  globals,
  adapter,
  handlers: [createAdminHandler({ collections, globals })],
});
```

Behind a login, `handlers` becomes a function — the `AuthApi` cannot exist before the store does, so
it has to be received rather than passed in:

```ts
const app = create({
  collections,
  globals,
  adapter,
  auth: { cookie: { secure: true } },
  handlers: ({ auth }) => [
    createAdminHandler(
      { collections, globals },
      {
        auth: {
          auth,
          // Who counts as an editor. Without it, any session is one.
          authorize: (session) => session.user["role"] === "editor",
          // Optional: close reads as well, giving up a publicly readable API.
          // protect: everythingUnderApi({ collections: "/collections", globals: "/globals", events: "/events" }),
        },
      },
    ),
  ],
});
```

`basePath` defaults to `/admin` **in two places at once**: this handler, and the client bundle,
which bakes it in at build time (`svelte.config.js`). One `index.html` has to work at every depth of
the client router, so its asset URLs are root-absolute and cannot be relocated after the fact. To
serve the admin elsewhere, rebuild with `SHURI_ADMIN_BASE` set to the same value you pass here.

For development against a running app, `pnpm --filter @shuri/ui dev` serves the SPA on Vite and
proxies the REST routes to `SHURI_API_ORIGIN` (default `http://localhost:3000`, i.e. `@shuri/demo`).

## Embedding the components

```svelte
<script lang="ts">
  import "@shuri/ui/admin.css";
  import { RecordForm, RecordTable, createAdminClient } from "@shuri/ui/components";
</script>
```

The components are exported from source, compiled by the consumer's own Vite — the export condition
is `svelte`. They are generic over a schema, so they need a `fields` array and (for relations) the
options loaded by `loadRelationOptions`; none of them reaches for a global or a context.

## Testing

The `.svelte` files carry no logic worth a unit test, so the visual work is checked by running the
admin: `pnpm --filter @shuri/ui build`, then the demo (`pnpm demo`), then `/admin`.

`vitest` covers the server side and every plain-TypeScript helper under `lib/` — `values.ts`,
`columns.ts`, `nav.ts`, `relations.ts` — which is where the schema-to-UI decisions actually live.
The `.svelte` files are checked by `svelte-check`, which the `typecheck` script runs alongside
`tsgo`. It needs both TypeScript 6 and 7 present (the repo is on 7), which is why this package
declares `typescript@~6` and `@typescript/native` and runs `svelte-check --tsgo`.

## Deliberately absent

- **Roles.** `authorize` is a predicate the host writes, not a permission model. There are no
  per-collection or per-field rules: a user who may use the admin may edit everything in it.
- **Signup, password reset and email verification from the admin.** The admin creates the _first_
  account through setup, then only signs in and out; every later account is the auth
  implementation's own business.
- **Undoing setup.** Nothing re-opens the window except the host's `required()` going true again
  (normally: the users table becoming empty). There is no "reset admin" route, on purpose.
- **Read protection by default.** See `protect.ts` — `everythingUnderApi` is one line away, but the
  default leaves the REST reads exactly as open as they were before the admin existed.
- **Live updates.** The schema advertises `api.events`, and `@shuri/api` streams every change over
  SSE, but no screen subscribes yet: a list is what it was when it loaded.
- **Full-text search.** A list filters field by field, one `FilterOp` each, because that is what
  `Where` expresses. There is no box that searches every field at once, and no `between`: two bounds
  on one field are two filters `Where` has nowhere to put.
- **Uploads and rich text.** `@shuri/core` declares neither a `file` nor a `richText` field, so
  there is nothing here to render for them.
- **A dark theme.** See `admin.css`: the design is one light palette.
- **Roles on the Users screens.** Accounts can be created, edited and deleted, but there is nothing
  to grant: `authorize` is the host's predicate, not a stored role, so every account the screens
  create is as privileged as `authorize` says it is. Deleting your own account is refused (it would
  sign you out mid-request, and on a one-address `authorize` it locks the admin for good).
- **A date column on the Users list.** `users.createdAt` is left out of the advertised collection:
  it is stored as epoch milliseconds and `@shuri/core` has no `date` field type, so a column would
  print `1788733871182` and a filter would ask an author to type one.
- **Appearance settings.** The design mock has a screen for it; the theme is four CSS variables an
  embedding app can already override.

## Role in the monorepo

Depends on `@shuri/core` (the schema and its visibility rules), `@shuri/api` (`FallingHandler`,
`ApiError`), `@shuri/auth` (`AuthSession`/`AuthUser` and `UnauthenticatedError` — types and one error
class, never `createAuth`), and `@shuri/store`/`@shuri/validate` for the `Query` and `Issue` types the
browser client speaks. It is
a **leaf**: nothing depends on it, and `@shuri/sdk` in particular does not — the admin arrives
through `create({ handlers })`, which is how any handler outside the core toolkit gets mounted, so
an app that wants no admin pays nothing for it. `@shuri/demo` mounts it at `/admin`.
