# @shuri/migrate

Schema migrations for Shuri: snapshot of the persisted schema, diff to ops, JSON migration files
organised as a `parent` DAG with automatic reconciliation, a runner with journal/lock/checksum, and a
CLI. The design lives in `docs/plans/migrate.md`. The package, its one driver (`@shuri/store-memory`, a
reference/debug driver), the `@shuri/sdk` `resolveSchema` entry and the demo wiring are all in place; the
relational `@shuri/store-d1` driver is the next plan (F10) and starts from the SQLite spike under `src/test/`.

## Tree

```
package.json         exports ".", "./node", "./testing"; bin shuri-migrate -> bin/shuri-migrate.js
bin/shuri-migrate.js  shim: `#!/usr/bin/env node` + dynamic import of dist/node/cli-main.js
.oxlintrc.json        base + `no-restricted-imports` banning `node:*` outside src/node/** and tests
src/
  index.ts             core entry (runs in Workers); re-exports everything below
  errors.ts             CanonicalJsonError, ReplayError (+ ReplayErrorReason), DiffHintError (+ DiffHintReason),
                         MigrationFileError, InvalidMigrationNameError, GraphError, MultipleHeadsError,
                         ReconcileConflictError, FrozenDivergenceError
  errors/runner.ts       SchemaDriftError, PendingMigrationsError, DriverLimitError, MigrationLockedError,
                         LockLostError, DestructiveMigrationError, ChecksumMismatchError,
                         UnknownAppliedMigrationError, OutOfOrderConflictError
  schema/
    canonical-json.ts    deterministic JSON (sorted keys, strict about what it accepts)
    names.ts              SLUG_PATTERN / FIELD_PATTERN, `id` reserved
    snapshot.ts            FieldSpec/FieldShape/SchemaSnapshot, snapshotOf(ResolvedSchema), snapshotsEqual
    integrity.ts            checkIntegrity: dangling relations, indexed globals
    validator.ts            fieldSpecValidator, snapshotValidator, validateSnapshot (only @shuri/validate combinators)
  ops/
    types.ts               MigrationOp (8 ops), TargetRef
    validator.ts            migrationOpValidator (what a migration file's `ops` are checked with)
    state.ts                ReplayState = snapshot + lineage + tombstones; statesEquivalent
    replay.ts                applyOp / applyMigration / replay (ensure semantics); apply-entity.ts,
                              apply-field.ts, apply-shared.ts hold the per-op rules
    conversion.ts            conversionOf (identical/lossless/lossy), isDestructive
    convert-value.ts         convertValue: the per-value rule of the conversion matrix
    footprint.ts              reads/writes per op, only to label conflicts
    diff.ts                   diff(prev, next, hints): ops that take one snapshot to the other; warnings
    diff-hints.ts              RenameHints, hint validation (duplicate/cycle/missing) and topological order
    diff-fields.ts             per-entity field ops in the fixed order, plus possible-rename warnings
    test-support.ts           op builders and `snap(...ops)` shared by the tests
  migration/
    types.ts               MigrationFile, MIGRATION_FORMAT, MIGRATION_ID_PATTERN
    id.ts                   slugifyName, newMigrationId(name, now, random4hex), compareIds
    validator.ts             migrationFileValidator (composes migrationOpValidator), parseMigration(json, source)
    checksum.ts              checksumOf: sha256 of canonicalJson({format, id, ops}), never `parent`
    serialize.ts             serializeMigration: fixed key order, 2 spaces, trailing newline
    bundle.ts                parseBundle: validates a generated `migrations/index.ts` export into MigrationFile[]
    test-support.ts          `mig(id, parent, ops)` and `idAt(n)` builders for tests
  graph/
    graph.ts                 buildGraph (duplicate / unknown-parent / cycle), lca, linearChain
    commute.ts               branchesCommute: replays both orders, compares states with lineage
    reconcile.ts             planReconcile (pure plan of `parent` rewrites + chain), applyRewrites
    format-conflict.ts       describeOp, formatConflict (text of ReconcileConflictError.format())
  driver/
    types.ts                 the MigrationDriver port: capabilities, lock, journal, plan/execute/render;
                              Migratable and isMigratable (what an adapter exposes as `migrations`)
    memory-journal.ts         createMemoryJournal: in-memory TTL lock + journal (memory driver, test fake)
  runner/
    plan.ts                  planMigration/planSequence: ops with effect + dependents, before/after states
                              in the database's REAL order; realOrderOf, dependentsOf
    order.ts                 findOrderConflict: does the real order end where the chain does?
    status.ts                migrationStatus, inspect (journal vs files), assertTrustworthy
    up.ts                    migrateUp: drift/limits, lock + heartbeat, destructive approval, dry run
    assert.ts                assertMigrated: fail-closed boot check, no lock, no writes
  test/
    two-devs.test.ts         integration: plan section 15 scenarios 1-12 (graph part)
    out-of-order.test.ts      integration: scenarios 13-15 (out-of-order, checksum, lock) over the fake driver
    sqlite-spike-driver.ts     F5 spike: throwaway node:sqlite driver (createEntity/addField/alterField as
                              table rebuilds in one transaction); stays until F10 (`@shuri/store-d1`)
    sqlite-spike.test.ts      the spike through the real runner
    cli-support.ts            harness: temp project + fake store + deterministic clock, drives runCli in-process
    cli-generate/reconcile/up/admin/check/frozen.test.ts   integration: every CLI command and exit code
  node/                  Node-only entry (`@shuri/migrate/node`); the only place `node:*` is allowed
    index.ts               exports bundle, cli, config, dir, errors, failure, git
    dir.ts                  fsMigrationsDir: list (one aggregated error for every invalid file) / write
    config.ts               MigrateConfig, defineMigrateConfig, loadConfig (native `import()` of shuri.migrate.ts)
    git.ts                  frozenIdsAt(ref, dir): ids of the migrations a git ref already has
    bundle.ts               bundleSource / bundleState / writeBundle for `<dir>/index.ts`
    project.ts              openProject: config + resolved paths + lazy schema/adapter/git
    cli.ts                  runCli(argv, io, deps): in-process, returns the exit code; help, --json envelope
    cli-args.ts             node:util parseArgs wrapper (strict; usage errors -> exit 2)
    cli-main.ts             process entry behind bin/shuri-migrate.js (real stdout/stderr/TTY prompt)
    errors.ts               CliError (exit + next command), CliUsageError, MigrateConfigError, MigrationsDirError, GitRefError
    failure.ts              describeFailure: error -> exit code (plan section 13), JSON-safe details, next command
    commands/               one file per command: generate, reconcile, status, check, up, baseline, unlock,
                            journal (mark-applied, unmark, repair-checksum), render, bundle; index.ts is the registry
  testing/index.ts        describeMigrationDriverContract + CONVERSION_CASES, schemaFromSnapshot, createFakeStore, builders (collection, createEntity, chainOf, collectionAfter, ...)
  testing/contract-*.ts   the suite: ops on real data, lock, journal, crash at every step and re-run; `ContractHarness.unsupportedOps` lets a driver land in stages (the suite skips what needs those ops)
  testing/fake-driver.ts  reference driver (atomic or not) that passes the contract; fake-data.ts holds its ops
  lint-boundary.test.ts    proves the `node:*` ban works by linting fixture files with oxlint
```

## What each part does

- **Core (`src/**` except `node/`)** is portable: it must not import `node:*` (decision D11). Lint
  enforces it; test files and `src/**/test/**` are exempt because they run under Node only.
- **Snapshot** is what the migrations track of a schema: entity slugs and, per field, type, `kind`
  (numbers), `multiple` (select/relation), relation target and `index`. Constraints (`required`,
  `options`, `min`/`max`, ...) are not persisted by any v1 driver and are ignored.
- **Replay and lineage.** Ops have `ensure` semantics (an op whose target state already holds is a
  no-op). Each entity/field carries a _lineage_ that survives renames and is minted again after a
  drop, so `rename a->b` and `drop a + add b` end in equal schemas but non-equivalent states; that is
  what lets two parallel branches be told apart. Referential integrity is checked once at the end of
  a migration, so mutually-referencing collections can be created or dropped together.
- **Conversions.** `conversionOf` classifies a shape change and `convertValue` is the per-value rule;
  both are the specification each driver implements, and `CONVERSION_CASES` (from `./testing`) is that
  specification as data. Conversions are deterministic and idempotent: a driver that crashed halfway
  re-runs them over rows already converted.
- **Diff.** `diff(prev, next, hints)` never infers a rename: only explicit hints produce
  `renameEntity`/`renameField` (field hints name the entity by its NEW slug). Renames are validated
  (cycles such as a<->b are rejected, chains such as `b->c`, `a->b` are ordered) and applied to `prev`
  first so relations follow. An unhinted drop+add of the same shape yields a `possible-rename` warning.
  Invariant, checked by table and seeded fuzz tests: replaying the ops over `prev` gives `next`.
- **Migration files** are JSON (`migrations/<id>.json`); the id is `YYYYMMDDTHHMMSSmmmZ_<4 hex>_<name>`
  so lexical order follows creation time, and `parseMigration` requires it to equal the file name. The
  checksum leaves out `parent` on purpose: reconciliation only rewrites `parent`, so a rebased
  migration keeps the checksum already recorded in databases where it ran.
- **Graph.** Migrations form a forest through `parent`; several roots count as branches of a virtual
  root (`lca` returns `null` for them). `buildGraph` rejects duplicates, unknown parents and cycles
  (reporting every offender); `linearChain` is the application order and throws `MultipleHeadsError`
  until the branches are reconciled.
- **Commutation.** `branchesCommute(base, a, b)` replays `a++b` and `b++a` over the whole branches; they
  commute iff neither order throws and both end in equivalent states (schema and lineage). Footprints
  only label the conflict (op pairs that touch the same resource); they never decide.
- **Reconcile.** `planReconcile(files, {frozen})` is pure and returns the `parent` rewrites plus the
  linear chain. Each round picks the two heads with the deepest common ancestor (ties: lexical order of
  the first exclusive ids), keeps the frozen branch in place (or the one with the smaller first id) and
  rebases the other on its head if the two commute; otherwise `ReconcileConflictError` (first
  conflicting pair), or `FrozenDivergenceError` when both are frozen. Only `parent` changes, so
  checksums stay valid. The result depends on the set of files and `frozen`, never on read order.
- **Driver port.** A `MigrationDriver` plans and executes a `PlannedMigration` (its ops with `effect`
  `applied`/`noop`, the `dependents` of each op's target, and the schema before/after in the database's
  real order). Atomic drivers run ops and journal in one unit; others write a `running` journal entry
  first, assert the lock before each op, make every op idempotent over partial data and write `done`
  last. Re-running a `running` migration re-executes all its ops. Adapters expose it as `adapter.migrations`.
- **Runner.** `migrateUp`: linear chain -> schema drift -> driver limits -> lock (with optional wait, and a
  heartbeat every ttl/3) -> re-read the journal under the lock -> unknown/edited migrations and
  out-of-order safety -> plan over the REAL order -> destructive approval by migration id (before
  touching anything; skipped in `dryRun`, which shows the destructive steps instead) -> plan+execute each.
  `assertMigrated` is the production boot check: same inspection, no lock, throws `PendingMigrationsError`.
- **Out of order.** A pending migration that sits before an applied one in the chain (a branch merged late)
  runs after it, provided the real order ends in the same schema and lineage as the chain; otherwise
  `OutOfOrderConflictError`. The journal keeps the real order.
- **`./node` (CLI).** `shuri-migrate <command>`; every command takes `--config`, `--dir`, `--json`.
  `generate <name>` reconciles first (unless `--no-reconcile`), diffs the schema in code against the chain
  and writes the file plus the bundle (renames only through `--rename-entity kind:from=to` /
  `--rename-field kind:slug.from=to`, slug = the NEW one). `reconcile`, `status`, `check` (no database:
  parse, one head, replay, no drift, driver limits, bundle current), `up`, `baseline`, `unlock`,
  `mark-applied` / `unmark` / `repair-checksum` (ask for confirmation; `--yes` without a terminal),
  `render`, `bundle`. Exit codes: 0 ok, 1 error, 2 usage, 3 conflict / several heads, 4 pending or
  drift, 5 locked, 6 destructive approval needed, 7 checksum mismatch or unknown applied migration.
  Every error message ends with the command to run next; `--json` answers
  `{ version: 1, command, ok, result?, error? }` on stdout. The config file is loaded with Node's native
  `import()` (>= 22.18): erasable TypeScript syntax and `.ts` imports only, and workspace packages
  resolve to their `dist`, so `pnpm build` comes first. `frozenRef` is read from git only when there are
  branches to reconcile. The bundle (`<dir>/index.ts`) is generated and gitignored; apps run
  `shuri-migrate bundle` in `prebuild`/`pretypecheck` and load it with `parseBundle`.
- **`./testing`** exports the contract suite every `MigrationDriver` must pass
  (`describeMigrationDriverContract(name, { make })`), the conversion cases, `schemaFromSnapshot` and a
  fake store. Failures are armed with `injectFailure(afterStep)`; the suite crashes after every step and
  re-runs. Importing it needs vitest.
- **`bin/`** is a committed JS shim so the bin exists before `dist` does.

## Production workflow

The decision of _when_ to migrate belongs to the app; `create()` stays synchronous and never migrates.

- **Node + an adapter with a migration driver.** A deploy job in CI runs `shuri-migrate check` (no database: parse, one head, replay,
  no drift, driver limits, bundle current), then `shuri-migrate up --allow-destructive <ids approved in
the PR>` against the production database, and only then ships the app. The app boots with
  `assertMigrated({ files, driver: adapter.migrations, schema: resolveSchema(appConfig) })`, which fails
  closed (pending or `running` migrations, drift, an edited or unknown applied migration) and takes no
  lock. Use `up --dry-run` first to see destructive steps and `estimatedRows`.
- **Dev / memory.** The app calls `migrateUp({ files, driver, schema })` before seeding (the demo does). The
  memory driver is a reference/debug driver: its state resets on every boot, so production never needs it.
- **Migrations are optional per adapter.** `Migratable` (`adapter.migrations`) is separate from `StoreAdapter`;
  an adapter without it is valid (`isMigratable` is false). Commands that touch a database then fail with a
  clear `CliError`, and `check` still runs without one. `@shuri/store-mongo` has no driver: MongoDB is
  schemaless, so adding or dropping fields needs no migration, and renames and type changes are handled
  manually for now.
- **Workers + D1 (F10, not built yet).** Either `shuri-migrate render <id>` produces the SQL for
  `wrangler d1 migrations apply`, or a protected endpoint calls `migrateUp` with the bundle.
  `assertMigrated` would run once per isolate and be memoised.
- **Adopting an existing database.** `shuri-migrate check`, then `generate init` (creates everything),
  then `baseline` (journals the chain without running it; the journal must be empty).
- **Branches.** Set `frozenRef` (for example `origin/main`) in `shuri.migrate.ts`: migrations already on
  that ref are never rebased, so production never sees its order rewritten. Without it a production
  branch could be rebased; the real-order check in `migrateUp` still keeps the database safe, and
  `check` should be run in CI with the ref configured.
- **Recovery.** `unlock --force` (a crashed holder), `repair-checksum <id>` (a migration file edited on
  purpose after it ran), `mark-applied` / `unmark` (manual journal fixes), and re-running `up` (a
  migration left `running` by a crash re-executes all its ops, which are idempotent).
- **Upgrading better-auth or changing its options** changes the effective schema, so the next
  `check` reports drift: run `shuri-migrate generate <name>` and commit the new file.

## Role in the monorepo

Depends only on `@shuri/core` and `@shuri/validate`. Adapters that support migrations (today only `store-memory`) depend on
this package for the `MigrationDriver` port; this package never depends on `@shuri/store` or an
adapter.

## Deviations from the plan

Recorded in `docs/plans/migrate.md` section 18:

- `SLUG_PATTERN` is `/^[a-z][A-Za-z0-9_-]{0,62}$/` (uppercase after the first character) because the demo
  already ships the global `seoDefaults`; the plan says to relax the pattern rather than rename.
- `ReplayError` has the reason `global-index` (an indexed global field) next to `dangling-relation`.
- `MigrationDriver.lockInfo()` is required on the port (`up`, `status` and `unlock` read the holder from it).
- `baseline` has no introspection: it only requires an empty journal and journals the chain.
- `RenameCollisionError` lives here, so every driver reports a rename that would overwrite data the same way.
- The Mongo driver was removed (see "Production workflow").
