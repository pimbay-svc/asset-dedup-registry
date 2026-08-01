# Contributing

## Setup

See the README's "Quick Start (Local)" section for environment setup (Node, `.env`, `config.yaml`).
This document only covers what's specific to contributing, not initial setup.

## Before opening a PR

All of the following must pass:

```bash
npm run js:build
npm run js:lint
npm run js:format
npm run js:typecheck
npm run test:coverage
npm run test:mutation
```

Coverage target is 100% (statements, branches, functions, lines) — `vitest.config.ts`'s `coverage.exclude` list is intentionally short and each entry is justified there.
A change that drops coverage should come with new tests, not a new exclusion.

Test placement matters: `test/unit/` if every collaborator the code depends on is faked, `test/integration/` if more than one real production class is wired together with nothing faked.
See `docs/context.md` for the reasoning and other project-specific conventions (DI parameter-naming, domain-provider naming split, config-validation dead-code policy) — read it before making structural changes, not just before asking an AI agent to.

## Scope of changes

This repo is `asset-dedup-registry` specifically — the stateful, multi-tenant indexing/query layer of the `asset-dedup` ecosystem.
Changes to how `asset-dedup-core` hashes files, or to its `POST /hash`/`GET /algorithms` contract, belong in `asset-dedup-core`'s own repo, not here — this repo only consumes that contract (`src/infrastructure/core/coreClient.ts`).

## Public Domain Dedication

By submitting a pull request, you dedicate your contribution to the public domain under the same [Unlicense](LICENSE) terms as this project.
You assert that you have the right to make this dedication.
