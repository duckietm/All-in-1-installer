# EpicNext-CMS v1.0.3

A modern, high-performance content management system for Habbo hotel emulators, built on **Next.js 16** (App Router) with **Drizzle ORM** and **React 19**. Designed to integrate seamlessly with Polaris / Arcturus Morningstar MySQL/MariaDB databases.

Features a premium animated homepage (typewriter hero, floating orbs, scroll counters), a full admin panel, NextAuth authentication (argon2id hashing with legacy md5/bcrypt auto-upgrade), real-time RCON communication, Server-Sent Events for live radio data, smooth page transitions, and PM2 production deployment.

---

## System Requirements

| Component                    | Version            | Notes                                   |
| ---------------------------- | ------------------ | --------------------------------------- |
| Node.js                      | 26.12.1            | Pinned in `.nvmrc` (`>=26.12.1 <27`)    |
| pnpm                         | 12.11.2            | Pinned via `packageManager`             |
| npm                          | >= 11.x            | Supported alternative                   |
| yarn                         | >= 4.x             | Supported alternative                   |
| MySQL / MariaDB / PostgreSQL | 8.0+ / 10.6+ / 15+ | Supported databases                     |
| Docker                       | 24+                | Optional — for containerized deployment |
| Valkey                       | 8.x+               | Optional — caching, rate limiting, SSE  |

Core stack: **Next.js 16.4.2** (App Router) · **React 19.3.1** · **TypeScript 7.0.2** · **Drizzle ORM 0.45.4** · **Zod 4.6.7** · **Vitest 5.0.5** · **Biome 2.6.2** · **Playwright 1.64.1**.

