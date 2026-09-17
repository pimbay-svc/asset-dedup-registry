# AGENTS.md — asset-dedup-registry

## Project Overview

`asset-dedup-registry` is the stateful indexing and duplicate-detection layer of the asset-dedup ecosystem.
It receives hashes computed by `asset-dedup-core` (a separate service it calls over HTTP), stores `project + recipe + assetId → hash` pairs and precomputed similarity data in PostgreSQL, and exposes authenticated duplicate lookup/grouping over HTTP plus a provisioning/query CLI.
It is the ecosystem's only stateful, multi-tenant service — every project is isolated behind its own API keys, and every endpoint except `/healthz` requires one.
Released under the Unlicense. Runtime: Node.js 24, TypeScript (strict).

## Commands

```bash
npm install
npm run cli              # run the provisioning/query CLI (project/api-client/asset/duplicates)
npm run dev              # tsx watch --env-file-if-exists=.env
npm run js:build         # tsc -p tsconfig.build.json
npm run js:lint          # eslint src test — check only
npm run js:lint:fix      # eslint src test --fix
npm run js:format        # prettier --check . — check only
npm run js:format:fix    # prettier --write .
npm run js:typecheck     # tsc --noEmit
npm run migrate          # apply migration/*.sql (drizzle-orm/postgres-js/migrator)
npm run start            # run compiled dist/
npm run test:unit        # vitest run test/unit
npm run test:integration # vitest run test/integration
npm run test:all         # both
npm run test:coverage    # both, --coverage
npm run test:mutation    # stryker run — MSI 100 gate
```

`js:typecheck` exists because `js:build` may exclude `test/` and ESLint doesn't reliably catch every type error — it's the authoritative compile gate, always run alongside `lint`/`test`.

After editing anything under `src/infrastructure/drizzle/schema/*.ts`, regenerate migrations with `npx drizzle-kit generate` before running `migrate` or the test suite — `migration/` is hand-managed, not auto-generated on every schema edit. See `docs/context.md`.

## Code Style

- **TS strict**, no unexplained `any` — prefer `unknown` + narrowing.
- **Named exports only.**
- **Interfaces for public contracts**, `type` for unions/internal shapes.
- **Explicit return types** on public functions/methods.
- **Small files**, one responsibility each.
- **No blind barrels** (`export * from`) — re-export explicitly.
- **No raw `enum`, ever — including `const enum`** — use `export const AnyType = {...} as const; export type AnyType = (typeof AnyType)[keyof typeof AnyType];`.
- **Named-constructor exceptions** — no inline `new SomeError(...)`.
- **Log/console message text lives in a `messages.ts` next to its module**, not inline at the call site.
- **Zod for config/env boundary validation** — never hand-rolled.
  HTTP request/response validation uses Fastify's native JSON Schema (`as const` objects) instead of zod — see `presentation/http/route/schema/`.
- **HTTP wire format is `snake_case`**, internal TS is `camelCase` — map at the route handler boundary. `config.yaml` keys are `snake_case` too, matching.
- **Config**: YAML via `yaml` (not `js-yaml`), zod-validated before use.
- **Logging**: `pino`, structured, no `console.log`. Pretty-print only in dev — a `NODE_ENV` typo enabling it in prod has bitten us before.
- **Comments** only where they explain a non-trivial decision or _why_ — never restate _what_ the code already says. Don't comment obvious lines. Keep to 1-2 lines; more only for genuinely complex logic. Always in English.
- **Caret-pin to the tested patch** (`^13.0.5`, not `^13.0`).
- **Markdown**: semantic linebreaks (one sentence/clause per line).
- **Docs discipline**: no "Project Layout" section in READMEs — the tree speaks for itself.

## Architecture

### Core — always applies

