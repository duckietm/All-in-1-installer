# Catalog Studio repository export

Studio mutations automatically queue an export to
`https://gitlab.epicnabbo.nl/remco/Epicnabbo-Catalogus-Updated-Daily.git`, branch
`Beta-3`. The jobs worker processes pending exports every minute. Streaming
imports stay active until their stream completes. Server actions for catalog
pages, offers, deletion and maintenance are covered as well.

## Server setup

1. Create a **dedicated clean clone** of the repository on `Beta-3`, outside the
   CMS directory. Configure non-interactive Git push authentication for the
   worker OS account using its credential helper. Do not put tokens in URLs.
2. Set `CATALOG_GIT_CHECKOUT` to that absolute clone directory in the CMS and
   worker environments. Set `CATALOG_GIT_STATE_DIR` to a persistent, writable
   directory outside the clone, shared by both processes on the same host.
3. Run `pnpm jobs:worker` alongside the CMS under your process supervisor.
   Both processes must have access to the configured asset directories and DB.
   The worker command enables the React server condition for server-only modules.
4. Restart the CMS after setting the environment. In **Studio → Sync**, use
   **Export now / retry** for the initial export. Subsequent mutations queue
   automatically. Status shows pending/active operations and the last commit.

Leaving `CATALOG_GIT_CHECKOUT` empty disables export. No credentials are shipped.
This source change alone does not configure or deploy the production service.

## Exported content

| Source                                                                   | Repository destination                              |
| ------------------------------------------------------------------------ | --------------------------------------------------- |
| Configured Nitro bundles, including furniture, figures, effects and pets | `Gamedata/bundled`                                  |
| Configured furni icons                                                   | `Gamedata/icons`                                    |
| Existing badge/catalog images                                            | `Gamedata/c_images`                                 |
| FurnitureData and supported public game-data JSON files                  | `Gamedata/config`                                   |
| Existing localized FurnitureData files                                   | `catalogue version 2 ( Final (Dev)/langs furnidata` |
| `items_base`, `catalog_pages`, `catalog_items`                           | `catalogue version 2 ( Final (Dev)/sqls`            |
| `catalog_pages_bc`, `catalog_items_bc`, when present                     | Same SQL directory                                  |

SQL is read in one consistent, read-only InnoDB transaction. Dumps contain table
definitions and deterministic upserts with hexadecimal UTF-8 string literals.
Import `items_base.sql`, then `catalog_pages.sql`, then `catalog_items.sql`.
Existing schemas are not migrated by these dumps. Rows absent from the source
are omitted; importing an upsert dump into another existing database does not
delete that database's extra rows. No user, session or credential tables are exported.

Only existing local assets are exported. Translation generation follows Studio's
existing setting; export does not generate missing languages or download assets.
Public JSON is explicitly allowlisted so translation caches and private runtime
files cannot enter the repository. Invalid JSON or concurrent Studio changes
prevent publication of that snapshot.

## Failure and concurrency behavior

- Pending events survive process restarts; events added during publication remain
  pending for the next run. Partial imports are exported as their settled local
  state, including successful items from a batch containing failures.
- A single filesystem lock serializes the worker. Dead local process markers are
  recovered on the next run. For an unreadable marker or a marker from another
  host, stop the CMS and worker before repairing the queue directory.
- A failed push retains the local commit and pending events for retry. Concurrent
  upstream commits are rebased; a conflict aborts the rebase and leaves the event
  pending. Resolve conflicts in the dedicated clone, then retry.
- The checkout must be clean before each run. Unrelated files are preserved and
  no force push is used. Missing local files do not cause remote deletions.
- Status errors omit raw Git output to avoid exposing authentication material.

## Verification

Run the `catalog-git-*` service tests and `src/lib/catalog-export-api.test.ts` with
Vitest. The integration test creates a temporary bare remote and verifies push,
failed-push recovery, no-op export and preservation of unrelated files. SQL
snapshot tests mock the database; production DB import and production push need
verification in the deployed environment.
