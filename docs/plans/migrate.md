# Plano técnico — `@shuri/migrate` (v2, pronto para execução)

> **Status:** revisado por 3 exploradores (contratos do repo; adapters/sdk; prior art Alembic/Django/Atlas/Prisma/Drizzle/Flyway + D1/Mongo) e 3 críticos (algoritmos; encaixe no código; operação/drivers). As críticas incorporadas estão marcadas com **[C]** no texto.
>
> **Pré-requisito do** `@shuri/store-d1` relacional (plano seguinte, F10).

> **Atualização pós-implementação (F0–F9):** o driver do Mongo foi **removido** (decisão do dono do produto); o driver do memory ficou como driver de **referência/debug**; migração é **opcional por adapter**. As seções abaixo foram ajustadas, e os desvios em relação ao plano original estão no fim, em "18. Decisões pós-implementação e desvios".

---

## 0. Escopo

**Entra no v1:**

- snapshot do schema persistente;
- diff → ops;
- migrações em JSON, organizadas como DAG `parent`, com **reconciliação automática** de ramos paralelos;
- runner com journal, lock com heartbeat/fencing, checksum e aplicação fora de ordem verificada;
- driver do memory (referência/debug; o do Mongo foi removido, ver §18);
- CLI;
- baseline e comandos de recuperação;
- `resolveSchema` (em core/sdk);
- 2 combinators no `@shuri/validate`;
- CI.

**Fica fora do v1** (com o motivo):

| Item                                                     | Por que fica fora                                                                                    |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Migração de dados com código arbitrário (`data()`)       | Não dá para verificar comutação, e quebra a atomicidade do batch no D1                               |
| down/rollback                                            | —                                                                                                    |
| squash                                                   | —                                                                                                    |
| Driver D1                                                | Vem no plano seguinte, mas o port já nasce dimensionado para ele (§7)                                |
| `required`, `options` de select, `min`/`max` no snapshot | Nenhum driver v1 persiste constraints; entram num `SNAPSHOT_VERSION` 2 se o D1 adotar NOT NULL/CHECK |

## 1. Decisões fechadas

| #   | Decisão                                                                                                                                                                                 | Motivo                                                                                                                               |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | Arquivo de migração em **JSON**: `migrations/<id>.json`                                                                                                                                 | Declarativo, validável com `@shuri/validate`, reescrita determinística, importável em Workers                                        |
| D2  | id `YYYYMMDDTHHMMSSmmmZ_<4 hex>_<nome>`                                                                                                                                                 | Colisão desprezível; ordem lexical ≈ temporal. Clock skew entre devs só muda quem é "mais antigo", sem afetar o determinismo **[C]** |
| D3  | Ordem = cadeia `parent`, **linear depois da reconciliação**, sem merge nodes                                                                                                            | O rebase reescreve só `parent`                                                                                                       |
| D4  | O snapshot **nunca é commitado**: estado = `replay(cadeia)`                                                                                                                             | Lição do Drizzle: snapshot/journal central atrai conflito de merge                                                                   |
| D5  | Checksum = SHA-256 de `canonicalJson({format, id, ops})`; **exclui `parent`** **[C]**                                                                                                   | O rebase não invalida bancos onde a migração já rodou                                                                                |
| D6  | Ops com semântica **ensure** (no-op quando o estado-alvo idêntico já existe) **e linhagem** (§4) **[C]**                                                                                | Ops idênticas comutam; rename vs drop+add **não** comutam                                                                            |
| D7  | Rename nunca inferido; só via dica explícita                                                                                                                                            | Heurística errada = perda de dados                                                                                                   |
| D8  | Ops destrutivas exigem aprovação **por id** de migração **[C]**                                                                                                                         | Segurança                                                                                                                            |
| D9  | Reconciliação determinística; migrações **congeladas** (já em `frozenRef`) nunca são rebaseadas **[C]**                                                                                 | Os dois devs chegam ao mesmo resultado, e produção não tem a ordem reescrita                                                         |
| D10 | O port `MigrationDriver` mora em `@shuri/migrate`; os adapters expõem `adapter.migrations`; `migrate` **não depende** de `@shuri/store` nem de nenhum adapter (nem como devDep) **[C]** | Sem ciclo no grafo pnpm/turbo                                                                                                        |
| D11 | O núcleo de `migrate` não usa `node:*` (só `src/node/**`), garantido por lint **[C]**                                                                                                   | O runner roda em Workers                                                                                                             |
| D12 | Toda conversão de valor é **idempotente** e **expressável em SQL puro** sobre a linha antiga **[C]**                                                                                    | Recuperação de crash no Mongo; rebuild de tabela no D1                                                                               |

## 2. Pacotes afetados e grafo

| Pacote                  | Mudança                                                                                                                      |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `@shuri/validate`       | + `discriminated` (arquivo `src/discriminated.ts`); `record` ganha `options.key`; `arrayOf` ganha `options.min` **[C]**      |
| `@shuri/core`           | + tipo `ResolvedSchema`; slugs de collection/global não podem começar com `_`, e nome de campo `id` é reservado **[C]**      |
| `@shuri/migrate` (novo) | núcleo + `./node` (CLI) + `./testing` (suíte de contrato)                                                                    |
| `@shuri/sdk`            | + `resolveSchema(config)`, que valida via `createCore`; `create()` reutiliza o core resultante **[C]**                       |
| `@shuri/store-memory`   | estado extraído para `tables.ts`; `migrations.ts` (driver); `MemoryAdapter`; memo de índice por identidade de schema **[C]** |
| `@shuri/store-mongo`    | **sem mudanças**: o driver de migração do Mongo foi removido (§18)                                                           |
| `demo`                  | extrai `src/app-config.ts`; `shuri.migrate.ts`; `migrateUp` antes do seed **[C]**                                            |
| raiz                    | `engines.node >=22.18`; `.github/workflows/ci.yml` (desde F0) **[C]**                                                        |

Grafo de dependências:

- `migrate` depende de `core` e `validate`;
- `store-memory` depende de `migrate`; `store-mongo` não depende (migração é opcional por adapter, §18);
- `sdk` e `store` não mudam de dependências.

## 3. Entidades do schema (`migrate/src/schema/`)

### 3.1 `canonical-json.ts`

```ts
/** JSON determinístico: chaves de objeto ordenadas por code point; sem espaços; propriedades `undefined` omitidas; `undefined` em array → erro; números via JSON.stringify (NaN/Infinity → erro); só objetos plain e arrays (outro protótipo → erro). */
export function canonicalJson(value: unknown): string;
export class CanonicalJsonError extends Error {
  readonly path: string;
}
```

### 3.2 `snapshot.ts`

