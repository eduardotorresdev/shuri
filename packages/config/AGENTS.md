# @shuri/config

Shared configuration — TypeScript, lint, and formatting — consumed by every other package in the
monorepo via `workspace:*`: base config files each package extends, with nothing to build.

## Tree

```
tsconfig.base.json           base compilerOptions (ES2022 target, NodeNext, strict, declaration)
oxlintrc.base.json            base oxlint rules
prettierrc.base.json          base prettier config
```

## What each part does

- **tsconfig.base.json** — strict TS config every package's own `tsconfig.json`/`tsconfig.build.json`
  extends: `target: ES2022`, `module`/`moduleResolution: NodeNext`, `strict: true`, `declaration:
true`.
- **oxlintrc.base.json** — the base rule set every package's own `.oxlintrc.json` extends.
- **prettierrc.base.json** — the shared formatting config.

## Role in the monorepo

Keeps type-checking, linting, and formatting consistent across `core`, `store`, `store-memory`,
`api`, `sdk`, `demo`, and `validate` without duplicating config in each one.
