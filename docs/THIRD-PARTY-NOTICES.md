# Third-Party Notices

This project itself is released under [The Unlicense](../LICENSE).
It bundles or invokes the following third-party software, each under its own license.

## npm dependencies

Full list with versions and licenses: run `npx license-checker --summary --production --excludePrivatePackages` — don't hand-maintain a duplicate of `package.json`/`package-lock.json` here.
Every transitive dependency currently resolved is verified directly against each package's own `package.json` `license` field, not assumed; none of it is copyleft.

Direct runtime dependencies — listed even though none carry an attribution requirement, so a reader doesn't have to run the tool just to see there's nothing unusual here:

| Package                        | License    |
| ------------------------------ | ---------- |
| `@fastify/rate-limit`          | MIT        |
| `@fastify/swagger`             | MIT        |
| `@fastify/swagger-ui`          | MIT        |
| `@pimbay/search-query`         | Unlicense  |
| `@pimbay/search-query-drizzle` | Unlicense  |
| `awilix`                       | MIT        |
| `commander`                    | MIT        |
| `drizzle-orm`                  | Apache-2.0 |
| `fast-glob`                    | MIT        |
| `fastify`                      | MIT        |
| `pino`                         | MIT        |
| `postgres`                     | Unlicense  |
| `yaml`                         | ISC        |
| `zod`                          | MIT        |

## Notes

This is not legal advice.