```ts
export const SNAPSHOT_VERSION = 1;

export type FieldSpec =
  | { type: "text" | "textarea" | "email" | "boolean"; index: boolean }
  | { type: "number"; kind: NumberKind; index: boolean }
  | { type: "select"; multiple: boolean; index: boolean }
  | { type: "relation"; collection: string; multiple: boolean; index: boolean };

export type FieldShape = DistributiveOmit<FieldSpec, "index">; // spec sem índice

export interface EntitySnapshot {
  fields: Record<string, FieldSpec>;
}
export interface SchemaSnapshot {
  version: typeof SNAPSHOT_VERSION;
  collections: Record<string, EntitySnapshot>;
  globals: Record<string, EntitySnapshot>;
}
export const EMPTY_SNAPSHOT: SchemaSnapshot;

export function fieldSpecOf(field: Field): FieldSpec; // defaults: multiple=false, index=false
export function shapeOf(spec: FieldSpec): FieldShape;
export function snapshotOf(schema: ResolvedSchema): SchemaSnapshot; // ignora label, hidden, access, hooks, title, singular, plural, orderable, internal, category, required, options, min, max, sign, minLength, maxLength
export function snapshotsEqual(a: SchemaSnapshot, b: SchemaSnapshot): boolean;
```

- `ResolvedSchema` vem de `@shuri/core`: `{ collections: readonly CollectionSchema[]; globals: readonly GlobalSchema[] }`.
- `migrate` depende de `core`, então não há duplicação.
- `index: true` em campo de global é **erro de validação do snapshot** **[C]**, porque global não tem índice.
- Global não pode ser alvo de relation (o core já garante: `relation.collection` precisa ser uma collection).

### 3.3 Gramática de nomes (`schema/names.ts`)

```ts
export const SLUG_PATTERN = /^[a-z][a-z0-9_-]{0,62}$/; // collection/global
export const FIELD_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,62}$/; // campo; "id" reservado
```

- Os padrões são verificados no snapshot e no arquivo de migração.
- O core ganha a regra de prefixo `_` reservado e de `id` reservado.
- **Antes de fixar os padrões**, verificar slugs e campos existentes em demo, benchmarking e better-auth (por exemplo `emailVerified`, `userId`). Se algum não casar, relaxar o padrão e não renomear.

## 4. Ops, estado de replay e linhagem (`migrate/src/ops/`)

### 4.1 `types.ts`

```ts
export type TargetKind = "collection" | "global";
export interface TargetRef {
  kind: TargetKind;
  slug: string;
}

export type MigrationOp =
  | { op: "createEntity"; target: TargetRef; fields: Record<string, FieldSpec> }
  | { op: "dropEntity"; target: TargetRef }
  | { op: "renameEntity"; target: TargetRef; to: string }
  | { op: "addField"; target: TargetRef; name: string; spec: FieldSpec }
  | { op: "dropField"; target: TargetRef; name: string }
  | { op: "renameField"; target: TargetRef; from: string; to: string }
  | {
      op: "alterField";
      target: TargetRef;
      name: string;
      from: FieldShape;
      to: FieldShape;
    }
  | { op: "setIndex"; target: TargetRef; name: string; index: boolean };
export type OpName = MigrationOp["op"];
```

`alterField` usa `FieldShape`, sem `index` **[C]**, para não haver conflito espúrio com `setIndex`.

### 4.2 `state.ts`: estado de replay com linhagem **[C bloqueador #1]**

```ts
export type Lineage = string;
export interface ReplayState {
  snapshot: SchemaSnapshot;
  lineage: {
    entities: Record<string, Lineage>; // chave "<kind>:<slug>"
    fields: Record<string, Lineage>; // chave "<kind>:<slug>.<name>"
  };
  tombstones: Record<string, Lineage>; // slot → última linhagem removida (por drop)
}
export const EMPTY_STATE: ReplayState;
export function statesEquivalent(a: ReplayState, b: ReplayState): boolean; // snapshot + lineage (não compara tombstones)
```

Regras de linhagem:

- **Linhagem cunhada:** `create`/`add` em um slot cunha `"<slot>@<tombstone do slot ou '-'>"`. É determinística e independente do id da migração, então dois ramos que adicionam o mesmo campo cunham a mesma linhagem.
- **Rename:** preserva a linhagem e move-a para o novo slot. Não deixa tombstone na origem.
- **Drop:** remove a linhagem e grava o tombstone do slot.
- **renameEntity:** move junto as linhagens de todos os campos da entidade.

Contraexemplo que isso resolve:

- base `{a: L0}`; A = `renameField a→b`; B = `dropField a` + `addField b` com o mesmo spec;
- A+B termina com `b: L0`; B+A termina com `b: "…b@-"`;
- os estados **não** são equivalentes, logo há **conflito**. Sem linhagem, a comparação aceitaria o par e o ambiente que aplicasse B primeiro perderia dados.

### 4.3 `replay.ts`

```ts
export type OpEffect = "applied" | "noop";
export interface OpResult {
  state: ReplayState;
  effect: OpEffect;
}
export function applyOp(state: ReplayState, op: MigrationOp): OpResult; // puro; lança ReplayError
export function applyMigration(
  state: ReplayState,
  ops: readonly MigrationOp[],
): { state: ReplayState; effects: OpEffect[] }; // + checkIntegrity no FIM
export function replay(
  migrations: Iterable<{ ops: readonly MigrationOp[] }>,
  base?: ReplayState,
): ReplayState;
export function checkIntegrity(snapshot: SchemaSnapshot): string[]; // relations penduradas, índice em global
export class ReplayError extends Error {
  readonly op: MigrationOp;
  readonly reason: ReplayErrorReason;
}
export type ReplayErrorReason =
  | "entity-missing"
  | "entity-exists-different"
  | "field-missing"
  | "field-exists-different"
  | "rename-both-exist"
  | "rename-neither-exists"
  | "alter-shape-mismatch"
  | "dangling-relation";
```