```
domain/
  model/model.ts      — entities, one file not one-dir-per-entity. Derived from Drizzle's InferSelectModel/InferInsertModel, re-exported as the domain's own names.
  model/*.model.ts     — domain vocabulary that isn't a plain entity (see "Domain vocabulary vs DTO" below)
  repo/*.repo.ts       — query repository interfaces (ports)
  provider/*.provider.ts — non-repository port interfaces
  service/*.ts         — pure algorithms, no I/O — stays here regardless of caller
  errors.ts            — domain errors
application/
  command/*.command.ts  — Command data classes dispatched through CommandGateway
  handler/*.handler.ts  — CommandHandler implementations, exposed via asHandlers()
  service/*.service.ts — orchestration/business logic
  writer/*.writer.ts   — write-side ports application orchestrates through
  No separate model/ dir — a type used by one file lives in that file; promote to domain/model/ only if genuine domain vocabulary
infrastructure/
  container.ts          — awilix container, CLASSIC mode
  config/, logger.ts, env.ts — mechanism-named adapters implementing domain/provider interfaces
  drizzle/              — Persistence via Drizzle
presentation/
  cli/cli.ts                      — CLI entrypoint (bootstrap wrapper, excluded from coverage like server.ts)
  cli/command/*.command.ts        — one Commander subcommand each, dispatches through commandGateway
  http/server.ts                  — buildServer(): Fastify instance, swagger, error handler, route registration
  http/errorResponse.ts           — sendErrorResponse(): domain error → HTTP status mapping
  http/route/*.route.ts, http/route/schema/*.schema.ts — Fastify routes + validation schemas
```

- **DI**: awilix, CLASSIC mode — constructor param names must match cradle keys exactly (fails silently at resolve time otherwise).
- **Singletons**: anything with shared mutable state (caches, pools, TTL resolvers — e.g. `AlgorithmService`'s recipe→algorithm cache) is a container singleton, never instantiated ad hoc.
- **Domain vocabulary vs DTO**: would this type mean the same thing if the wire format changed?
  Yes → domain; no (shapes only a boundary) → DTO, lives where consumed.
- **CQRS command-dispatch**: `application/command.gateway.ts`'s `CommandGateway` — one `Command` class + one `CommandHandler` per use case, registered in `container.ts` via `commandGateway.registerAll([...xHandlers.asHandlers()])`.
- **CLI**: `presentation/cli/`, Commander-based, one file per subcommand under `cli/command/`. Every subcommand dispatches through `commandGateway`, same as HTTP — never calls a `*.service.ts` directly, and never duplicates a route's logic.
  Don't touch `drizzle.config.ts`/migration strategy or the repo/schema 1:1 pairing without flagging it — migrations are cross-environment and costly to undo. `migration/` is regenerated by hand (`npx drizzle-kit generate`), not committed automatically on every schema edit — see `docs/context.md`.

## Testing

- **Vitest**, `test/unit/` + `test/integration/`, mirroring `src/` 1:1.
- Split is not mock-vs-real-I/O — a unit test can touch real I/O if that's a detail of the one module under test.
  - **unit/** — exercises exactly one module; its external boundaries are mocked or are its own implementation detail.
  - **integration/** — composes ≥2 modules, or crosses a framework boundary (DI container wiring real classes; Fastify routes via `app.inject`).
- Isolated route tests build a bare `Fastify()` instance and never see `buildServer()`'s `setErrorHandler` — they get Fastify's raw validation-error shape, not the documented `{ error }` shape. Only `test/integration/presentation/http/server.test.ts` (built via `buildServer()`) exercises the real wire shape end to end.
- Coverage target is **100% across the board** — `vitest.config.ts`'s `coverage.exclude` list is intentionally short and each entry is justified there; a change that drops coverage needs new tests, not a new exclusion.
- **Mutation score target is 100% (MSI)** — `stryker.config.mjs`, `test:mutation`.
- Every bug fix gets a regression test, ideally added after reproducing against the real running service.

## Guardrails

- Before doing a recurring structural task (add a command, add a table, add a route, register an adapter, add a CLI command, add a domain error, add a config key) — check SKILLS first; it encodes the exact convention, don't re-derive it from scratch.
- No new deps without proposing them explicitly.
- Targeted diffs — don't rewrite a file for a small fix.
- No unrequested docs/test scaffolding.
- Don't move `Dockerfile` stages/`COPY` paths without checking build context (relative to context, not the Dockerfile).
- Ask before changing a DI registration's lifetime.
- Domain vs application vs infrastructure placement unclear → ask, don't guess (use the DTO test above; `repo` vs `provider` for new interfaces).
- Drizzle-only rules from the Optional section above apply unconditionally here (this repo is Drizzle-backed): don't touch migration strategy or break the repo/schema 1:1 pairing without flagging it.