> Builds must run through the `pnpm` scripts. This host has no swap and
> `vm.overcommit_memory=0`, so an uncapped `next build` gets OOM-killed by the
> kernel and can take the database and the live release down with it. See
> [Memory-capped commands](#memory-capped-commands).

---

## Quick Start

### 1. Clone & Install

Choose your preferred package manager:

```bash
git clone https://gitlab.epicnabbo.nl/remco/EpicNext-Cms.git
cd EpicNext-Cms
```

**pnpm (recommended):**
```bash
pnpm install
```

**npm:**
```bash
npm install
```

**yarn:**
```bash
yarn install
```

### 2. Database Setup

The CMS supports both **MySQL / MariaDB** and **PostgreSQL**. The database type is automatically detected from your `DATABASE_URL` protocol (`mysql://` or `postgres://`).

#### Option A: MySQL / MariaDB

Create your database:
```sql
CREATE DATABASE IF NOT EXISTS epicnext_cms CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

#### Option B: PostgreSQL

Create your database:
```sql
CREATE DATABASE epicnext_cms;
```

The CMS reads emulator-owned tables (`users`, `items`, `rooms`, `bans`, etc.) directly. It never creates, alters, or drops them. The Drizzle schema in `src/db/schema.ts` maps to the existing database structure.

> **Note:** The CMS does **not** own the emulator schema — it maps to those tables via Drizzle. Never run `drizzle-kit push` / `migrate` against the shared DB. CMS-owned tables (`website_*`, `radio_*`, etc.) are created via idempotent SQL in `drizzle/migrations/`.

#### Multi-Engine Architecture & Dialect Routing

EpicNext-CMS features a robust, multi-dialect database abstraction layer powered by **Drizzle ORM**. Depending on the connection string protocol supplied in `DATABASE_URL`:
- **MySQL / MariaDB (`mysql://`)**: Utilizes `mysql2/promise` connection pooling with optimized keep-alive, named placeholders, and strict statement hardening.
- **PostgreSQL (`postgres://` / `postgresql://`)**: Utilizes `node-postgres` (`pg.Pool`) with high-performance async client handling.

The query builder and helper functions (`queryRows`, `execResult`, `affectedRows`) automatically normalize driver-specific responses (`ResultSetHeader` vs PostgreSQL result objects), ensuring seamless compatibility across database engines without application-layer changes.

### 3. Configure Environment

Copy the example environment file and edit it with your specific settings:

```bash
cp .env.example .env
```

Edit `.env` to include at minimum:

```dotenv
# Choose your database type and configure DATABASE_URL:
# For MySQL / MariaDB:
# DATABASE_URL=mysql://user:password@127.0.0.1:3306/epicnext_cms

# For PostgreSQL:
# DATABASE_URL=postgres://user:password@127.0.0.1:5432/epicnext_cms

# Ensure these are set:
AUTH_SECRET=<random 32+ character string>
HOTEL_NAME=YourHotel
APP_URL=http://localhost:3002
```

Refer to `.env.example` for a comprehensive list of all optional configuration variables, including RCON, email services, Valkey, OAuth providers, and PayPal integration.

### 4. Run CMS Migrations

```bash
# pnpm
pnpm db:migrate

# npm
npm run db:migrate

# yarn
yarn db:migrate
```

Creates all CMS-owned tables (`website_*`, `radio_*`, `acl_*`, `admin_audit_log`, etc.) via idempotent SQL files in `drizzle/migrations/`. Emulator tables are never touched.

### 5. Build & Start

```bash
# Development (hot reload)
pnpm dev      # or: npm run dev / yarn dev

# Production
pnpm build && pnpm start       # or: npm run build && npm start
```

Open `http://localhost:3002` in your browser.

> Always go through these scripts. `next build` is refused outright when it is
> not running under the memory cap — see
> [Memory-capped commands](#memory-capped-commands).

### 6. First Login

1. Register an account at `/register`, or log in with an existing emulator account.
2. Grant yourself admin access: `UPDATE users SET rank = 7 WHERE username = 'yourname';`
3. Visit `/admin` and configure your hotel via **Admin → CMS Settings**.

---

## Docker Deployment

The CMS ships with a multi-stage Dockerfile that automatically detects your package manager (pnpm, npm, or yarn) based on which lockfile is present. The **CMS** runs in Docker; the Nitro/Octane client stays outside and is served by nginx on the host. The server-side **avatar imager** also runs in its own Docker container (`avatar-imaging-pixinode`, port 8082) — see [Avatar Imaging](#avatar-imaging).

### Prerequisites

- Docker 24+ and Docker Compose v2
- `.env` file configured (see step 3 above)
- A MySQL/MariaDB database reachable from the container (`DATABASE_URL` host should point to the DB server, not `127.0.0.1` unless it's reachable from inside the container)
- (Optional) A shared `Gamedata` directory at `/var/www/gamedata` with write access (see [Volumes](#volumes) below)

### Quick Start with Docker

```bash
# 1. Clone and configure
git clone https://gitlab.epicnabbo.nl/remco/EpicNext-Cms.git
cd EpicNext-Cms
cp .env.example .env
# Edit .env with your database credentials and settings.
# The container runs on the host network, so all 127.0.0.1 references
# (DATABASE_URL, REDIS_URL, RCON, imaging) keep pointing at the host as-is.

# 2. Stop any existing host-side CMS that occupies port 3002 (if present).
pm2 stop next 2>/dev/null || true

# 3. Ensure the write directories are owned by www-data (UID/GID 33) so the
#    container user can write imports/uploads to them.
sudo mkdir -p ./public/nitro-assets ./public/swf ./storage /var/www/gamedata
sudo chown -R 33:33 ./public/nitro-assets ./public/swf ./storage /var/www/gamedata

# 4. Build, migrate and start a release tied to the Git commit.
# Requires Linux, Bash, Git, flock and Docker Compose v2; no host Node/pnpm.
bash scripts/docker-update.sh

# 5. Follow logs
docker compose logs -f cms
```

The CMS listens on port 3002 using Linux host networking. Existing database,
Redis, emulator and shared gamedata services must already be configured.
Create the mounted directories before installation; do not mount the checkout,
`.next` or `node_modules` over `/app` inside the production container.

### Updating a Docker clone

From your clone, run:

```bash
# Also verifies that your public domain serves the expected commit:
CMS_PUBLIC_URL=https://your-hotel.example bash scripts/docker-update.sh
```

The script follows the **current branch's configured Git upstream**. It refuses
local uncommitted/untracked work, pulls fast-forward only and restarts itself if
the updater changed. It does not reset or delete local work. Configure the
upstream to your fork/branch if that is where you receive updates.

It builds a commit-tagged image and runs migrations in the matching builder
container, using the clone's `.env`; no host dependency installation is needed.
Only after build and migrations succeed does it recreate the CMS service. It
compares the running image ID, image revision and `/cms_api/health` release with the
expected Git commit. With `CMS_PUBLIC_URL`, it also checks the domain through
your proxy/CDN. A healthy response from another release is an error.

`git pull` alone updates source files, not an existing container. `docker compose
restart` restarts the same image. `docker compose pull` downloads registry images;
it does not fetch changes to this Git-built CMS. Use the updater for releases.
A clone does **not** install an automatic scheduler. If desired, explicitly add a
cron entry with the absolute path of **your** checkout; keep logs in its `logs`
directory. Do not configure both CI and Compose updates for the same instance.
On a CI-managed host (either slot container running, or the nginx upstream
pointing at a blue/green slot) the updater skips with exit 0, so a cron run
that legitimately has nothing to do does not look like a failed deployment.

Logs: `logs/docker-update.log`. After cutover, a startup, image or HTTP check
failure automatically recreates the CMS with its previous image and verifies its
local HTTP release and database health. The command still returns nonzero: a
rollback is not a successful update. Recovery uses the current Compose configuration
and `.env`; it restores application code, not configuration edits or database migrations.
The previous image must carry a valid release label. First installations have no
previous release: a failed candidate remains available for diagnosis. A failed
rollback is explicitly logged with a retained `epicnext-cms:rollback-...` recovery tag.
Public routing must be checked separately after rollback. SIGKILL or host power loss
cannot run the rollback handler.

After success, the updater keeps the two most recent distinct releases tracked in
`logs/docker-release-history.log`. Cleanup only removes older recorded CMS image
tags, without force; images referenced by other containers (including stopped ones)
are preserved and retried on later updates. Untracked historical images, build cache,
other services and persistent volumes are not pruned. Retain the history file between
updates. Before production migrations, retain your normal database backup.

### Portable images on the Gitea registry

Docker builds no longer load your installation's `.env`. The builder uses disposable
fixture values; the runtime reads `HOTEL_NAME`, `APP_URL`, `AUTH_SECRET`, database and
asset settings when the container starts. Missing/invalid required runtime values
stop startup with the setting names, without printing credentials.

Configure `IMAGER_URL` with the actual avatar renderer endpoint and `BADGE_URL` with
the badge directory URL (or a local path). The legacy `NEXT_PUBLIC_IMAGER_URL` and
`NEXT_PUBLIC_BADGE_URL` names remain supported at runtime. If the imager points back
to the CMS `/imaging` proxy, set `IMAGING_UPSTREAM_URL` to the actual renderer to avoid
a loop. With no imager configured, the CMS uses Habbo's public renderer. Client
requests use the existing `/cms_api/imaging/avatar` proxy. Admin badges preserve their
local `/swf/c_images/album1584` fallback. Public URL resolution uses runtime `APP_URL`.
After changing `.env`, recreate the container; an image rebuild is not required.
`NEXT_PUBLIC_CMS_RELEASE` deliberately remains compiled into the image.

### Guided installation from this repository

On a Linux host with Docker Engine, the Compose plugin, Git and `flock` available:

```bash
git clone https://gitlab.epicnabbo.nl/remco/EpicNext-Cms.git
cd EpicNext-Cms
bash cms install
```

The wizard asks for your public URL, delivery method, hotel name, existing database
connection, Redis and avatar imager. It generates an authentication secret and
creates `.env` with private permissions. An existing `.env` is preserved; review
its `APP_URL`, `AUTH_URL`, RCON and optional original Laravel `APP_KEY` when moving
an existing hotel. This installs the CMS, not the Habbo database, emulator, Redis
or reverse proxy. Point HTTPS at port 3002 before running the final public check.
The wizard may request sudo to prepare persistent directories for UID/GID 33;
it does not recursively change ownership of existing assets.

Choose **prebuilt** to download the images specified by this repository in
`docker-image.txt`, without entering a registry namespace or commit tag. Choose
**source** when building your own fork on the installation host. Private packages
still require `docker login` on that host. Maintainers must update `docker-image.txt`
if the publication registry or namespace changes.

After installation, update with:

```bash
bash cms update
```

The updater pulls the configured Git upstream, loads `.docker-install`, uses the
matching application/migration images and verifies the running release locally
and at the saved public URL. Existing application rollback remains available on a failed cutover;
database migrations are not reversed.

`bash cms install --configure-only` saves configuration without preparing runtime
directories or starting containers. Neither `.env` nor `.docker-install` is
committed or sent in Docker build contexts. Existing users of
`bash scripts/docker-update.sh` retain the previous behavior when no wizard
profile exists; explicit `CMS_IMAGE_REPOSITORY`/`CMS_PUBLIC_URL` overrides still work.

Container publication is disabled. CI builds, checks and deploys the CMS, but it does not log in to a registry or upload container images.

### Diagnose an update that is not visible

```bash
git rev-parse HEAD
docker inspect --format '{{.Image}}' epicnext-cms
docker inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' epicnext-cms
curl -fsS http://127.0.0.1:3002/cms_api/health
curl -fsS https://your-hotel.example/cms_api/health
```

Both HTTP responses must report the expected `release`. `unknown` means the image
was built without a commit ID. If the local endpoint is current but the public
one is old, check nginx's upstream, other CMS processes and proxy/CDN caching.
Health responses must not be cached. The release is compiled into Next.js and
cannot be changed simply by injecting a new variable into an old container.

### Docker commands

| Command                         | Purpose                                   |
| ------------------------------- | ----------------------------------------- |
| `bash scripts/docker-update.sh` | Pull, build, migrate, recreate and verify |
| `docker compose logs -f cms`    | View CMS logs                             |
| `docker compose exec cms sh`    | Open a shell in the running CMS           |
| `docker compose restart cms`    | Restart the existing release              |
| `docker compose down`           | Stop services; does not update code       |
| `pnpm db:up` / `pnpm db:down`   | Manage the optional MariaDB service       |

For a manual build, export `CMS_RELEASE=$(git rev-parse HEAD)` before
`docker compose build cms`; deployment and migration verification remain your
responsibility. Docker uses the committed pnpm lockfile and pinned Node version.
The build cache can stay enabled: copying changed source invalidates the
application build layer. Deleting all Docker cache is not an update mechanism.

#### Build toolchain and cache

The image never installs a pinned pnpm of its own. The Dockerfile installs
[corepack](https://nodejs.org/api/corepack.html) and lets it resolve the pnpm
version _and_ its sha256/sha512 hash from the `packageManager` field in
`package.json`. One pin therefore drives the Docker build, the CI runner and
the host — the image can no longer drift away from the lockfile, and a tampered
package tarball is rejected instead of silently installed. Bumping pnpm is a
single edit in `package.json` (plus the README version table, checked by
`pnpm readme:versions:check`).

Two caches make repeated builds cheap:
- **pnpm store** — a BuildKit cache mount on `$PNPM_HOME/store` keeps the
  downloaded packages between builds. A lockfile change then re-uses the store
  (`reused 493, downloaded 0`) instead of re-downloading every package.
- **Local build cache** — `docker compose build` exports the build cache to
  `.docker-cache/cms` and imports it again on the next build. Unlike the
  daemon's own cache, this survives `scripts/docker-prune.sh`, which trims the
  daemon cache to 4 GB after every deploy. The directory is ignored by both
  Git and the build context; delete it to force a cold build.

The CI has the same problem on a bigger scale: the runner workspace is wiped
after every job and `scripts/docker-prune.sh` trims the daemon cache after
every release, so the next build started with an empty cache and downloaded all
493 packages again (measured: `reused 0, downloaded 493`). `scripts/ci-deploy.sh`
and `scripts/ci-preflight.sh` therefore export the build cache to a directory
outside the workspace — `/var/cache/epicnext-cms-buildcache` for the release and
`/var/cache/epicnext-cms-preflight-cache` for branch preflights, so a branch can
never feed the release cache. With that export in place the same build re-uses
the frozen dependency layer (`reused 493, downloaded 0`) even after a full
`docker builder prune`. Set `CMS_BUILD_CACHE_DIR` to another path to move the
cache, or to an empty value to switch it off.

The build context excludes `e2e/` and `integration/`. `next build` type-checks
the whole project, so shipping the test suites inside the image made a type
error in test code break the image build and pulled `@playwright/test`, `vitest`,
`msw` and `testcontainers` into it. The CI runs those suites on the host
(`pnpm test:ui`, `pnpm test:integration`).

### Volumes

Only the CMS (and the optional avatar imager container, see [Avatar Imaging](#avatar-imaging)) run in Docker. The heavy client assets and gamedata stay on the host and are shared into the container so imports and uploads persist:

| Container Path             | Host Path               | Mode | Purpose                               |
| -------------------------- | ----------------------- | ---- | ------------------------------------- |
| `/app/public/nitro-assets` | `./public/nitro-assets` | rw   | Imported furni/pet/effect assets      |
| `/app/public/swf`          | `./public/swf`          | rw   | SWF costumes / icons (imports)        |
| `/app/storage`             | `./storage`             | rw   | Uploaded media (persistent)           |
| `/var/www/gamedata`        | `/var/www/gamedata`     | rw   | Shared gamedata root (hardcoded path) |

**About the hardcoded `/var/www/gamedata` path:** `src/lib/services/furni-asset-dirs.ts` defines `DEFAULT_GAMEDATA_ROOT = /var/www/gamedata` as an absolute on-disk path the CMS reads and mirrors imported assets into. The compose file mounts the host `/var/www/gamedata` at the identical path inside the container so `existsSync('/var/www/gamedata')` succeeds and nginx keeps serving `/gamedata/` from the same directory.

**The Nitro/Octane client and renderer are NOT mounted** — nginx on the host serves them directly:

| Component           | Host path                | How it's served                                                                                   |
| ------------------- | ------------------------ | ------------------------------------------------------------------------------------------------- |
| Nitro/Octane client | `/var/www/Octane/dist`   | nginx `location ^~ /client/` and `/nitro-client/` alias                                           |
| Avatar imager       | `/docker/Polaris-imager` | Docker container `avatar-imaging-pixinode` on port `8082` — see [Avatar Imaging](#avatar-imaging) |
| Camera uploads      | `/var/www/Camera`        | nginx `/camera/` alias                                                                            |

**Container user & write permissions:** the CMS container runs as `www-data` (UID/GID 33) by default to match the host owner of `/var/www/gamedata`. Ensure the other write volumes (`./public/nitro-assets`, `./public/swf`, `./storage`) are also owned by `www-data` on the host:

```bash
sudo mkdir -p ./public/nitro-assets ./public/swf ./storage /var/www/gamedata
sudo chown -R 33:33 ./public/nitro-assets ./public/swf ./storage /var/www/gamedata
sudo chmod -R o+rX ./public/nitro-assets ./public/swf ./storage
```

If your host user UID differs, override the run user at build time (defaults to `www-data`, which already exists in the base image with UID/GID 33):

```bash
docker compose build --build-arg RUN_USER=1000
```

### Networking

The CMS container runs with `network_mode: host`. This lets the existing `127.0.0.1` references in `.env` keep working against host services — MariaDB (`3306`), Valkey/Redis (`6379`), the emulator RCON/API (`3003`/`3001`) and the avatar imager — without re-writing any environment variables. The container consequently listens **directly on the host's port 3002**, so stop any previous host-side CMS (e.g. `pm2 stop next`) that occupies that port before starting it.

The **build** deliberately does _not_ use host networking. BuildKit (v0.26, Docker 29)
refuses to grant host networking unless every caller passes
`--allow=network.host`, and `docker compose build` has no such flag — asking for
`build.network: host` therefore turned every rebuild into an immediate
"additional privileges requested" failure. The build only needs outbound
internet (apk, corepack/pnpm, next/font/google), which the default bridge
provides.

### Health Check

The container includes a health check that hits `/cms_api/health` on port 3002 every 30 seconds (and reports DB/Redis/emulator status). Check status with:

```bash
docker inspect --format='{{.State.Health.Status}}' epicnext-cms
```

### MariaDB Turbo (bulk loads)

`docker-compose.yml` ships an opt-in **`mariadb-turbo`** service — a dedicated MariaDB 11 container tuned for loading >50 MB JSON dumps (furnidata, external texts, etc.). It configures itself via mysqld flags on the `command:`, so no external `.cnf` file has to be mounted or kept in sync:

```bash
pnpm db:up        # docker compose --profile db up -d (starts mariadb-turbo)
```

Key settings (see the `command:` block in `docker-compose.yml`):
- `max_allowed_packet = 512M` — 50 MB JSON batches no longer hit the 16 MB packet ceiling.
- `innodb_flush_log_at_trx_commit = 2` + `innodb_doublewrite = 0` — durability relaxed for bulk writes.
- `innodb_buffer_pool_size = 2G`, `innodb_log_file_size = 1G`, `bulk_insert_buffer_size = 512M`.
- `net_read_timeout` / `net_write_timeout = 600`, `wait_timeout = 3600` — fixes the `drizzle-kit` **"Pulling schema from database..."** hang by never starving introspection/DDL sessions behind a long import.
- `performance_schema = OFF` — saves ~1-2 GB RAM.

The datadir lives in a **named volume** (`mariadb-turbo-data`), never a host bind-mount: shared-filesystem sync trashes InnoDB files the same way it corrupts pnpm's `node_modules`. Named volumes stay inside the container filesystem, so 50 MB of JSON writes never cross a host-sync boundary.

> **Port note:** the service uses `network_mode: host` and binds `127.0.0.1:3306` — stop the host MariaDB first, otherwise the port collides with the standalone `.env` `DATABASE_URL` (`localhost:3306`).

#### node_modules & host-sync corruption

pnpm's store is hard-linked and its `.bin` shims are symlinks, so **node_modules must never be a host bind-mount** (Docker Desktop gRPC-FUSE/VirtioFS, Unison and Syncthing all corrupt it). The production build bakes `node_modules` into the image at build time; it is never bind-mounted. For local dev, mount a _named volume_ (`node_modules:/app/node_modules`) instead of the host directory, and keep `node_modules` / the pnpm store out of any shared-filesystem bind.

#### Loading a 50 MB JSON dump

```bash
# Habbo furnidata (auto-detects roomitemtypes / wallitemtypes / effecttypes)
pnpm db:bulk --file=/var/www/gamedata/config/FurnitureData.json

# Flat array of documents → generic JSON store
pnpm db:bulk --file=/data/products.json --table=docs --category=furni

# Key/value texts
pnpm db:bulk --file=/data/external_texts.json --table=texts --category=default
```

The importer (`scripts/bulk-import-json.ts`) maps rows onto `src/db/schema-gamedata.ts`, batches them into **2000-row multi-row INSERTs** (one statement per chunk), uses `ON DUPLICATE KEY UPDATE` so re-runs are idempotent and interrupted loads resume, and prints rows/s + ETA. See ["ORM Setup & Type Generation"](#orm-setup--type-generation) → _Bulk JSON storage_ for the design.

---

## ORM Setup & Type Generation

### Drizzle ORM (Primary Data Layer)

Drizzle ORM is the runtime data layer. The connection is a singleton in `src/lib/db.ts`:

```ts
import { db } from "@/lib/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm/expressions";

const found = await db.select().from(users).where(eq(users.username, "hello"));
```

**Drizzle CLI** (`drizzle-kit`) is used for local development tasks — it is a devDependency and is never bundled in production.

| Command                   | What it does                                                                            |
| ------------------------- | --------------------------------------------------------------------------------------- |
| `pnpm db:generate`        | Draft SQL from Drizzle schema into `drizzle/drafts/` (review + copy)                    |
| `pnpm db:studio`          | Open Drizzle Studio (dev only)                                                          |
| `pnpm db:introspect`      | Reverse-engineer an existing DB into a Drizzle schema draft                             |
| `pnpm db:bulk`            | Batch-import >50 MB JSON (2000-row chunks, resumable) via `scripts/bulk-import-json.ts` |
| `pnpm db:schema:generate` | Regen committed `src/db/schema.ts` from previous schema + live DB                       |

> The CMS does **not** use `drizzle-kit push` or `drizzle-kit migrate` — the database is shared with the emulator. Apply CMS DDL only via `pnpm db:migrate`.

#### Bulk JSON storage (MariaDB)

Emulator/hotel JSON dumps (furnidata, external texts, product data) are often >50 MB. MariaDB's `JSON` type is an alias for `LONGTEXT` and can **never be indexed directly**, so `src/db/schema-gamedata.ts` follows the "promote + index" pattern:
- The raw JSON document stays intact in a `longtext` / `mediumtext` column (`payload`, `value`).
- The fields you actually `WHERE` / `ORDER BY` on are promoted into real columns (`sprite_id`, `class_name`, `kind`, `title`, `text_key`) and indexed.
- Optional **VIRTUAL generated columns** extract indexed fields from the payload with `JSON_EXTRACT` (MariaDB supports secondary indexes on virtual columns, 10.2+), so no duplicate data has to be written by the importer.

Three tables are exported:

| Table                | Purpose                                                      | Unique key             |
| -------------------- | ------------------------------------------------------------ | ---------------------- |
| `gamedata_furnidata` | One row per furni/clothing item (habbo furnidata_json shape) | `(source, sprite_id)`  |
| `gamedata_docs`      | Generic JSON document store (per-key documents)              | `(category, doc_key)`  |
| `gamedata_texts`     | External-texts style key/value pairs                         | `(category, text_key)` |

The bulk importer (`scripts/bulk-import-json.ts`, run via `pnpm db:bulk`) is DB-driven and fast precisely because each chunk is a _single_ multi-row `INSERT … VALUES () ()… ON DUPLICATE KEY UPDATE`, so a 50 MB dump is a few dozen statements instead of hundreds of thousands of round-trips. Flags:

| Flag             | Default      | Description                                    |
| ---------------- | ------------ | ---------------------------------------------- |
| `--file=<path>`  | — (required) | JSON file (habbo furnidata_json or flat array) |
| `--table=<name>` | `furnidata`  | One of `furnidata` \| `docs` \| `texts`        |
| `--source=<x>`   | `habbo`      | `source` value for `furnidata`                 |
| `--category=<x>` | `default`    | `category` value for `docs` / `texts`          |
| `--chunk-size=N` | `2000`       | Rows per multi-row INSERT                      |
| `--limit=N`      | `0`          | Stop after N rows (dry-test)                   |
| `--truncate`     | off          | DELETE rows for this source/category first     |

The script sets `FOREIGN_KEY_CHECKS=0` for the session and is safe to interrupt: each chunk commits on its own, and `ON DUPLICATE KEY UPDATE` makes re-runs overwrite instead of appending.

---

## Valkey (Caching, Rate Limiting, SSE)

Valkey is a drop-in, Redis-compatible open-source in-memory datastore (successor to Redis OSS). The CMS connects to it via `REDIS_URL` using the `ioredis` client. It is optional: without it the CMS falls back to in-memory memory.

### Install (Ubuntu/Debian)

```bash
# Option 1: Package repository (recommended)
curl -fsSL https://packages.valkey.io/valkey-pgp-key.gpg | sudo gpg --dearmor -o /usr/share/keyrings/valkey-archive-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/valkey-archive-keyring.gpg] https://packages.valkey.io/apt $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/valkey.list
apt-get update && apt-get install -y valkey

# Option 2: Direct .deb download
curl -fsSL -o /tmp/valkey_amd64.deb \
  https://github.com/valkey-io/valkey/releases/download/8.1.1/valkey_8.1.1-1_amd64.deb
apt-get install -y /tmp/valkey_amd64.deb

systemctl enable --now valkey
```

### Configure

Edit `/etc/valkey/valkey.conf`:

```ini
bind 127.0.0.1
port 6379
maxmemory 2gb
maxmemory-policy allkeys-lru
```

### Point the CMS at it

```dotenv
REDIS_URL=redis://127.0.0.1:6379?connect_timeout=2
```

Verify via `/cms_api/health` — it should report `"redis": true`.

---

## Nginx Configuration

The CMS is designed to run behind an nginx reverse proxy. Below is a reference configuration.

### Prerequisites

- SSL certificates in `/etc/ssl/cert.pem` and `/etc/ssl/key.pem` (or use Let's Encrypt)
- CMS running on `127.0.0.1:3002`

### Reference Configuration

```nginx
proxy_cache_path /var/cache/nginx/html_cache levels=1:2 keys_zone=html_cache:50m max_size=500m inactive=10m use_temp_path=off;

server {
    listen 80;
    server_name yourdomain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    http2 on;
    server_name yourdomain.com;

    ssl_certificate /etc/ssl/cert.pem;
    ssl_certificate_key /etc/ssl/key.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    client_max_body_size 20m;

    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    location / {
        proxy_pass http://127.0.0.1:3002;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_cache html_cache;
        proxy_cache_valid 200 60s;
        proxy_ignore_headers Vary;
        proxy_cache_use_stale error timeout updating http_500 http_502 http_503 http_504;
        add_header X-Cache-Status $upstream_cache_status always;
    }

    location /cms_api/ {
        proxy_pass http://127.0.0.1:3002;
        add_header Cache-Control "no-cache, no-store, must-revalidate";
    }

    location /_next/static/ {
        proxy_pass http://127.0.0.1:3002;
        add_header Cache-Control "public, max-age=31536000, immutable";
    }

    location /imaging/ {
        proxy_pass http://127.0.0.1:8082/;
        proxy_set_header Connection "";
        proxy_http_version 1.1;
        add_header Cache-Control "public, max-age=300";
    }

    location /health {
        access_log off;
        return 200 "OK";
        add_header Content-Type text/plain;
    }
}
```

> **`/imaging` trailing-slash gotcha:** `location /imaging` (no trailing slash) combined with `proxy_pass http://…8082/;` rewrites `/imaging/avatarimage` into `//avatarimage` and 404s. Always use `location /imaging/` + a trailing-slash `proxy_pass` so `/imaging/avatarimage` reaches the imager's `/avatarimage` route.

---

## Avatar Imaging

Avatar images (profile figures, chat badges, forum avatars, admin previews) are rendered server-side by **Polaris-imager** ([duckietm/Polaris-imager](https://github.com/duckietm/Polaris-imager)) — a headless Nitro/Octane renderer that runs `@pixi/node` (real WebGL via `gl` + Xvfb) inside a Docker container named **`avatar-imaging-pixinode`**. It serves `GET /avatarimage?figure=…` on port **8082** and can emit PNG/APNG/GIF, gestures, actions, scenes and more.

### Request flow

```
browser → Cloudflare → (page rule /origin for /imaging/*) → host:8082
browser → nginx origin → location /imaging/ → 127.0.0.1:8082/avatarimage
```

URLs look like `https://<hotel>/imaging/avatarimage?figure=hd-180-1.ch-210-66&img_format=png&size=l&direction=4`. The public `NEXT_PUBLIC_IMAGER_URL` points at that endpoint (see `src/lib/imager.ts`). Responses carry `Cache-Control: public, max-age=300`, so browsers and Cloudflare reuse a render for 5 minutes.

### Requirements (host)

- Docker (daemon with BuildKit; the CMS build runs on the default bridge, not on host networking — see [Networking](#networking)).
- An nginx that serves `/gamedata/` (FigureData/FigureMap/EffectMap…) and `/gamedata/bundled` (furniture bundle assets — `.hab` by default, the extension imports write and this deployment's client requests, plus any legacy `.nitro` still on disk; choose the written extension with `FURNI_BUNDLE_EXT`) over HTTP so the renderer can fetch them. The compose file points at `host.docker.internal:8081`.

### Configuration — `/docker/Polaris-imager/.env`

```dotenv
NITRO_GAMEDATA_URL=http://host.docker.internal:8081/gamedata/config
NITRO_ASSET_URL=http://host.docker.internal:8081/gamedata/bundled
AVATAR_IMAGING_FPS=12
AVATAR_IMAGING_MAX_FRAMES=60
AVATAR_IMAGING_HOST=0.0.0.0
AVATAR_IMAGING_PORT=8082
AVATAR_IMAGING_RATELIMIT_MAX=600
AVATAR_IMAGING_SCENE=1
AVATAR_IMAGING_WARDROBE=1
AVATAR_IMAGING_HABBO_FONTS=1
AVATAR_IMAGING_CHAT_BUBBLES=1
AVATAR_IMAGING_HOTEL_URL=https://<hotel>
AVATAR_IMAGING_HOTEL_NAME=<hotel>
```

### Build & start

The image is self-contained — the `Dockerfile` clones the pinned Nitro/Octane renderer and runs the full `yarn`/`vite` bundle at build time, then produces a slim Debian runtime with Xvfb + Mesa software rendering:

```bash
cd /docker/Polaris-imager
docker compose build
docker compose up -d        # container: avatar-imaging-pixinode
docker logs -f avatar-imaging-pixinode   # expect: "listening on http://0.0.0.0:8082"
```

The container runs `restart: unless-stopped` and ships a healthcheck that probes `/health` (reports `{ "ready": true }` once the headless renderer has booted). Verify a render:

```bash
curl -o avatar.png 'http://127.0.0.1:8082/avatarimage?figure=hr-893-45.hd-600-1.ch-255-66.lg-280-110.sh-295-62&img_format=png&size=l'
```

A production issue that this section documents: **the `avatar-imaging-pixinode` image can be removed by a `docker image prune`**, which used to take the whole site's avatars offline (502 on `/imaging/*`). Keep the image tagged and re-build it via the commands above if it ever disappears (`docker compose build && docker compose up -d`).

### Automatic upstream fallback

Since then the CMS-side avatar proxies (`/cms_api/imaging/avatar` and `/imaging`) are resilient: when the configured upstream (the Polaris container on `8082`) fails or times out, the request is retried against Habbo's public renderer (`https://www.habbo.com/habbo-imaging/avatarimage`), with the `effect` parameter stripped and `img_format` forced to `png`, since the public renderer supports neither. The response is then marked with `X-Imager-Source: primary|fallback` and a shorter `Cache-Control` TTL when served from fallback, so the configured imager is retried soon instead of being masked for hours. No fallback is attempted when the configured upstream already is the Habbo public renderer. As a last line of defence every avatar `<img>` on the site falls back to a grayscale silhouette placeholder instead of a broken-image glyph.

### Figure string validation

The URL builder (`src/lib/imager.ts`) and the proxy routes share one rule set
(`src/lib/avatar-figure.ts`): a figure must look like `part-id` segments
separated by dots (`hd-180-1.ch-210-66`). Some clients append extra segments the
renderer still accepts (e.g. a trailing `.0`), so the pattern is deliberately
loose; over-strict validation once turned valid avatars into 400s.

Before a URL is built, the stored look is normalised: anything the imager would
reject — an empty part slot such as the legacy `hr-100-.hd-180-1` default, a
path-traversal attempt, an over-long value — is replaced with
`DEFAULT_AVATAR_FIGURE`. That stops legacy accounts from rendering broken
avatars without weakening the route, which still answers `400` to a malformed
figure (`src/app/cms_api/imaging/avatar/route.ts`).

---

## Performance Tuning (production)

The CMS shares its MySQL/MariaDB database with the emulator, so the hot wins come from caching, asset serving and database knob-tuning — not from a storage-engine migration.

### 1. gzip_static pre-compression of gamedata JSON

The client downloads `FurnitureData.json` (~48 MB, one file per supported language) plus other large JSON from `/gamedata/`. nginx has `gzip` and `gzip_static on` (see `/etc/nginx/nginx.conf`), but with no pre-built `.gz` file it re-compressed the 48 MB **on every request** (~0.25–0.30 s of CPU per miss).

`scripts/compress-gamedata.mjs` pre-compresses every JSON >1 MB in `<Gamedata>/config` and `<Gamedata>/bundled/config` once (gzip level 9): `FurnitureData*.json` go from ~48 MB to ~2.4 MB (~95 % smaller). It is idempotent — a file is only re-compressed when the source mtime is newer than its `.gz` (e.g. after a Studio catalog export).

```bash
pnpm gamedata:compress    # manual run
```

Once the `.gz` exists, nginx `gzip_static` serves it straight from disk with `Content-Encoding: gzip` and effectively zero CPU. **Measured result on the production origin: 0.25–0.30 s → ~0.005 s per file.**

The production host runs the script on a cron so newly exported catalogs are compressed shortly after they land:

```bash
crontab -e
# */15 * * * * node /var/www/atom-nexst/scripts/compress-gamedata.mjs >> /var/www/atom-nexst/logs/gamedata-compress.log 2>&1
```

### 2. MariaDB tuning

The whole `habbo` datadir is roughly 0.5 GB; the default InnoDB buffer pool (128 MB) pushed index/row reads to disk. The pool is raised to **4 GB** and the slow-query log is enabled (threshold 2 s), both live (`SET GLOBAL …`) and persisted for boot in `/etc/mysql/mariadb.conf.d/zz-cms-performance.cnf`:

```ini
[mysqld]
innodb_buffer_pool_size = 4G
slow_query_log = 1
long_query_time = 2
slow_query_log_file = /var/log/mysql/mariadb-slow.log
```

The slow-query log surfaces hot-spot SQL for a follow-up index/query audit. The CMS connection pool itself is already tuned (pool size 25, `connection_limit` in `DATABASE_URL`).

For bulk-written tables (game-data JSON, imports) a containerized **`mariadb-turbo`** variant is available — see [MariaDB Turbo](#mariadb-turbo-bulk-loads).

### 3. Asset caching headers

| Path                          | Cache-Control                                            |
| ----------------------------- | -------------------------------------------------------- |
| `/swf/**`, `/nitro-assets/**` | `public, max-age=604800, stale-while-revalidate=2592000` |
| `/gamedata/**`, `/client/**`  | `public` + `expires 7–30 d` (nginx)                      |
| `/imaging/*`                  | `public, max-age=300`                                    |
| `/camera/**`                  | `public, max-age=31536000, immutable`                    |
| `/_next/static/**`            | `public, max-age=31536000, immutable`                    |

### 4. Cache layers (Redis + CDN)

The CMS caches through `cached()` / `cachedQuery()` (`src/lib/cache.ts`): an in-memory fast path with a Redis (Valkey-compatible) fallback and single-flight protection against cache stampedes. Public API routes (home, leaderboard, online count, radio, photos, …) fill Redis keys per route; verify with `redis-cli DBSIZE`. With Cloudflare in front, static and `/imaging/*` responses are additionally cached edge-side (`cf-cache-status`), cutting origin load further.

#### nginx micro-cache (edge of the origin)

A short-lived nginx cache sits in front of the origin for an explicit whitelist of
public API reads. It is configured in `/etc/nginx/sites-enabled/cms.conf` and its
backends come from `/etc/nginx/snippets/cms_upstream_servers.conf`.

Why nginx and not the app: Next.js emits
`private, no-cache, no-store, max-age=0, must-revalidate` for dynamic route
handlers, and its response helper then drops the `Cache-Control` set by
`publicCacheControl()`. Every one of the whitelisted routes was verified to be
free of `auth()`, `cookies()`, `headers()` and request data, so the edge may
cache them on their behalf.

| Class | Endpoints                                                                                                                                     | TTL  |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| 1     | `/cms_api/online`, `/cms_api/online/count`                                                                                                            | 10s  |
| 2     | `/cms_api/photos`, `/cms_api/leaderboard`, `/cms_api/radio/current-dj`, `/cms_api/radio/points/leaderboard`                                                   | 60s  |
| 3     | `/cms_api/staff`, `/cms_api/teams`, `/cms_api/guilds`, `/cms_api/shop`, `/cms_api/shop/categories`, `/cms_api/values`, `/cms_api/values/categories`, `/cms_api/values/[0-9]+` | 300s |

`/cms_api/radio/shouts` is intentionally excluded: it is live chat.

Three details are easy to get wrong and are worth keeping intact:
- **`proxy_ignore_headers "Cache-Control" "Vary";` is what makes the cache work.**
  `proxy_hide_header` only strips the header from the response to the client; the
  cache module has already read the upstream's `no-store` by then and stores
  nothing. Ignore the upstream directive and let nginx emit a single
  `Cache-Control` of its own.
- **`$upstream_status` is empty on a cache HIT** — it is only populated on a MISS.
  The header map therefore matches both `|2` and the empty-status form, so HITs
  get the same class as the MISS that stored them. A status-gated map alone sends
  every HIT down the `default` branch and quietly returns `private`.
- **A session must never be advertised as `public`.** With a session cookie nginx
  already refuses to store the response (`proxy_no_cache`), but without the skip
  flag in the header map the response would still claim `public, s-maxage=...` and
  Cloudflare could share it. The map keys on
  `"$cms_cc_class|$cms_skip_cache|$upstream_status"`.

HTML is deliberately **not** cached: `src/app/(site)/page.tsx` performs `auth()`
with a redirect to `/me` and reads `headers()` for a per-request CSP nonce.

### Files changed for stability and caching

| File                                                                                                     | Change                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/etc/nginx/nginx.conf`                                                                                  | `worker_connections 4096`, `multi_accept on`, TLS 1.2/1.3 only, `proxy_cache_path` for the micro-cache                                                                        |
| `/etc/nginx/sites-enabled/cms.conf`                                                                      | single correct `Cache-Control` per path, micro-cache on the whitelist, session/Authorization bypass, SSE block with buffering off, `upstream cms_app` + `proxy_next_upstream` |
| `/etc/nginx/snippets/cms_upstream_servers.conf`                                                          | backend list, rewritten by `ci-deploy.sh` during a cutover                                                                                                                    |
| `src/app/cms_api/online/count/stream/route.ts`                                                               | `X-Accel-Buffering: no`                                                                                                                                                       |
| `src/app/cms_api/radio/stream/route.ts`                                                                      | `X-Accel-Buffering: no`                                                                                                                                                       |
| `src/app/cms_api/admin/import/{audit,furni/route,furni/batch,furni/batch-regen,furni/repair-icons}/route.ts` | `X-Accel-Buffering: no`                                                                                                                                                       |
| `src/app/cms_api/admin/studio/nitro-cleanup{,/rebuild}/route.ts`                                             | `X-Accel-Buffering: no`                                                                                                                                                       |
| `scripts/ci-deploy.sh`                                                                                   | resource limits, blue/green cutover, `switch_upstream`, rollback split by cutover state                                                                                       |
| `deploy.sh`                                                                                              | reduced to a wrapper around `ci-deploy.sh`                                                                                                                                    |
| `docker-compose.yml`                                                                                     | two replica services from a shared anchor, resource limits, port-aware healthcheck, dead `mariadb-turbo` removed                                                              |
| `src/lib/services/cache-warmup.ts`                                                                       | corrected a comment that described delays the code never had                                                                                                                  |
| `src/lib/ci-deploy.test.ts`, `src/test/ci-deploy-harness.sh`                                             | blue/green coverage; nginx paths are injectable so the in-place path stays tested                                                                                             |
| `ecosystem.config.cjs`                                                                                   | removed (PM2 supervised no process, and nothing referenced it)                                                                                                                |

> The nginx files live on the host only, not in this repository. Rebuilding the
> host loses the cache configuration — keep a copy under version control if that
> becomes a real risk.

---

## Cloudflare & Anti-DDoS Protection

Two layers work together to keep the origin alive during misuse, floods, and
repeat-offender attacks:
1. **App-layer gate** (production only) — per-IP request buckets per category
   (pages / API / auth), a whole-site safety valve, and escalation tiers that
   temporarily hard-block offending IPs (`src/lib/ddos-guard.ts`).
   `/cms_api/health` is always exempt so the Docker liveness probe never trips it.
2. **Automatic Cloudflare edge blocks** (optional, works on every Cloudflare
   plan including Free) — when the gate hard-blocks an IP, the CMS mirrors the
   block to the zone's **IP Access Rules** (`src/lib/cloudflare-api.ts`), so a
   repeat offender is dropped at the Cloudflare edge before it reaches your
   server. Blocks expire together with the gate's tiered block (a 30s sweep
   removes them; see `src/instrumentation.ts`).

### Prerequisites

- The domain must actually be **proxied through Cloudflare** (orange cloud) —
  automatic edge rules can only stop traffic that transits the edge. Restrict
  direct access to the origin ports (e.g. only allow your server IP(s),
  Cloudflare IPs, or swap the firewall to 443/80 only) so attackers cannot
  bypass Cloudflare.
- A Cloudflare API token with the following zone permissions:
  - `Zone > Zone > Read`
  - `Zone > Firewall > Edit`
    Create one at **My Profile → API Tokens → Create Token** (custom token).

### 1. Environment variables

`.env.example` documents every anti-DDoS / Cloudflare variable. In your real
`.env`:

```dotenv
# --- App-layer gate (production only) ---
ANTI_DDOS_ENABLED=true
ANTI_DDOS_PAGES_LIMIT=300
ANTI_DDOS_PAGES_WINDOW_SEC=60
ANTI_DDOS_API_LIMIT=600
ANTI_DDOS_API_WINDOW_SEC=60
ANTI_DDOS_AUTH_LIMIT=20
ANTI_DDOS_AUTH_WINDOW_SEC=60
ANTI_DDOS_GLOBAL_LIMIT=18000
ANTI_DDOS_GLOBAL_WINDOW_SEC=60
ANTI_DDOS_GLOBAL_HALT_MS=10000
ANTI_DDOS_VIOLATION_WINDOW_SEC=600
ANTI_DDOS_MAX_VIOLATIONS=10
ANTI_DDOS_BLOCK_TIERS=5:600,20:3600,50:86400

# --- Cloudflare API (automatic edge blocks) ---
CLOUDFLARE_API_TOKEN=<your API token>
CLOUDFLARE_ZONE_ID=<your zone id — Dashboard → your domain → Overview>
CLOUDFLARE_AUTO_BLOCK_ENABLED=true
```

Credentials live in env only and are never stored in Redis-visible config.
Restart the container after changing them.

### 2. Verify in the admin panel

Open **DevOps → Anti-DDoS protection**
(`/admin/devops/antiddos`, requires `settings.view`) and:
- Check the **Cloudflare** card shows the request arrived proxied, and the
  green **API configured** badge.
- Click **Verify connection** — it confirms the token can read the zone and
  shows the zone name.
- Keep the **Automatically create Cloudflare edge blocks** toggle on.
- The **Cloudflare edge blocks** card lists every auto-created rule with its
  remaining TTL; **Remove rule** deletes it — and **Unban** lifts both the
  host-block and the edge rule in one action.

### 3. Notes

- **Only proxied traffic** is edge-blocked. The gate verifies a request
  actually transited Cloudflare (`CF-Ray` / `CDN-Loop`); a spoofable
  `CF-Connecting-IP` alone is never trusted.
- **Free plan**: IP Access Rules support is plan-independent; the limit is
  ~300 rules per zone and the 30s sweep keeps expired rules cleaned up.
- **Distributed botnets**: many unique IPs each under the threshold are shed
  by the whole-site valve (short global halt) rather than banned one-by-one,
  which avoids collateral damage to shared IPs.
- **Volumetric L3/L4 floods** cannot be stopped by application code — for
  those, keep the domain on Cloudflare's orange cloud so Cloudflare's own
  always-on DDoS protection absorbs them.

---

## Captcha (Cloudflare Turnstile)

The **register**, **login**, **forgot-password** and **resend-verification**
forms can be protected by a captcha. **Cloudflare Turnstile** is the supported
provider and is free; reCAPTCHA and hCaptcha are also wired up. If you only
read one thing, read the precedence table below.

### Where the captcha is configured (and who wins)

There are two places, and the **admin panel always wins**:
1. **Admin panel** — _Admin → CMS Settings → Captcha_ (stored in the database).
2. **Environment variables** — used **only** as a fallback when the admin panel
   has no value.

Resolution order, highest first:

| Admin panel `captcha_provider` | Env `CAPTCHA_PROVIDER` | What happens                           |
| ------------------------------ | ---------------------- | -------------------------------------- |
| `turnstile`                    | anything               | **Turnstile** (panel wins)             |
| `none` (set explicitly)        | `turnstile`            | **Off** — an explicit panel value wins |
| _empty / never set_            | `turnstile`            | **Turnstile** (env fallback)           |
| _empty / never set_            | _empty / never set_    | **Off**                                |

In short: **enable it in the admin panel and the env vars are ignored; leave the
panel empty and the env vars take over.** An explicit `none` in the panel turns
the captcha **off** even when `CAPTCHA_PROVIDER=turnstile` is set.

### Option A — configure with environment variables (per deploy)

1. Create a Turnstile widget in the
   [Cloudflare dashboard](https://dash.cloudflare.com/?to=/:account/turnstile):
   **Add widget**, name it, and add the hostnames your hotel is served on
   (e.g. `epicnabbo.nl`, `www.epicnabbo.nl`). _Managed_ mode is fine. Copy the
   **Site Key** and the **Secret Key**.
2. Put them in your real `.env` (never commit this file):

   ```dotenv
   CAPTCHA_PROVIDER=turnstile
   TURNSTILE_SITE_KEY=<your site key>       # public — safe to expose
   TURNSTILE_SECRET_KEY=<your secret key>   # SECRET — server-side only
   ```

   - The **site key** is **public**: it is rendered into the page for the
     browser.
   - The **secret key** is **secret**: only the server uses it to call
     Cloudflare's `siteverify` endpoint. **Never commit it** — keep it in the
     host `.env`, or a **masked CI/CD variable** if you deploy from CI.
3. Restart the container so the new env is picked up.

### Option B — configure in the admin panel

**Admin → CMS Settings → Captcha**: pick the provider and paste the site key and
secret. This overrides the env vars and takes effect **without a restart**.

### Verify

- Open `/register`. When active, the Turnstile widget appears above the submit
  button.
- The e2e suite can assert the widget contract:
  `E2E_EXPECT_CAPTCHA=turnstile pnpm test:e2e` (spec: `e2e/register.spec.ts`).

### Notes

- **Fail-closed**: if the provider is Turnstile but no secret key is available,
  verification fails and the form is blocked — it never silently lets bots in.
- The Content-Security-Policy already allows `https://challenges.cloudflare.com`
  (`src/lib/csp.ts`), so no header changes are needed.
- Turnstile does **not** require the Cloudflare proxy (orange cloud); it works
  independently of the anti-DDoS layer above.

---

## Production Deployment (blue/green)

PM2 is **not** used in production. It is neither started nor supervised here; the
CMS runs as a single Docker container per replica, started by
`scripts/ci-deploy.sh`.

```
git push main
  └─ Gitea Actions "deploy" job
       └─ bash scripts/ci-deploy.sh
            ├─ build image epicnext-cms:<sha>
            ├─ pnpm db:migrate
            ├─ start candidate on the idle port   (live replica keeps serving)
            ├─ health gate + release-hash check + Playwright e2e
            ├─ switch the nginx upstream, reload  (cutover)
            └─ stop and retire the previous replica
```

### Why host ports instead of `--scale`

The containers run with `network_mode: host`, so every replica binds a **host**
port rather than sharing a published docker port. `docker compose up --scale
cms=2` therefore cannot work here: the replicas would collide on 3002. Instead
there are two fixed slots, and each release lands in the idle one:

| Slot | Host port | Container name       |
| ---- | --------- | -------------------- |
| A    | 3002      | `epicnext-cms-app`   |
| B    | 3003      | `epicnext-cms-green` |

`docker-compose.yml` defines a single `cms` service (the blue slot on 3002)
behind the `cms` profile, so a bare `docker compose up -d` never starts it. The
green slot (`epicnext-cms-green`, port 3003) only ever exists as a `docker run`
container created by the CI deploy; compose does not define it, so the two paths
cannot drift apart. Note that the CI deploy path deliberately uses `docker run`
rather than compose, so the resource limits are declared in **both** places —
limits that only existed in compose would never apply to a real release.

### Compose on a CI host

Compose and CI both want port 3002, so only one of them can own a host. A stray
compose replica (`docker compose up`, or the daily `scripts/docker-update.sh`
cron) parked an `epicnext-cms` container on the blue slot while nginx served the
green slot, and every later release stopped on "Port 3002 is already in use" —
after the build, the migrations and the browser gate. Three guards now prevent
that:
- The `cms` service sits behind the `cms` profile, so a bare `docker compose up
  -d` starts only byparr and can never claim 3002. The service starts only when
  it is named explicitly (`docker compose up -d cms`), which is what the
  installer/updater already do; Compose enables the profile automatically for an
  explicitly named service.
- `scripts/docker-update.sh` refuses to run on a CI host. It used to test only
  `epicnext-cms-app`, but after a cutover to the green slot that container is
  stopped and deleted, so the guard stopped firing while the host stayed
  CI-managed. It now checks both slot containers and the nginx upstream, and
  reports the skip with exit 0 instead of failing the cron.
- `ci-deploy.sh` retires a compose replica of _this_ checkout
  (`com.docker.compose.project.config_files`) from the candidate port before
  starting the candidate — but never a slot container, and never the port nginx
  currently serves. Anything else still fails loudly in `assert_port_free`.

### The nginx upstream is the switch

nginx does not know about container names; it reads a plain list of backends from
`/etc/nginx/snippets/cms_upstream_servers.conf`, which `ci-deploy.sh` rewrites
during the cutover:

```nginx
upstream cms_app {
    least_conn;
    keepalive 32;
    include /etc/nginx/snippets/cms_upstream_servers.conf;
}
```

```
server 127.0.0.1:3002 max_fails=2 fail_timeout=10s;
```

`switch_upstream()` writes the new backend, runs `nginx -t`, and only then
reloads. If the test fails the previous file is restored untouched, so a typo can
never take the site down.

### Failover between replicas

`max_fails`/`fail_timeout` mark a dead replica as unavailable, but only
`proxy_next_upstream` actually retries the other one:

```nginx
proxy_next_upstream error timeout invalid_header http_502 http_503 http_504;
proxy_next_upstream_tries 2;
proxy_next_upstream_timeout 10s;
```

`non_idempotent` is deliberately **absent**, so `POST` is never replayed against
the second replica — a retried import or write would otherwise apply twice. A
stream that already emitted events is likewise not resumed elsewhere.

### Resource limits

`--memory=4g --memory-swap=5g --cpus=2 --pids-limit=512` per replica. The limits
were previously removed ("Next may run unrestricted"); on a shared host that
means a single leak can starve MariaDB, nginx and Traefik.

> **Watch this on the first heavy import.** The 4 GiB ceiling is not yet
> exercised by a real bulk import. If the container is OOM-killed during a large
> furniture import, raise `mem_limit` in `docker-compose.yml` _and_ `mem_limit` /
> `mem_swap_limit` in `scripts/ci-deploy.sh` together.

### Manual deploys

`./deploy.sh` is a thin wrapper around `scripts/ci-deploy.sh`, so a manual
release and a CI release follow exactly the same path. The previous version
killed whatever held port 3002 with `fuser -k` and ran `docker compose down`
before anything new existed — guaranteed downtime on every failed build. The
branch guard inside `ci-deploy.sh` only accepts `main`/`master`.

---

## Memory-capped commands

This host runs with `vm.overcommit_memory=0` **and no swap**. When a process
asks for more memory than is free, the kernel does not wait — it calls the
OOM-killer immediately, and it picks its victim across the **whole machine**,
not just the offending process. An uncapped build does not merely fail: it can
take the MariaDB process, nginx and the live release down with it.

Every heavy command therefore runs inside its own cgroup with a hard
`MemoryMax`, via `scripts/with-memory-cap.sh`. If the build outgrows its
ceiling, only that cgroup is killed — the build fails, the site keeps serving.

The systemd backend also sets `MemoryHigh` (95% of the ceiling) so the kernel
reclaims and throttles **before** the hard limit, and it clamps the ceiling to
`MemAvailable - reserve` (`CMS_MEMORY_CAP_RESERVE`, default `4g`). That stops a
cap larger than the free memory from dragging the whole host into the global
OOM-killer. `MemorySwapMax=0` is set explicitly (this host has no swap). If
fewer than 1 GB would remain, the script refuses to start.

| Script                  | Ceiling | Covers                     |
| ----------------------- | ------- | -------------------------- |
| `pnpm dev`              | 8 GB    | Dev server                 |
| `pnpm build`            | 10 GB   | Production build           |
| `pnpm analyze`          | 10 GB   | Build + bundle-size report |
| `pnpm test`             | 8 GB    | Vitest                     |
| `pnpm test:coverage`    | 8 GB    | Vitest with coverage       |
| `pnpm test:ui`          | 8 GB    | Playwright                 |
| `pnpm test:e2e`         | 8 GB    | Playwright                 |
| `pnpm test:e2e:quality` | 8 GB    | Playwright (advisory)      |
| `pnpm test:integration` | 8 GB    | Vitest integration config  |
| `pnpm typecheck`        | 6 GB    | `tsc --noEmit`             |

### Running the builder by hand

```bash
npx next build          # ✗ refused before it allocates anything
```

`next build` loads `next.config.ts`, which **refuses any production build that
is not running under the memory cap**. This closes the one hole the `pnpm`
scripts leave open: invoking the builder directly — from a terminal, an IDE, or
an automated agent — would otherwise bypass the cgroup entirely and go
unbounded.

The refusal looks like this:

```
Error: Refusing to run an uncapped production build.

On this host an unbounded `next build` gets OOM-killed by the kernel,
and the killer may take the database, nginx or the live release with it.

Use the capped build instead:
    pnpm build
```

Fix: use `pnpm build`. If you are genuinely inside an isolated environment
where the container _is_ the boundary (the Docker build, a CI runner), set
`CMS_MEMORY_CAPPED=1` to opt out deliberately.

### Backends

`scripts/with-memory-cap.sh` picks its mechanism automatically:

| `CMS_MEMORY_CAP_BACKEND` | Mechanism                  | Notes                                                  |
| ------------------------ | -------------------------- | ------------------------------------------------------ |
| `auto` _(default)_       | systemd cgroup `MemoryMax` | Real RSS bound over the whole process tree. Used here. |
| `ulimit`                 | `ulimit -v`, per process   | Virtual address space, **not** RSS. Fallback only.     |
| `none`                   | None — warning only        | Docker build and GitLab runner, each already isolated. |

On a host **without** systemd and without `CMS_MEMORY_CAP_BACKEND=none`, the
script refuses to run rather than proceeding unbounded.

Tunables for the systemd backend: `CMS_MEMORY_CAP_RESERVE` (default `4g`) is
the headroom left for everything else on the machine; the effective ceiling is
`min(requested, MemAvailable - reserve)`.

> Do not "fix" a cap failure by lowering `--max-old-space-size` or by raising
> `CMS_MEMORY_CAP_VIRTUAL` (the default is `40g` on purpose). A `ulimit -v` of
> 10g makes V8 clamp its own heap to ~2.25 GB and webpack dies with
> `std::bad_alloc`. Measure first; raise the ceiling deliberately.

---

## Scripts

| Command                       | Description                                                |
| ----------------------------- | ---------------------------------------------------------- |
| `pnpm dev`                    | Start development server (hot reload)                      |
| `pnpm build`                  | Production build (memory-capped)                           |
| `pnpm start`                  | Start production server                                    |
| `pnpm typecheck`              | Run TypeScript type checking                               |
| `pnpm test`                   | Run all tests (Vitest)                                     |
| `pnpm test:coverage`          | Run all tests with coverage thresholds enforced            |
| `pnpm test:ui`                | Playwright UI tests (`playwright.ui.config.ts`)            |
| `pnpm test:ui:update`         | Playwright UI tests, updating snapshots                    |
| `pnpm test:e2e`               | Playwright end-to-end tests (blocking deploy gate)         |
| `pnpm test:e2e:quality`       | Advisory content/latency checks (non-blocking)             |
| `pnpm test:integration`       | Integration tests (own Vitest config)                      |
| `pnpm test:housekeeping`      | Housekeeping feature tests                                 |
| `pnpm lint`                   | Lint and format check (Biome)                              |
| `pnpm biome:lint`             | Alias of `pnpm lint`                                       |
| `pnpm format`                 | Format files in place (Biome)                              |
| `pnpm toolchain:check`        | Verify the Node toolchain matches `.nvmrc`                 |
| `pnpm i18n:check`             | Audit CMS translation coverage                             |
| `pnpm deps:audit`             | Audit dependencies for high-severity advisories            |
| `pnpm db:migrate`             | Apply pending SQL migrations                               |
| `pnpm db:migrate:status`      | Show migration status                                      |
| `pnpm db:schema:generate`     | Regen `src/db/schema.ts` from prior schema + live DB       |
| `pnpm db:generate`            | Draft SQL via drizzle-kit → `drizzle/drafts/`              |
| `pnpm db:studio`              | Drizzle Studio (dev)                                       |
| `pnpm db:introspect`          | drizzle-kit introspect (draft)                             |
| `pnpm db:bulk`                | Batch-import >50 MB JSON via `scripts/bulk-import-json.ts` |
| `pnpm catalog:sync`           | Sync the catalog against a clone source (interactive)      |
| `pnpm db:up` / `pnpm db:down` | Start / stop the `mariadb-turbo` container                 |
| `pnpm gamedata:compress`      | Pre-compress large gamedata JSON to `.gz` (gzip_static)    |
| `pnpm analyze`                | Build + report per-route bundle sizes                      |
| `pnpm performance:report`     | Re-render the performance report from a build              |
| `pnpm jobs:worker`            | Start background task worker                               |
| `pnpm assets:editor`          | Copy TinyMCE editor assets into `public/`                  |

> Replace `pnpm` with `npm run` or `yarn` for other package managers.
>
> The heavy ones run memory-capped — see
> [Memory-capped commands](#memory-capped-commands). A production `next build`
> run outside the wrapper is refused rather than executed unbounded.

---

## Performance Features

| Feature                          | Description                                                               |
| -------------------------------- | ------------------------------------------------------------------------- |
| **React Compiler**               | Automatic memoization — reduces unnecessary re-renders                    |
| **View Transitions API**         | Native browser transitions between page navigations                       |
| **Lenis Smooth Scroll**          | Fluid, customizable scrolling                                             |
| **Server-Sent Events**           | Real-time radio now-playing & listeners via SSE                           |
| **Valkey Caching**               | Caches API responses up to 30s in Valkey                                  |
| **RCON (TCP Socket)**            | Live commands to the emulator (credits, badges, kick, ban)                |
| **Streaming & Suspense**         | Next.js App Router streaming for fast page loads                          |
| **Automatic Image Optimization** | `next/image` with Sharp for resizing and WebP/AVIF                        |
| **Compression**                  | Gzip compression enabled on all responses                                 |
| **gzip_static (gamedata)**       | 48 MB FurnitureData JSON served from pre-built `.gz` — no per-request CPU |
| **PWA**                          | Service worker with skip-waiting, stale CSS chunk recovery                |
| **Biome**                        | Fast linting and formatting (replaces ESLint + Prettier)                  |

---

## Architecture

```
├── drizzle/
│   ├── migrations/            # CMS SQL migrations (idempotent, tracked in cms_migrations)
│   └── drafts/                # drizzle-kit generate output (never auto-applied)
├── scripts/
│   ├── apply-migrations.ts    # SQL migration runner (apply + status)
│   ├── bulk-import-json.ts    # 50 MB+ JSON importer (2000-row chunks, UPSERT)
│   ├── jobs-worker.ts         # Background task scheduler
│   ├── generate-drizzle-schema.mjs # Regen src/db/schema.ts from schema + live DB
│   └── compress-gamedata.mjs  # Pre-compress large gamedata JSON (gzip_static)
├── src/
│   ├── db/
│   │   ├── schema.ts          # Drizzle ORM schema (committed — runtime data layer)
│   │   ├── schema-gamedata.ts # Large-JSON storage schema (furnidata/docs/texts)
│   │   └── relations.ts       # Drizzle relations
│   ├── app/                   # Next.js App Router (pages & API routes)
│   ├── actions/               # Server Actions
│   ├── components/            # UI components
│   ├── lib/
│   │   ├── auth/              # NextAuth, password hashing, 2FA, SSO tickets
│   │   ├── services/          # RCON, email, currency, PayPal, alerts
│   │   ├── db.ts              # Drizzle connection singleton (runtime)
│   │   ├── redis.ts           # Cache client (ioredis → Valkey)
│   │   └── motion.ts          # Framer Motion animation variants
│   ├── messages/              # i18n translations (en, nl, de, fr, es, it, pt, da, no, sv)
│   └── env.ts                 # Zod-validated environment schema
├── public/
│   ├── assets/                # Images, icons, fonts
│   ├── nitro-assets/          # Nitro client assets (~3GB, volume-mounted in Docker)
│   └── swf/                   # SWF client files (volume-mounted in Docker)
├── docker-compose.yml         # Docker Compose configuration
├── Dockerfile                 # Multi-stage, multi-package-manager Docker build
├── next.config.ts             # Next.js configuration
└── .env.example               # Environment template with all options
```

---

## Optional Integrations

### Emulator — RCON

For live actions (credits, badges, rank changes, kick, ban, hotel alerts). The emulator must be running with RCON enabled at `RCON_HOST:RCON_PORT`.

### Client — Nitro

The `/client` page loads the Nitro client. Configure the client URL via **Admin → CMS Settings** (`nitro_client_url`). See `update-Nitrov3.sh` for deployment.

### Radio

Supports any streaming radio (e.g., Azuracast). Configure endpoints via CMS Settings:
- `radio_now_playing_api_url`
- `radio_listeners_api_url`

The radio player uses SSE for real-time updates (10s interval, no polling).

### Background Jobs

Run as a persistent process:

```bash
pnpm jobs:worker    # or: npm run jobs:worker / yarn jobs:worker
```

### AI Content Moderation

Optional OpenAI-powered moderation for comments and guestbook posts. Set `OPENAI_API_KEY`.

### Captcha — Cloudflare Turnstile

Protect the register, login, forgot-password and resend-verification forms.
Set `CAPTCHA_PROVIDER=turnstile` plus the Turnstile keys in `.env`, or configure
it in **Admin → CMS Settings**. Full setup, precedence and verification:
[Captcha (Cloudflare Turnstile)](#captcha-cloudflare-turnstile).

### Byparr (Cloudflare Bypass)

Some clone sources are protected by Cloudflare. Byparr (a FlareSolverr successor) solves these challenges automatically.

```bash
docker compose up -d byparr
```

```dotenv
BYPARR_URL=http://localhost:8191
```

### Furniture Import with Auto-Translation

The CMS automatically translates furniture names and descriptions to **13 languages** on every import:
- **Native languages** (via official Habbo gamedata): Dutch, English, German, French, Spanish, Turkish, Italian
- **Additional languages** (via LibreTranslate Docker at `127.0.0.1:5000`): Portuguese, Finnish, Polish, Russian, Arabic, Japanese

### Theming

12 preset themes with fully customizable colors via **Admin → Theme** (`/admin/theme`).

---

## Development

```bash
pnpm dev          # Start with hot reload
pnpm typecheck    # Type check all files
pnpm test         # Run test suite
pnpm analyze      # Build and report per-route bundle sizes
pnpm biome:check  # Lint and format
```

### End-to-end tests

`pnpm test:e2e` is the **blocking deploy gate**. It only contains checks the CMS
can guarantee on its own (anonymous redirects, the register form fields and the
captcha DOM contract, cache-control headers), so a green run means a code deploy
is safe.

Checks that depend on **live content or data** — a missing upload or theme asset
(`/help` article images), a legacy malformed avatar figure, warm-page latency —
live in a separate advisory suite:

```bash
pnpm test:e2e:quality   # playwright.quality.config.ts, never blocks a deploy
```

It is run against the public site as a `continue-on-error` CI job, so it still
surfaces a real content problem without turning the pipeline red. Point either
suite at any running CMS with `PLAYWRIGHT_BASE_URL`.

### Testing & Quality Assurance

EpicNext-CMS maintains strict engineering standards enforced through automated testing pipelines:
1. **Unit & Integration Testing (Vitest)**:
   - Run tests: `pnpm test`
   - Run integration tests: `pnpm test:integration`
   - Covers database helpers, caching strategies, background workers, and housekeeping matrix logic.

2. **End-to-End Testing (Playwright)**:
   - Blocking deploy gate (`pnpm test:e2e`): validates critical user journeys (authentication, registration, captcha DOM contracts, security headers).
   - Quality advisory suite (`pnpm test:e2e:quality`): non-blocking inspection of live content assets, page latency, and responsive layouts.

3. **Linting & Type Safety (Biome & TypeScript)**:
   - Lint check: `pnpm lint` (or `pnpm biome:check`)
   - Type check: `pnpm typecheck` (strictly validates TypeScript across App Router, Server Actions, and Drizzle models).

### Contributing

1. Ensure typecheck and tests pass: `pnpm typecheck && pnpm test`
2. Follow existing code conventions (Server Components where possible)
3. SQL migrations in `drizzle/migrations/` must be idempotent
4. For new database code, use the Drizzle runtime directly (`import { db } from "@/lib/db"`)
5. Avoid `any` — use `biome-ignore` comments only when unavoidable

---

## Production Deployment & Zero-Downtime Releases

EpicNext-CMS is engineered for enterprise-grade production environments with zero-downtime deployment capabilities:
1. **Blue/Green Slot Deployments**:
   - Updates run through containerized slot orchestration (`scripts/docker-update.sh`), ensuring seamless transitions between release versions without dropping requests.
   - Automatic health check verification (`/cms_api/health`) validates database connectivity, Redis/Valkey status, and RCON liveness before routing production traffic.

2. **Automated Rollback Protection**:
   - If a post-cutover health check or startup sequence fails, the system automatically triggers a rollback to the previous stable container image and logs the incident.

3. **High-Performance Caching & Rate Limiting**:
   - Integrates with Redis / Valkey for distributed session storage, global rate limiting, and ephemeral response caching.
   - Multi-tier anti-DDoS proxy filtering defends against volumetric application-layer abuse with automatic Cloudflare edge-block mirroring.

---

CC BY-NC-SA 4.0. See `LICENSE` for details.
test line
// CI monitor test 1791828076
