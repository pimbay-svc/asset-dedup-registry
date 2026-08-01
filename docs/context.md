# Context

> Working memory, not a historical record.
> Continuously edited, not append-only — unlike DECISIONS.md.
> When something here resolves: delete it if it was only ever local/temporary, or promote it to DECISIONS.md if it turned out to matter beyond this moment.
> Don't let resolved items pile up here.

## Current focus

Paused at: None currently.

## Open questions

None currently.

## Known limitations / non-goals (for now)

- **Mutation testing is scoped to `domain/`/`application/`/`infrastructure/` — the presentation layer (`presentation/cli/command/**`, `presentation/http/route/**`, plus `server.ts`/`cli.ts`/`output.ts`) is excluded from `stryker.config.mjs`'s `mutate` list.** That layer only dispatches through `commandGateway`/application services and holds no branching logic of its own; most of the mutants Stryker generates there are cosmetic (a CLI option's help text, a command's description string), not logic worth a dedicated regression test. Mutating it would have roughly doubled the suite for little signal. Line/branch/function _coverage_ (100%, `vitest.config.ts`) still applies to this layer — only mutation testing is scoped down.
- **Cluster cache recompute has no locking against concurrent cold-cache requests.** Two requests hitting the same not-yet-cached `(project, algorithm, threshold, generation)` scope at once will both run `DrizzleClusterRepository.recompute` redundantly (each wrapped in its own transaction; the `cluster_cache_meta` upsert's `ON CONFLICT ... DO UPDATE SET computed_at = computed_at` and `cluster_cache_asset`'s `ON CONFLICT DO NOTHING` mean neither errors, they just duplicate the same seeding/propagation work). Both converge to the same correct result — this is wasted work under contention, not an incorrectness — but worth an advisory lock (`pg_advisory_xact_lock` keyed on the scope) if it turns out to matter in practice.
- No dedicated `migrate` service/init-container in `docker-compose.yml` — considered and explicitly declined; migrations run manually (`npm run migrate`) against a running Postgres instead. Revisit only if the manual step becomes a recurring source of "forgot to migrate" errors.
- `Comparison.COSINE` (vector/embedding recipes) is recognized in the domain model (`asset_vector` table, `UnsupportedRecipeError`) but has no application-layer implementation yet — `AssetService.recompute()` throws for it today. `AssetService.recomputeProject()` only handles batching/cursoring and delegates all comparison-type branching to `recompute()`, so it needs no changes when `COSINE` lands.

## Implementation notes

- **`package.json`'s `overrides.@fastify/static` pins `^10.1.1`.** `@fastify/swagger-ui` depends on `@fastify/static@^10.1.0`, a range that resolves to versions affected by [GHSA-83w8-p2f5-377r](https://github.com/fastify/fastify-static/security/advisories/GHSA-83w8-p2f5-377r) (route-guard bypass via non-leading `../`/`%2E%2E` path segments) below `10.1.1` — the override forces the patched version. Safe to drop once `@fastify/swagger-ui` itself bumps its declared `@fastify/static` requirement past that fix.
- **Migrations are hand-managed.** `migration/` is not committed to track every schema change automatically — after editing `src/infrastructure/drizzle/schema/*.ts`, regenerate with `npx drizzle-kit generate` before running `npm run migrate` or the test suite. Integration tests apply `migration/` via the same `drizzle-orm/postgres-js/migrator` call `migrate.ts` uses in production (see `test/helpers/db.ts`) — if a test run fails with "relation does not exist," the migration is stale.
- **Bulk recompute is opt-in, not automatic.** Changing a project's `--hamming-threshold` via `project update` does not retroactively touch existing `asset_hash_duplicate` rows — run `duplicates recompute --project <slug>` afterward if the change should apply to previously-computed data. See DECISIONS.md for why this is a separate step rather than happening implicitly.

## Ideas / future plans

Nothing parked here currently.