A integridade referencial é verificada **ao fim de cada migração**, não a cada op **[C bloqueador #2]**. Isso permite relations mútuas e o drop de coleções que se referenciam.

Tabela de semântica ensure:

| op           | Efeito `applied`                                                            | `noop`                                   | Erro                                 |
| ------------ | --------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------ |
| createEntity | não existe                                                                  | existe com fields idênticos              | existe diferente                     |
| dropEntity   | existe                                                                      | não existe                               | —                                    |
| renameEntity | origem existe e destino não; reescreve todo `relation.collection` == origem | origem não existe e destino existe       | os dois existem; nenhum existe       |
| addField     | campo ausente                                                               | presente idêntico (spec completo)        | entidade ausente; presente diferente |
| dropField    | presente                                                                    | ausente (entidade ausente também é noop) | —                                    |
| renameField  | igual a renameEntity, por campo                                             | igual                                    | igual                                |
| alterField   | `shapeOf(campo)==from` → `to` (o index é preservado)                        | `shapeOf(campo)==to`                     | campo ausente; outro shape           |
| setIndex     | valor diferente                                                             | valor igual **[C]**                      | campo ausente                        |

Por que drop de algo ausente é noop e rename sem origem nem destino é erro: o drop expressa um estado final ("não existe"), que já está satisfeito. O rename sem nenhum dos dois indica uma história incoerente.

### 4.4 `conversion.ts` **[C]**

```ts
export type Conversion = "identical" | "lossless" | "lossy";
export function conversionOf(from: FieldShape, to: FieldShape): Conversion;
export function isDestructive(op: MigrationOp): boolean; // dropEntity, dropField, alterField lossy
```

| from → to                              | Conversion | Regra de valor (idempotente: só converte quando o valor tem o tipo de origem)            |
| -------------------------------------- | ---------- | ---------------------------------------------------------------------------------------- |
| text ↔ textarea; email → text/textarea | lossless   | inalterado                                                                               |
| text/textarea → email                  | lossy      | string que não casa com o regex de email vira ausente                                    |
| number integer → float                 | lossless   | inalterado                                                                               |
| number float → integer                 | lossy      | número não inteiro → `trunc`; não-número inalterado                                      |
| number/boolean → text/textarea         | lossless   | número/boolean → `String(v)`; string inalterada                                          |
| text/textarea → number                 | lossy      | string numérica → número (inteiro: só se inteiro, senão ausente); outra string → ausente |
| text/textarea → boolean                | lossy      | `"true"`/`"false"` → boolean; outra string → ausente                                     |
| select → text/textarea                 | lossless   | inalterado                                                                               |
| text/textarea → select                 | lossy      | inalterado (as options não estão no snapshot)                                            |
| X single → X multiple                  | lossless   | escalar → `[v]`; array inalterado                                                        |
| X multiple → X single                  | lossy      | array → `v[0]` (vazio → ausente); escalar inalterado                                     |
| relation(A) → relation(B)              | lossy      | inalterado (ids podem não existir em B; a integridade é responsabilidade da app)         |
| demais pares                           | lossy      | valor → ausente                                                                          |

```ts
// convert-value.ts
/** `undefined` = remover a chave. Propriedades: idempotente (convert(convert(v)) == convert(v)) e determinístico. */
export function convertValue(value: unknown, from: FieldShape, to: FieldShape): unknown;
```

A matriz é a **especificação**: memory a implementa via `convertValue`, Mongo via pipeline com guards de `$type`/`$isArray`, e o D1 via `CASE`/`CAST`/`json_*`. A suíte de contrato roda os mesmos casos em todos os drivers.

### 4.5 `footprint.ts` (só diagnóstico)

```ts
export interface Footprint {
  reads: ReadonlySet<string>;
  writes: ReadonlySet<string>;
}
export function footprint(op: MigrationOp): Footprint;
```

Chaves:

- `e:<kind>:<slug>`;
- `f:<kind>:<slug>.<name>`;
- `rel:collection:<slug>` **[C]**: relations apontando para a collection.

| op                                                     | Leituras e escritas                                                              |
| ------------------------------------------------------ | -------------------------------------------------------------------------------- |
| createEntity                                           | escreve `e:` e cada `f:`; lê o `rel:` de cada relation                           |
| dropEntity, renameEntity                               | escrevem `e:`, os `f:*` da entidade e `rel:` (renameEntity: de origem e destino) |
| addField, dropField, alterField, setIndex, renameField | leem `e:`; escrevem `f:` (renameField: from e to); relation lê o `rel:` alvo     |

## 5. Diff (`migrate/src/ops/diff.ts`)

```ts
export interface RenameHints {
  entities?: { kind: TargetKind; from: string; to: string }[];
  fields?: { target: TargetRef /* slug NOVO */; from: string; to: string }[];
}
export interface DiffWarning {
  kind: "possible-rename";
  target: TargetRef;
  dropped: string;
  added: string;
}
export interface DiffResult {
  ops: MigrationOp[];
  warnings: DiffWarning[];
}
export function diff(
  prev: SchemaSnapshot,
  next: SchemaSnapshot,
  hints?: RenameHints,
): DiffResult; // lança DiffHintError
export class DiffHintError extends Error {
  readonly hint: unknown;
  readonly reason: "source-missing" | "target-missing" | "cycle" | "duplicate";
}
```

Algoritmo:

1. Valida as dicas:
   - a origem existe em `prev` e não existe em `next`;
   - o destino existe em `next` e não existe em `prev`;
   - não há duplicata;
   - **não há ciclo** (renames encadeados ou trocados entre si, a↔b) **[C]**. Cadeias sem ciclo são ordenadas topologicamente: primeiro quem renomeia **para** um nome que outro libera.
2. Emite `renameEntity` e **aplica no `prev`** via `applyOp`, que reescreve as relations **[C]**. O resto do diff compara contra esse `prev'`.
3. Emite `createEntity` (fields completos, incluindo relations, porque a integridade só é verificada no fim).
4. Por entidade comum, nesta ordem: `renameField` (dicas, ordenadas topologicamente), `addField`, `alterField` (shape mudou), `setIndex` (index mudou), `dropField`.
5. Emite `dropEntity`.
6. Dentro de cada grupo a ordem é `kind` (collection < global), depois slug, depois name.
7. Rename com shape diferente vira `renameField` + `alterField`; com índice diferente, + `setIndex`.
8. Avisos: na mesma entidade, um `dropField` e um `addField` com o mesmo shape geram `possible-rename`.

Invariante (teste de tabela + fuzz com seed fixa): `snapshotsEqual(replay([{ops: diff(a,b,h).ops}], stateOf(a)).snapshot, b)`.

## 6. Migração, grafo e reconciliação

### 6.1 Arquivo (`migrate/src/migration/`)

```ts
// types.ts
export const MIGRATION_FORMAT = 1;
export type MigrationId = string;
export const MIGRATION_ID_PATTERN = /^\d{8}T\d{9}Z_[0-9a-f]{4}_[a-z0-9_]{1,64}$/;
export interface MigrationFile {
  format: 1;
  id: MigrationId;
  parent: MigrationId | null;
  ops: MigrationOp[];
}

// id.ts
export function slugifyName(input: string): string; // minúsculas, [^a-z0-9]+ → "_", trim de "_", corta em 64; vazio → DiffHintError? não: InvalidMigrationNameError
export function newMigrationId(
  name: string,
  now: Date,
  random4hex: () => string,
): MigrationId;
export function compareIds(a: MigrationId, b: MigrationId): number;

// validator.ts — só combinators de @shuri/validate
export const fieldSpecValidator: Validator<unknown>; // discriminated("type", {...}) + objectOf(unknownKeyMessage)
export const migrationOpValidator: Validator<unknown>; // discriminated("op", {...})
export const migrationFileValidator: Validator<unknown>; // objectOf + oneOf([1]) + matches(ID) + arrayOf(op, msg, {min:1}) + record(spec, msg, {key: matches(FIELD)})
export function parseMigration(json: unknown, source: string): MigrationFile; // + id == basename(source); lança MigrationFileError

// checksum.ts — globalThis.crypto.subtle
export function checksumOf(
  m: Pick<MigrationFile, "format" | "id" | "ops">,
): Promise<string>; // "sha256:<hex>"

// serialize.ts
export function serializeMigration(m: MigrationFile): string; // JSON.stringify com 2 espaços, chaves na ordem format,id,parent,ops; "\n" final
```

### 6.2 Grafo (`migrate/src/graph/graph.ts`)

```ts
export interface MigrationGraph {
  readonly byId: ReadonlyMap<MigrationId, MigrationFile>;
  readonly roots: readonly MigrationId[]; // parent null, ordenados
  readonly heads: readonly MigrationId[]; // sem filhos, ordenados
  children(id: MigrationId): readonly MigrationId[];
  ancestors(id: MigrationId): readonly MigrationId[]; // do root até id, inclusive
}
export function buildGraph(files: readonly MigrationFile[]): MigrationGraph; // GraphError
export function lca(
  g: MigrationGraph,
  a: MigrationId,
  b: MigrationId,
): MigrationId | null; // null = raiz virtual
export function linearChain(g: MigrationGraph): MigrationFile[]; // MultipleHeadsError se heads>1 ou roots>1
```

### 6.3 Comutação (`migrate/src/graph/commute.ts`) **[C]**

```ts
export interface OpRef {
  migration: MigrationId;
  index: number;
  op: MigrationOp;
}
export interface OpConflict {
  a: OpRef;
  b: OpRef;
  resource: string;
}
export type CommuteResult =
  | { commutes: true }
  | {
      commutes: false;
      reason: "replay-error";
      order: "AB" | "BA";
      error: ReplayError;
      conflicts: OpConflict[];
    }
  | { commutes: false; reason: "divergent"; conflicts: OpConflict[] };
export function branchesCommute(
  base: ReplayState,
  a: readonly MigrationFile[],
  b: readonly MigrationFile[],
): CommuteResult;
```

Algoritmo:

1. `sAB = replay(a ++ b, base)` e `sBA = replay(b ++ a, base)`, sempre, sobre os ramos inteiros.
2. Os ramos comutam se e só se nenhum dos dois replays lança e `statesEquivalent(sAB, sBA)`.
3. Se não comutam, `conflicts` = pares (op de a, op de b) cujos footprints se cruzam com escrita de pelo menos um lado. O footprint **só rotula**; quem decide é o replay.

### 6.4 Reconciliação (`migrate/src/graph/reconcile.ts`) **[C]**

```ts
export interface ReconcileOptions {
  frozen?: ReadonlySet<MigrationId>;
} // ids presentes em frozenRef
export interface ReconcilePlan {
  rewrites: { id: MigrationId; parent: MigrationId | null }[];
  chain: MigrationId[];
}
export function planReconcile(
  files: readonly MigrationFile[],
  opts?: ReconcileOptions,
): ReconcilePlan;
// lança ReconcileConflictError | FrozenDivergenceError
```

Algoritmo (puro; os rewrites são aplicados em memória entre as iterações):

1. Monta o grafo. Se houver mais de uma root, todas passam a ter a raiz virtual `null` como ancestral.
2. Enquanto houver mais de uma head:
   1. Para cada par de heads (h1, h2), calcula `l = lca(h1, h2)` e a profundidade de `l` (a raiz virtual tem profundidade 0).
   2. Escolhe o par com o **LCA mais profundo**. Em caso de empate, o par menor pela ordem lexical de `(min(firstExcl), max(firstExcl))`, onde `firstExcl(h)` é o primeiro id no caminho exclusivo `l→h`.
   3. Define os ramos `A = caminho(l→hA)` e `B = caminho(l→hB)`, onde A é o ramo **congelado**. Se nenhum ou os dois são congelados, A é o de `firstExcl` menor.
   4. Se os dois são congelados, lança `FrozenDivergenceError`: produção já tem os dois ramos, e a única saída é uma migração corretiva manual.
   5. Calcula `branchesCommute(replayUpTo(l), A, B)`. Se falhar, lança `ReconcileConflictError` com os conflitos desse par (para no primeiro par em conflito; a ordem é determinística).
   6. Rebase: `parent(primeiro de B) = hA`, e B nunca é congelado. Adiciona o rewrite.
3. Verificação final: `replay(linearChain)` não lança.

Garantias:

- O resultado depende só do conjunto de arquivos e de `frozen`, não da ordem de leitura nem de quem roda.
- O checksum não muda, porque só o `parent` é reescrito.
- Como `frozen` vem de `frozenRef` (config, por exemplo `origin/main`, lido via `git ls-tree`), uma migração que já está em main nunca muda de posição.

## 7. Port de driver (`migrate/src/driver/types.ts`) **[C]**

```ts
export interface AppliedMigration {
  id: MigrationId;
  checksum: string;
  status: "running" | "done"; // "running" = começou e não terminou (só drivers não atômicos)
  startedAt: string;
  finishedAt?: string; // ISO
}

export interface PlannedOp {
  op: MigrationOp;
  effect: OpEffect;
  dependents: TargetRef[];
} // dependents: entidades com relation para o alvo (para FK/junções no D1)
export interface PlannedMigration {
  id: MigrationId;
  checksum: string;
  ops: PlannedOp[];
  before: ReplayState;
  after: ReplayState; // calculados na ORDEM REAL do banco (journal + pendentes)
}

export interface DriverStep {
  description: string;
  destructive: boolean;
  statements?: string[];
  estimatedRows?: number;
}
export interface DriverPlan {
  migration: PlannedMigration;
  steps: DriverStep[];
}

export interface DriverCapabilities {
  atomicity: "migration" | "op" | "none"; // memory: migration (copy-on-write); D1: migration (batch); drivers sem transação: none
  transactionalJournal: boolean; // journal na mesma unidade atômica das ops
  render: boolean; // sabe gerar texto (SQL) do plano
}

export interface MigrationLock {
  readonly holder: string;
  heartbeat(): Promise<void>; // estende o TTL; lança LockLostError se outro holder tomou
  assertHeld(): Promise<void>; // fencing antes de cada op e do journal
  release(): Promise<void>; // só remove se holder ainda bate
}

export interface MigrationDriver {
  readonly capabilities: DriverCapabilities;
  validateSnapshot?(snapshot: SchemaSnapshot): Issue[]; // limites do engine (ex.: 100 colunas no D1)
  acquireLock(
    holder: string,
    ttlMs: number,
    now?: () => Date,
  ): Promise<MigrationLock | undefined>;
  forceUnlock(): Promise<{ holder: string; expiresAt: string } | undefined>;
  applied(): Promise<AppliedMigration[]>; // ordem de início
  plan(m: PlannedMigration): Promise<DriverPlan>;
  execute(plan: DriverPlan, lock: MigrationLock): Promise<void>;
  render?(plan: DriverPlan): string;
  journal: {
    markApplied(entry: Pick<AppliedMigration, "id" | "checksum">): Promise<void>; // baseline/mark-applied
    unmark(id: MigrationId): Promise<void>;
    setChecksum(id: MigrationId, checksum: string): Promise<void>; // repair-checksum
  };
}

export interface Migratable {
  readonly migrations: MigrationDriver;
}
export function isMigratable(value: object): value is Migratable;
```

Contrato que todo driver cumpre (verificado na suíte de contrato §11.4):

- `execute` aplica só as ops com `effect: "applied"`.
- Se `atomicity === "migration"`: ops e journal (`done`) na mesma unidade atômica. Uma falha injetada no último passo deixa schema, dados e journal intactos.
- Se `atomicity !== "migration"`:
  1. grava o journal `running` antes da primeira op;
  2. cada op é idempotente com dados parcialmente aplicados;
  3. chama `lock.assertHeld()` antes de cada op;
  4. grava `done` por último.
- O re-run de uma migração `running` reexecuta todas as suas ops.

### 7.1 `memory-journal.ts`

`createMemoryJournal(): { lock…, applied…, journal… }` é a implementação de lock e journal em memória, reutilizada pelo driver memory e pelo fake de teste.

## 8. Runner (`migrate/src/runner/`)

```ts
export interface MigrationSet {
  files: readonly MigrationFile[];
} // já validados
export interface MigrationStatus {
  chain: MigrationId[];
  applied: AppliedMigration[];
  pending: MigrationId[]; // ordem da cadeia
  running: MigrationId[]; // status "running" (crash anterior)
  unknownApplied: MigrationId[];
  checksumMismatch: MigrationId[];
  outOfOrder: MigrationId[]; // pendentes anteriores, na cadeia, a alguma aplicada
  outOfOrderConflict: boolean; // ordem real não equivalente à cadeia
  schemaDrift: MigrationOp[] | null; // diff(replay(chain), snapshotOf(schema)) não vazio
}
export function migrationStatus(
  i: MigrationSet & { driver: MigrationDriver; schema?: ResolvedSchema },
): Promise<MigrationStatus>;

export interface MigrateUpOptions extends MigrationSet {
  driver: MigrationDriver;
  schema?: ResolvedSchema;
  allowDestructive?: readonly MigrationId[] | "all";
  dryRun?: boolean;
  holder?: string; // default crypto.randomUUID()
  lockTtlMs?: number; // default 60_000; heartbeat a cada ttl/3
  waitForLockMs?: number; // default 0 (falha imediata)
  now?: () => Date;
}
export interface MigrateUpResult {
  applied: MigrationId[];
  plans: DriverPlan[]; /* preenchido em dryRun */
}
export function migrateUp(o: MigrateUpOptions): Promise<MigrateUpResult>;

export interface AssertMigratedOptions extends MigrationSet {
  driver: MigrationDriver;
  schema: ResolvedSchema;
}
export function assertMigrated(o: AssertMigratedOptions): Promise<void>;
```

`migrateUp`:

1. `linearChain`. Se houver várias heads, lança `MultipleHeadsError` ("rode `shuri-migrate reconcile`").
2. Calcula os checksums.
3. Se `schema` foi passado e há drift, lança `SchemaDriftError(ops)`.
4. Se `driver.validateSnapshot` existe e acusa issues sobre `replay(chain)`, lança `DriverLimitError`.
5. Adquire o lock (com espera opcional por polling). Se não conseguir, lança `MigrationLockedError(holder, expiresAt)`.
6. Dentro de `try`:
   1. relê `applied()`;
   2. `unknownApplied` lança `UnknownAppliedMigrationError`; `checksumMismatch` lança `ChecksumMismatchError`;
   3. ordem real = `applied` (`done` e `running`, em ordem de início) mais as pendentes na ordem da cadeia. Se `replay(ordem real)` lança ou não é equivalente (com linhagem) a `replay(chain)`, lança `OutOfOrderConflictError`;
   4. alvos = migrações `running` mais as pendentes. Calcula `PlannedMigration` sequencialmente, com o `before` vindo do estado da ordem real;
   5. se alguma destrutiva não foi aprovada em `allowDestructive`, lança `DestructiveMigrationError` **antes** de aplicar qualquer coisa;
   6. para cada alvo: `plan` e, se não for `dryRun`, `execute(plan, lock)`, com heartbeat em timer.
7. `finally`: para o timer e chama `lock.release()`.

`assertMigrated` faz as mesmas checagens dos passos 1–3 e 6.2–6.3, sem lock, e lança `PendingMigrationsError` se houver pendentes ou `running`.

## 9. CLI e I/O (`migrate/src/node/`, subpath `@shuri/migrate/node`)

```ts
// dir.ts
export interface MigrationsDir {
  list(): Promise<MigrationFile[]>;
  write(f: MigrationFile): Promise<void>;
}
export function fsMigrationsDir(path: string): MigrationsDir; // ignora index.ts; erro agrega todos os arquivos inválidos

// config.ts
export interface MigrateConfig {
  dir?: string; // default "migrations"
  schema: () => ResolvedSchema | Promise<ResolvedSchema>;
  adapter?: () => object | Promise<object>; // precisa ser Migratable para status/up/baseline/...
  frozenRef?: string; // ex. "origin/main"; ausente = nada congelado
  bundle?: { out?: string }; // default "<dir>/index.ts"
}
export function defineMigrateConfig(c: MigrateConfig): MigrateConfig;
export function loadConfig(path?: string): Promise<MigrateConfig>; // default ./shuri.migrate.ts via import() nativo

// cli.ts
export function runCli(argv: readonly string[], io: CliIO): Promise<number>; // retorna exit code; testável in-process
export interface CliIO {
  stdout(s: string): void;
  stderr(s: string): void;
  cwd: string;
  isTTY: boolean;
  prompt?(q: string): Promise<boolean>;
}
```

- O bin é um shim JS commitado, `packages/migrate/bin/shuri-migrate.js`: `#!/usr/bin/env node` seguido de `import("../dist/node/cli-main.js")` **[C]**.
- O loader do config é o `import()` nativo, que exige Node ≥22.18 e type stripping. Isso implica:
  - o config usa só sintaxe apagável e imports `.ts` (como o demo já faz);
  - os pacotes de workspace resolvem para `dist`, então o `build` vem antes (no turbo, `check` tem `dependsOn: ["^build"]`).

Comandos (todos aceitam `--config`, `--dir` e `--json`):

| Comando                                                                                                | Faz                                                                                                                                       | Exit                                                          |
| ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `generate <name> [--rename-entity kind:from=to]… [--rename-field kind:slug.from=to]… [--no-reconcile]` | reconcile automático (imprime os rewrites), diff contra o schema, escreve o arquivo e roda bundle; imprime ops, destrutivas e avisos      | 0, ou 0 com "nada a gerar"; 3 em conflito; 2 em dica inválida |
| `reconcile [--dry-run]`                                                                                | `planReconcile` + rewrites + bundle                                                                                                       | 0 / 3                                                         |
| `status [--exit-code]`                                                                                 | status formatado                                                                                                                          | 0; 4 se `--exit-code` e houver pendente/drift                 |
| `check`                                                                                                | parse, uma head, replay, sem drift, `validateSnapshot` (se houver adapter), bundle atualizado; sem banco                                  | 0 / 3 / 4                                                     |
| `up [--allow-destructive <id,…> \| --allow-destructive-all] [--dry-run] [--wait <ms>]`                 | `migrateUp`; num TTY sem flag lista as destrutivas e pede confirmação; sem TTY falha                                                      | 0 / 4 / 5 / 6 / 7                                             |
| `baseline [--to <id>]`                                                                                 | journal vazio obrigatório; sem introspecção (§18); `markApplied` da cadeia até `id` (default: head)                                       | 0 / 1                                                         |
| `unlock [--force]`                                                                                     | mostra holder e expiração; `--force` libera                                                                                               | 0 / 5                                                         |
| `mark-applied <id>` / `unmark <id>`                                                                    | correções manuais, com confirmação                                                                                                        | 0 / 1                                                         |
| `repair-checksum <id>`                                                                                 | regrava o checksum do journal a partir do arquivo, com confirmação                                                                        | 0 / 1                                                         |
| `render <id>`                                                                                          | `render(plan)` se o driver suportar (D1)                                                                                                  | 0 / 1                                                         |
| `bundle`                                                                                               | gera `<dir>/index.ts` com `import m_<n> from "./<id>.json" with { type: "json" }` (`<n>` = posição na cadeia) e `export default [m_0, …]` | 0                                                             |

Exit codes:

| Código | Significado                                           |
| ------ | ----------------------------------------------------- |
| 0      | ok                                                    |
| 1      | erro genérico                                         |
| 2      | uso inválido                                          |
| 3      | conflito de reconciliação ou várias heads             |
| 4      | pendente ou drift                                     |
| 5      | locked                                                |
| 6      | precisa de aprovação destrutiva                       |
| 7      | checksum divergente ou migração aplicada desconhecida |

- A saída `--json` é `{ "version": 1, "command": "...", "ok": boolean, "result"?: ..., "error"?: { "name", "message", "details" } }`, sempre em stdout.
- Toda mensagem de erro termina com o **próximo comando sugerido**.
- O `bundle` é **gitignored** e gerado no `prebuild`/`pretypecheck` da app; o `check` falha se ele estiver desatualizado **[C]**.

## 10. Integração `@shuri/core` / `@shuri/sdk`

```ts
// core/src/schema.ts
export interface ResolvedSchema {
  collections: readonly CollectionSchema[];
  globals: readonly GlobalSchema[];
}

// sdk/src/schema.ts
export function resolveSchema(
  config: Pick<
    CreateConfig<readonly CollectionSchema[], readonly GlobalSchema[]>,
    "collections" | "globals" | "plugins"
  >,
): ResolvedSchema; // merge de plugins (create.ts:223-229) + createCore (valida); lança PluginSlugCollisionError | CollectionSchemaError | GlobalSchemaError
```

`create()` passa a usar uma função interna `resolveCore(config)` que devolve o `Core`, para não validar duas vezes. O comportamento é o mesmo.

Fluxo de boot (a decisão fica com a app; o `create()` continua síncrono):

```ts
// app-config.ts (sem efeitos colaterais)
export const appConfig = { collections, globals, plugins, adapter } satisfies CreateConfig<…>;
// server.ts
import migrations from "../migrations/index.ts";
await migrateUp({ files: migrations, driver: appConfig.adapter.migrations, schema: resolveSchema(appConfig) }); // dev/memory
// prod: await assertMigrated({...}) — falha fechado
const app = create(appConfig);
```

### 10.1 Workflow de produção **[C]**

- **Node + um adapter com driver de migração:** um job de deploy no CI roda `shuri-migrate check`, depois `up --allow-destructive <ids aprovados no PR>`, e só então o deploy. A app sobe com `assertMigrated`.
- **Workers + D1** (plano F10), duas opções:
  - `shuri-migrate render`, que gera o SQL para `wrangler d1 migrations apply`;
  - ou um endpoint/admin protegido chamando `migrateUp` com o bundle.

  `assertMigrated` roda uma vez por isolate, com memo.

- **Adoção em banco existente:** `check`, depois `generate init` (cria tudo), depois `baseline`.
- **Upgrade do better-auth ou mudança de options:** altera o schema efetivo, gera drift, e é preciso rodar `generate`. Isso fica documentado no AGENTS.md do better-auth.

## 11. Drivers

### 11.1 memory (`store-memory`)

- Refactor: o estado (`tables`, `globals`) é extraído para `src/tables.ts` (`createMemoryState()`). `memory-adapter.ts` e `migrations.ts` recebem o mesmo estado.
- `createMemoryAdapter(): MemoryAdapter` (`StoreAdapter & Migratable`). A mudança é aditiva.
- Capabilities: `{ atomicity: "migration", transactionalJournal: true, render: false }`, via **copy-on-write**: o driver clona **só** as tabelas e os globais que algum op escreve (as demais ficam compartilhadas com o estado vivo), aplica, grava o journal (`markApplied`) e só então faz o swap do estado, de forma síncrona. Se o journal falhar, o estado vivo fica intacto.
- Colisão de rename (collection de destino com dados, ou global de destino já existente) lança `RenameCollisionError` de `@shuri/migrate`; os dois casos usam o mesmo erro.
- É um driver de **referência/debug**: o estado em memória zera a cada boot, então produção não precisa dele. Serve para o demo, para testes e como implementação de referência da suíte de contrato.
- **Fix de índice** **[C]**: a memo passa a ser por identidade do `CollectionSchema` (a última referência vista). Uma referência nova reconstrói os índices. O driver também reconstrói em `setIndex`, `renameField` e `alterField`. O hot path continua O(1).
- O lock e o journal vêm de `createMemoryJournal()`.

### 11.2 Mongo (`store-mongo`): removido

O driver do Mongo (`store-mongo/src/migrations/`, `MongoAdapter`, `autoIndex`, `migrationsCollection`, `lockId`, write/read concern das migrações) foi implementado e depois **removido por decisão do produto**. Motivo: o Mongo é schemaless; adicionar e remover campos não exige migração, e renomes e mudanças de tipo são tratados manualmente por enquanto. `@shuri/store-mongo` voltou ao estado anterior (sem dependência de `@shuri/migrate`, sem `adapter.migrations`), e o `createMongoAdapter` mantém a criação preguiçosa de índices como antes.

O desenho abaixo fica como referência para quem retomar o driver: capabilities `{ atomicity: "none", transactionalJournal: false, render: false }`; ops idempotentes (`createCollection` ignorando o erro 48, `drop` ignorando 26, `$rename` guardado, `alterField` por pipeline de update guardada por `$type`/`$isArray`/`$isNumber`); lock como documento com TTL (`insertOne`, E11000 significa ocupado, takeover com `findOneAndUpdate` sobre `expiresAt`) e journal com um documento por migração.

### 11.3 Testes de conversão cruzados

`CONVERSION_CASES` (exportado de `@shuri/migrate/testing`) é a tabela de casos de `convertValue`; todo driver que converte valores fora de JS (SQL, pipeline de documentos) deve rodá-la contra o seu motor e comparar os resultados.

### 11.4 Suíte de contrato (`@shuri/migrate/testing`)

```ts
export interface ContractHarness {
  make(): Promise<{
    adapter: ContractAdapter;
    injectFailure(afterStep: number): void;
    cleanup(): Promise<void>;
  }>;
}
/** Subconjunto estrutural de StoreAdapter (migrate não depende de @shuri/store). */
export interface ContractAdapter extends Migratable {
  insert(
    c: CollectionSchema,
    data: Record<string, unknown>,
  ): Promise<Record<string, unknown> & { id: string }>;
  findMany(c: CollectionSchema): Promise<(Record<string, unknown> & { id: string })[]>;
  findGlobal(g: GlobalSchema): Promise<Record<string, unknown> | undefined>;
  updateGlobal(
    g: GlobalSchema,
    data: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
}
export function schemaFromSnapshot(s: SchemaSnapshot): ResolvedSchema; // títulos sintéticos; usado pela suíte
export function describeMigrationDriverContract(name: string, h: ContractHarness): void;
export const CONVERSION_CASES: readonly {
  from: FieldShape;
  to: FieldShape;
  input: unknown;
  output: unknown;
}[];
```

- O vitest é uma `peerDependency` opcional. O código fica em vários arquivos de até 300 linhas: `testing/contract-ops.ts`, `contract-lock.ts`, `contract-journal.ts`, `contract-crash.ts`.
- Casos cobertos:
  - cada op sobre dados reais (insert via adapter, aplicar, ler via adapter);
  - apply duas vezes;
  - **crash após o passo k e re-run** (todas as ops com vários passos);
  - atomicidade (quando `atomicity === "migration"`);
  - lock exclusivo, expiração, heartbeat e fencing;
  - journal `running`/`done`;
  - `CONVERSION_CASES`;
  - banco preexistente com o índice lazy `<f>_1`.

## 12. `@shuri/validate` **[C]**

```ts
// src/discriminated.ts (flat, como primitives.ts)
export function discriminated(
  tag: string,
  variants: Readonly<Record<string, Validator<unknown>>>,
  message?: string | ((tagValue: unknown) => string),
): Validator<unknown>;
// não-objeto → issue no path atual "must be an object"; tag fora de variants → issue em ctx.at(tag) (default: `must be one of a, b`); senão delega com o mesmo ctx

// validators.ts (alterações compatíveis)
record<T>(value: Validator<T>, message?: string, options?: { key?: Validator<string> }): Validator<unknown>; // key validado em ctx.at(key)
arrayOf<T>(item: Validator<T>, message?: string, options?: { min?: number; minMessage?: string }): Validator<unknown>;
```

- Os testes ficam colados (`discriminated.test.ts` e os casos novos em `validators.test.ts`).
- O AGENTS.md é atualizado.
- Se `validators.ts` passar de 300 linhas, `record` e `arrayOf` vão para `collections.ts`.

## 13. Erros (`migrate/src/errors.ts` + `errors/*.ts` se exceder 300 linhas)

Todos `extends Error`, com `name` = nome da classe.

| Erro                                             | Campos                                                                                  | Exit CLI |
| ------------------------------------------------ | --------------------------------------------------------------------------------------- | -------- |
| `CanonicalJsonError`                             | `path`                                                                                  | 1        |
| `MigrationFileError` (extends `ValidationError`) | `source`, `issues`                                                                      | 1        |
| `InvalidMigrationNameError`                      | `input`                                                                                 | 2        |
| `ReplayError`                                    | `op`, `reason`                                                                          | 1        |
| `DiffHintError`                                  | `hint`, `reason`                                                                        | 2        |
| `GraphError`                                     | `kind: "duplicate"\|"unknown-parent"\|"cycle"`, `ids`                                   | 1        |
| `MultipleHeadsError`                             | `heads`                                                                                 | 3        |
| `ReconcileConflictError`                         | `result: CommuteResult`, `branches: [MigrationId[], MigrationId[]]`, `format(): string` | 3        |
| `FrozenDivergenceError`                          | `heads`                                                                                 | 3        |
| `SchemaDriftError`                               | `ops`                                                                                   | 4        |
| `PendingMigrationsError`                         | `pending`, `running`                                                                    | 4        |
| `DriverLimitError`                               | `issues`                                                                                | 1        |
| `MigrationLockedError`                           | `holder`, `expiresAt`                                                                   | 5        |
| `LockLostError`                                  | `holder`                                                                                | 5        |
| `DestructiveMigrationError`                      | `items: {migration, op}[]`                                                              | 6        |
| `ChecksumMismatchError`                          | `ids`                                                                                   | 7        |
| `UnknownAppliedMigrationError`                   | `ids`                                                                                   | 7        |
| `OutOfOrderConflictError`                        | `ids`, `result`                                                                         | 3        |
| `RenameCollisionError`                           | `target`, `to`, `sampleIds`                                                             | 1        |

Formato do diagnóstico de conflito (`ReconcileConflictError.format()`):

```
conflito ao reconciliar
  ramo A: 20261002T153012000Z_1a2b_rename_title
  ramo B: 20261002T161200000Z_9f0e_alter_title
  recurso f:collection:services.title
    A[0] renameField title→name
    B[0] alterField title text→textarea
  edite um dos arquivos e rode `shuri-migrate reconcile`
```

## 14. Layout de `packages/migrate`

```
package.json        name @shuri/migrate; exports ".", "./node", "./testing"; bin shuri-migrate → bin/shuri-migrate.js
                    deps: @shuri/core, @shuri/validate; peerDeps opcionais: vitest
bin/shuri-migrate.js
.oxlintrc.json      extends base + overrides: no-restricted-imports "node:*" em src/** exceto src/node/**
tsconfig.json / tsconfig.build.json / vitest.config.ts
AGENTS.md           Tree / What each part does / Role in the monorepo
src/
  index.ts  errors.ts
  schema/   canonical-json.ts  snapshot.ts  names.ts                   (+ .test.ts)
  ops/      types.ts  validator.ts  state.ts  replay.ts  conversion.ts  convert-value.ts  footprint.ts  diff.ts  (+ .test.ts)
  migration/ types.ts  id.ts  validator.ts  checksum.ts  serialize.ts  (+ .test.ts)
  graph/    graph.ts  commute.ts  reconcile.ts                          (+ .test.ts)
  driver/   types.ts  memory-journal.ts                                 (+ .test.ts)
  runner/   status.ts  up.ts  assert.ts  plan.ts                        (+ .test.ts)
  testing/  index.ts  fake-driver.ts  conversion-cases.ts  contract-*.ts
  node/     dir.ts  config.ts  cli.ts  cli-main.ts  git.ts  commands/*.ts  (+ .test.ts)
  test/     two-devs.test.ts  out-of-order.test.ts  cli.test.ts          (integração; só fake-driver + memory-journal + fs tmp)
```

Testes ponta a ponta com o adapter real ficam em `store-memory/src/test/migrations.test.ts`, porque `migrate` não depende de adapter.

## 15. Cenários obrigatórios

`migrate/src/test/two-devs.test.ts` e `out-of-order.test.ts`:

1. A `addField price`, B `addField stock` → B rebaseado (id maior), cadeia linear, checksums iguais.
2. A e B `addField price` idêntico → comutam (mesma linhagem), um único campo.
3. `price` com tipos diferentes → `ReconcileConflictError` em `f:collection:services.price`.
4. A `renameField title→name`, B `alterField title` → conflito.
5. A `dropEntity tags`, B `addField` em `tags` → conflito.
6. **A `renameField a→b`, B `dropField a` + `addField b` (mesmo spec) → conflito por linhagem.**
7. **A `renameEntity tags→labels`, B `dropEntity tags` + `createEntity labels` → conflito.**
8. Três heads disjuntas → ordem pelo `firstExcl`.
9. Forks aninhados (`root→X→{Y,Z}` + `root→W`) → Y/Z resolvidos primeiro (LCA mais profundo), depois W.
10. Duas roots → raiz virtual.
11. Determinismo: 50 permutações da ordem de leitura dão rewrites idênticos.
12. Congelado: o ramo em `frozen` nunca é rebaseado, mesmo com id maior; os dois congelados → `FrozenDivergenceError`.
13. Fora de ordem: o banco com B aplicado recebe a cadeia `A→B` e o `up` aplica A com sucesso. Num banco com B aplicado e A em conflito → `OutOfOrderConflictError`.
14. Editar as ops de uma migração aplicada → `ChecksumMismatchError`; `repair-checksum` resolve.
15. Lock: dois `migrateUp` concorrentes com relógio fake → o segundo recebe `MigrationLockedError`. Com `waitForLockMs`, ele espera e vê zero pendentes. Lock expirado e tomado → o primeiro recebe `LockLostError` no próximo `assertHeld`.
16. Diff: duas collections novas com relation mútua; drop de duas que se referenciam; rename em cadeia `b→c`, `a→b`; troca `a↔b` → `DiffHintError("cycle")`; rename de entidade com relations de outras entidades (sem `alterField` espúrio).

## 16. Fases

Cada fase termina com `pnpm build test lint typecheck` verde, mais o CI.

| Fase    | Entrega                                                                                                                                                                                                                                                                        | Aceite                                                                                               |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| **F0**  | CI (`ci.yml`: install, build, test, lint, typecheck; cache do binário do mongodb-memory-server); `engines`; `@shuri/validate`: `discriminated`, `record.key`, `arrayOf.min`; scaffold de `packages/migrate` com o lint de `node:*`                                             | testes do validate: tag desconhecida, não-objeto, delegação com path, key inválida, min              |
| **F1**  | core: `ResolvedSchema`, regras de slug `_` e campo `id` (após verificar os nomes existentes); migrate: canonical-json, names, snapshot, ops types/validator, state, replay, conversion, convert-value, footprint                                                               | tabela §4.3 por op e efeito; linhagem; idempotência de `convertValue` em todos os `CONVERSION_CASES` |
| **F2**  | diff                                                                                                                                                                                                                                                                           | invariante `replay(diff)==next` em tabela + fuzz com seed; cenário 16                                |
| **F3**  | migration (id, validator, checksum, serialize) + graph                                                                                                                                                                                                                         | regex de id, checksum estável e independente de `parent`, `GraphError`s                              |
| **F4**  | commute + reconcile                                                                                                                                                                                                                                                            | cenários 1–12 (só a parte de grafo)                                                                  |
| **F5**  | driver port + memory-journal + fake-driver + runner + contrato (`testing/`) + **spike D1** com `node:sqlite` (driver descartável em `migrate/src/test/sqlite-spike.test.ts` implementando `plan`/`render`/`execute` de `addField` e `alterField` via rebuild em uma transação) | cenários 13–15; o spike valida que o port serve ao relacional, e fica até o F10                      |
| **F6**  | sdk `resolveSchema`/`resolveCore`; store-memory: `tables.ts`, driver, fix de índice                                                                                                                                                                                            | contrato verde no memory; teste de schema novo em runtime (HMR)                                      |
| **F7**  | node: dir, config, git, cli (todos os comandos), bundle; demo: `app-config.ts`, `shuri.migrate.ts`, `migrations/` inicial, `migrateUp` antes do seed, prebuild com bundle, task turbo `migrate:check` (`dependsOn ^build`) no CI                                               | `runCli` in-process para cada comando e exit code; `shuri-migrate check` verde no demo               |
| **F8a** | ~~Mongo: lock, journal, ops estruturais, `autoIndex`~~ (removida, §18)                                                                                                                                                                                                         | contrato (ops, lock, journal, crash) verde                                                           |
| **F8b** | ~~Mongo: conversões guardadas~~ (removida, §18)                                                                                                                                                                                                                                | `CONVERSION_CASES` + crash no meio de `updateMany`                                                   |
| **F9**  | AGENTS.md (migrate, validate, store-memory, store-mongo, sdk, better-auth); seção de produção                                                                                                                                                                                  | revisão                                                                                              |
| **F10** | (plano seguinte) `@shuri/store-d1` relacional sobre este port, partindo do spike                                                                                                                                                                                               | —                                                                                                    |

Tamanho relativo: F1, F4 e F8 (somando 8a e 8b) são os maiores, cerca de 2× cada uma das demais.

## 17. Riscos conhecidos e mitigação

| Risco                                                             | Mitigação                                                                                                       |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| A linhagem rejeita casos legítimos (falso conflito)               | O conflito sempre traz um diagnóstico e o dev ajusta o arquivo; nunca há perda silenciosa                       |
| `frozenRef` ausente → ramo de produção rebaseado                  | `check` avisa quando `frozenRef` não está configurado; a ordem fora da cadeia continua segura pelo §8 passo 6.3 |
| Conversão lossy em produção                                       | Aprovação por id + `up --dry-run` com `estimatedRows`                                                           |
| Config TS não carrega (sintaxe não apagável, pacote não buildado) | Erro do loader traduzido em mensagem ("rode `pnpm build`", "use só sintaxe apagável")                           |
| Padrões de nome conflitam com o schema existente                  | Verificação feita antes de fixar o regex (F1)                                                                   |

## 18. Decisões pós-implementação e desvios

Registro do que mudou entre este plano e o que foi entregue.

**Decisões**

- **Driver do Mongo removido.** O Mongo é schemaless: campos novos ou removidos não exigem migração, e renames e mudanças de tipo são tratados manualmente por enquanto. `store-mongo` não depende de `@shuri/migrate` e não expõe `adapter.migrations`. Os testes de base do `store-mongo` continuam existindo (`mongodb-memory-server`), por isso o CI fixa `MONGOMS_DOWNLOAD_DIR`.
- **Driver do memory é de referência/debug.** O estado zera a cada boot, então produção não precisa dele. Copy-on-write só das tabelas afetadas, `RenameCollisionError` para colisão de collection e de global, e o swap só depois do `markApplied`.
- **Migração é opcional por adapter.** Um adapter sem `migrations` é válido (`isMigratable` é falso): `status`, `up`, `baseline` e demais comandos que tocam o banco falham com `CliError` claro, e `check` roda sem banco.
- **`premigrate:check` do demo não regenera o bundle**, para que um bundle desatualizado ou ausente seja detectado pelo `check` no CI.
- `diff` valida as `RenameHints` com `@shuri/validate` (`ValidationError` com o caminho do problema).

**Desvios do plano original**

- **Regex de slug relaxado:** `SLUG_PATTERN = /^[a-z][A-Za-z0-9_-]{0,62}$/`. Maiúsculas depois do primeiro caractere são aceitas porque o demo já tem o global `seoDefaults`, e a regra do §3.3 manda relaxar o padrão em vez de renomear.
- **`ReplayError` com a razão `global-index`:** campo indexado em global é rejeitado no replay e no `integrityIssues`, com razão própria (além de `dangling-relation`).
- **`lockInfo()` obrigatório no port:** `MigrationDriver.lockInfo()` retorna holder e expiração do lock atual; `status`, `unlock` e `MigrationLockedError` dependem dele.
- **`baseline` sem introspecção:** o comando só exige journal vazio e faz `markApplied` da cadeia; não há introspecção do banco (o §9 previa uma "introspecção mínima do driver"). Quem adota um banco existente confere o schema com `check` antes.

- O check de "bundle desatualizado" do `migrate:check` é uma proteção só local: o bundle do demo é gitignorado e regenerado no `pretypecheck`/`prestart`, então no CI ele nunca está velho. No CI valem as demais checagens (parse, head única, replay, drift).
