# Scripts Documentation

This directory contains utility scripts for managing the EpicNext-Cms project.

## Scripts Overview

| Script                     | Description                                                       |
| :------------------------- | :---------------------------------------------------------------- |
| `dashboard.sh`             | Main interactive menu to run all other scripts.                   |
| `deploy.sh`                | Safely redeploys the application by freeing the port first.       |
| `logs.sh`                  | View logs for cms and mariadb services.                           |
| `backup.sh`                | Creates a database backup in `/backups`.                          |
| `db-restore.sh`            | Restores a database backup.                                       |
| `db-optimize.sh`           | Optimizes database tables.                                        |
| `docker-prune.sh`          | Cleans up unused Docker resources.                                |
| `verify-deploy.sh`         | Checks if the CMS is reachable after deployment.                  |
| `check-env.sh`             | Validates `.env` against `.env.example`.                          |
| `check-security.sh`        | Runs `pnpm audit` and checks for image updates.                   |
| `monitor.sh`               | Shows system disk/container resource usage.                       |
| `perf-report.sh`           | Runs performance profiling.                                       |
| `setup-dev.sh`             | Configures development environment.                               |
| `check-updates.sh`         | Checks for package and image updates.                             |
| `sync-readme-versions.mjs` | Syncs the versions in `README.md` with `package.json` / `.nvmrc`. |
| `maintenance.sh`           | Toggles maintenance mode flag.                                    |
| `doctor.sh`                | Runs a system diagnostic report.                                  |
| `setup-cron.sh`            | Configures automated cron jobs.                                   |
| `alert.sh`                 | Sends notifications to a configured webhook.                      |
| `catalog-sync.sh`          | Interactive catalog update against a clone source (see below).    |

## Usage

Run any script directly, or use the dashboard:
```bash
./scripts/dashboard.sh
```

### Keeping the README versions in sync

Bumping a dependency (or the pinned Node.js version) leaves `README.md` stale.
Rather than editing it by hand, run:

```bash
pnpm readme:versions        # rewrite README.md to match package.json / .nvmrc
pnpm readme:versions:check  # verify only; exits 1 when out of date (used in CI)
```

It manages the `pnpm` and `Node.js` rows of the System Requirements table and
the "Core stack" line. The CI `check` job runs the `--check` variant, so a
version change cannot reach `main` with a stale README — the pipeline fails
until you run `pnpm readme:versions`.

### Updating the catalog (`catalog-sync.sh`)

Compares this hotel's catalog against a clone source (Habbo and the retros) and
fixes what is broken: missing furniture icons, missing `.nitro` bundles,
`FurnitureData.json` drift, orphaned/duplicate catalog rows, and items that
exist in `items_base` but have no catalog offer.

```bash
pnpm catalog:sync                                   # interactive menu
./scripts/catalog-sync.sh --list-sources            # which sites can be compared
./scripts/catalog-sync.sh --all --sources=default-habbo-com
./scripts/catalog-sync.sh --all --sql --apply-sql   # catalogs changes are written
```

The menu asks which sources to compare (Habbo (COM) is the preset) and what may
be written. With no arguments it needs a terminal; with any flag it skips the
menu, so it is usable from cron.

Every step the engine exposes is available as a flag:

| Flag                                           | What it does                                                               |
| :--------------------------------------------- | :------------------------------------------------------------------------- |
| `--sources=<a,b>`                              | Compare against these sources (id or display name)                         |
| `--icons`                                      | Re-download missing furniture icons                                        |
| `--nitros`                                     | Re-download missing bundles (stored as `.hab`)                             |
| `--furnidata`                                  | Repair `FurnitureData.json` (add missing, drop duplicates)                 |
| `--structure`                                  | Repair orphaned / duplicate catalog rows                                   |
| `--check-ids`                                  | Check `FurnitureData.json` for spriteId conflicts                          |
| `--sql` / `--apply-sql`                        | Generate / apply the catalog SQL                                           |
| `--organize-sql`                               | Also emit the `catalog_pages` INSERTs into the SQL file                    |
| `--import-new`                                 | Import furniture the source has and this hotel lacks                       |
| `--only=<a,b>`, `--limit=N`, `--concurrency=N` | Narrow and tune the import                                                 |
| `--reconcile`                                  | Align `FurnitureData.json` with `items_base` after importing               |
| `--fix-sprite-ids`                             | Correct `items_base.sprite_id` drift                                       |
| `--rebuild-offers`                             | Rebuild catalog `offer_id` mirrors                                         |
| `--align-ids`                                  | Move `items_base` ids onto their furnidata ids (report; `--apply` runs it) |
| `--rename-bundles`                             | Rename legacy `.nitro` bundles to `.hab` (report; `--apply` runs it)       |
| `--everything`                                 | Every repair + import step, but still none of the destructive ones         |

`--import-new` is the step that actually adds furniture: `cloneSingleFurni`
downloads the icon and the bundle (sources serve `.nitro`, the local copy is
stored as `.hab`), appends the `FurnitureData.json` entry **and** creates the
catalog page plus the offer, exactly like the app's own import. It skips
anything already present, so it is safe to re-run.

Safety notes:
- **An audit writes nothing** — no repair flag means read-only.
- `--dry-run` together with `--import-new` lists what would be imported and
  imports nothing; use it first on a source before importing thousands of items.
- Generating the catalog SQL creates the `catalog_pages` sub-pages it references
  (same as the app's import), so a "generate only" run is not entirely
  read-only — only the `catalog_items` rows wait for `--apply-sql`. The SQL also
  lands in `storage/catalog-sync/*.sql` (gitignored) so it can be reviewed or
  replayed by hand.
- `--apply-sql` is the only flag that changes the catalog; `--apply` authorises
  the two heavyweight child scripts (`align-db-ids`, `migrate-nitro-to-hab`).
  Both only report without it.
- The engine is the same one the admin _Catalog audit_ page streams
  (`runCatalogAudit`), so a terminal run and an in-admin run agree.
- `--json` prints one machine-readable report; `--fail-on-errors` exits `3` when
  error-severity issues remain, which is what a scheduled check should use.
- Items that no compared source can provide stay missing: the run reports them
  instead of inventing an icon or a bundle.
