# CMS upgrade â€” September 2026

## Operator changes

| Area             | Behavior and location                                                                                                                                                                                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Release          | Deployment checks HTTP health, release identity and Chromium pages before marking the running image verified. Registry publication reuses that verified digest on the shared runner; independent hosts build and verify their own image.                                 |
| Shared HK        | Dialogs scroll within the available viewport. Table column preferences persist per page in the current browser session; filters already remain in the URL. No favorites added.                                                                                           |
| Catalog Studio   | Dedicated detail drawer and five separate completeness states: SQL, offers, furnidata, icon and Nitro. Sprite/type conflicts are consistently excluded from import and linked to audit. Missing source files are never represented as available.                         |
| Operations       | Command center includes permission-filtered error groups, personal import failures, open support tickets and news drafts. A failed source is shown separately from an empty source.                                                                                      |
| Error center     | Retained occurrence counts, first/last times, identified users, release counts, self-assignment and recognized local links. Assignment requires edit permission and is audited.                                                                                          |
| News             | Private server-backed autosave, recover/discard/retry, prior saved revisions restored as a draft, and concurrent-edit detection. New status/search filters and pagination make older drafts reachable.                                                                   |
| Jobs             | Cancellation finishes the current item and stops pending items. Completed work stays completed. Uncertain interrupted mutations are excluded from retry. Live lease checks stop known stale worker writes.                                                               |
| Installation     | `/admin/devops/installation` shows release, DB latency, Redis, emulator, storage permissions, migration history and worker heartbeat. Renderer defaults are recognized. Registry access is explicitly unverified from the web process.                                   |
| Public dashboard | Current/next published event, clearer unread-message action, useful empty/error states and mobile layout refinements.                                                                                                                                                    |
| Audit            | Exact actor/action and UTC date filters, readable recorded before/after values and permission-protected CSV of the filtered page, capped at 100 rows.                                                                                                                    |
| Performance      | Active import polling remains 5 seconds; idle polling is 30 seconds and pauses in hidden tabs. History returns at most 30 owned jobs and initially renders 50 items per job. Health probes are deduplicated within a render; diagnostics report observed probe duration. |
| Text             | New messages are translated in English, Italian and Dutch. Other locales have explicit English fallback strings. Existing translation debt is not reported as resolved.                                                                                                  |

## Deployment requirements

- Apply migration `0026_article_editor_recovery.sql` through `pnpm db:migrate` before enabling the new news editor. It adds private drafts and revision tables without modifying existing articles.
- Keep `storage` persistent and writable. Error assignments and import cancellation markers use the existing shared storage.
- Run the existing `pnpm jobs:worker` process with the installation configuration. It now publishes a heartbeat to Redis every minute. A web process alone does not establish that scheduled-news jobs are running.
- The deploy runner installs Chromium before cutover. Browser checks visit only public login/news/staff pages; they do not create production content or authenticate staff. The host must satisfy Chromium system-library requirements.
- Use the existing Gitea registry secrets. The CMS does not read or display those credentials.

## Boundaries

- Operations is a bounded operational summary: errors use at most 1,000 retained events and imports use the latest 30 owned jobs. Empty checked records do not prove that all historical work is resolved.
- Import history bounds payloads and concurrent file reads. Directory metadata scanning and worker enumeration still scale with stored history.
- Redis lease checks and file saves are separate operations. They reduce stale writes but do not provide atomic fencing across Redis, SQL and filesystem operations. An import interrupted after SQL may require local-data inspection.
- Revision history displays the latest 20 saved versions; revisions are retained in the database. New-article recovery has one private slot per staff account.
- The database connection probe is a measurement, not a performance benchmark. No throughput or latency improvement is claimed without production measurements.
- A rollback restores an application image; it does not reverse database migrations. The new tables are additive.

## Verification

Local verification on 2026-09-09:
- Production build succeeded with fixture configuration and an intentionally unavailable database. Build-time fallback logs are expected in this check.
- Full Vitest run: 254 files passed, 4 skipped; 1,466 tests passed, 6 skipped. Coverage thresholds passed (19.89% lines); this does not imply exhaustive coverage.
- Global Biome rules/import checks passed across 1,328 files; modified source/locales were formatted separately to avoid unrelated Windows line-ending changes.
- Translation audit: no invalid ICU messages, variable mismatches or missing static references. Existing locale gaps and 1,560 hardcoded-text candidates still need editorial work; they are not silently marked translated.
- Headless Edge verification of actual shared components with compiled CSS and the CMS theme at widths 1,280 and 390 pixels: the switch changes state and thumb position, the dialog stays within the 720px viewport, the final button is reachable, and the background page does not scroll. This isolated fixture does not establish full authenticated-page parity.
- Deployment rollback, verified-digest publication, ownership/cancellation and concurrent news edit behavior have focused regression tests.

Docker runtime, database migration execution and authenticated browser flows still require an integration environment. Check the Gitea pipeline and live release identifier after publication. A successful local build is not production verification.


## Catalog packages

The normal catalog toolbar now opens a dedicated Catalog packages dialog.
Create a named draft from selected categories and their descendants, either to
update those categories or copy them under a chosen parent. Drafts are shared
with authorized staff; saving a draft does not modify the live catalog.

Edit category metadata and offer prices, or review bulk price changes before
applying them to the draft. The catalog preview supports category navigation,
search, real local furniture icons and rank/Club/VIP access simulation. It does
not render the game client or evaluate ancestors outside the selected package;
special layouts and that access limitation are disclosed in the preview.

Publication requires a saved draft and a fresh review. Concurrent source changes
block publication; version checks prevent one editor overwriting another.
Copying preserves the underlying category and offer fields and remaps internal
references while retaining furniture IDs and assets. The catalog writes and
published result are committed together; retrying the same published package
does not copy it again. Failures in hotel notifications, audit or Git export
scheduling after commit are reported as warnings rather than failed publication.

Apply additive migration `0027_catalog_packages.sql` before opening this tool.
Existing migration automation discovers the file. Limits are 200 categories,
500 offers and 8 MB of package data. Package source checks inspect at most 20,000
catalog categories. Publication briefly locks category rows while validating and
writing changes, so large live catalogs should be checked under realistic load.
English, Italian and Dutch copy is provided; other locales use the new English
strings pending translation. No new dependency is required.

Validation: 1,506 tests passed (six skipped), type checking, lint, translation
contracts and a production build with fixture configuration. A browser fixture
verified the real dialog at 1280 and 390 pixels; server actions were simulated.
The new database migration and package publication have not run in production.

## Housekeeping search and user overview

The existing global search now includes furniture, normal/Club catalog categories
and both ticket sources. Results respect module permissions, accept single-digit
IDs, and remain usable when one source fails. Keyboard navigation and cancellation
prevent stale search responses from replacing newer results.

User details open on an operational overview with up to five records from each
authorized source: bans, active mute, support tickets, help tickets, reports,
payments, catalog purchases and audit activity. Failed sources are distinguished
from empty results. User detail and edit pages also apply log permissions before
loading activity and exposing counters.

Italian and Dutch navigation, user management, news and support labels were
reviewed. The new search and overview copy has English, Italian and Dutch text;
other locales receive English fallback strings. This is a focused editorial pass,
not a full translation of every CMS page. No database migration or dependency
change is required. Browser checks use real components with simulated data at
1280 and 390 pixels; production database behavior still needs deployment validation.

## Operational reliability and recovery

- Audit history now records category settings (normal/Club), individual/bulk offer prices, update-mode package publication and news edits inside the write transaction. The audit screen previews and restores individual changes after locking and comparing the current recorded fields. Deleted records, hierarchy changes, LTD counters, imports and historical entries without complete snapshots cannot be restored. Restores create their own history entry. Apply migration `0028_history_snapshots.sql` before running this version: it widens audit snapshots to MEDIUMTEXT without deleting existing data.
- `/admin/operations` reuses durable import jobs, stable history pagination and owner-scoped failed-item retries. A deterministic child ID prevents duplicate retries. The shared Git export queue displays actual pending/running state and latest result; synchronous/SSE synchronization remains linked rather than represented as a durable job history.
- Catalog maintenance includes a read-only integrity report for normal/Club categories, offers, furniture references and local icons. Known sentinel IDs are preserved. Only categories pointing to a missing positive parent have an automated repair: preview lists every affected category and apply compares the locked graph before reattaching those categories at the root. No records are deleted. Other issues require an explicit manual edit. Reports display up to 200 issues with complete counts; unavailable icon storage is distinguished from missing assets.
- CMS errors support exact release and time filters plus frequency sorting. Counts refer to retained matching events, while group resolution remains current across releases.
- User/settings forms now protect unsaved edits and preserve failed submissions. User/news validation errors appear at the affected fields; settings show returned validation errors inline. Existing submission locking is retained and tested in a browser.
- `/admin/permissions/preview` shows one role's section access and known CMS grants using live ACL and the existing highest-rank policy. It never changes sessions. Additional user roles, navigation customization and record-specific authorization remain explicit limits of the preview.

New UI copy is supplied in English, Italian and Dutch; other locales receive English fallback strings. No new runtime dependencies. Browser fixtures use real UI components with simulated server responses; the database migration and production behavior have not been exercised on the live hotel.

Validation for this increment: 1,589 tests passed, six skipped; TypeScript, Biome, translation contracts and fixture production build passed. Browser checks covered user/settings/news forms, permission preview, CMS errors, integrity preview and history restore at 1280 and 390 pixels. Double submission, stale preview, blocked navigation, field focus and horizontal overflow were checked with simulated server actions. No live database writes or deployment were performed.


## September 11: public pages and staff workflows

- Docker stages now follow the exact `.nvmrc` release, enforced by the toolchain check.
- `/news` supports search, ordering by effective publication date and real pagination.
- `/events` supports upcoming/ongoing/completed filters, explicit UTC week windows, local displayed times and personal registrations.
- `/search` searches users, open rooms, published news and events with independent pagination and partial failure states.
- `/me` shows support replies, incoming friend requests, the next registered event and available referral rewards. Reply availability does not claim unread status.
- Profile privacy is managed in `/settings`. Wallet values are private by default; visitors do not receive hidden sections in HTML. Photo galleries initially show six photos and can expand to the loaded limit of 24.
- Ticket desks support waiting-for-staff and assignment filters, with elapsed time since the latest reply.
- HK table views save filters, order and visible columns per account and table (maximum 20). Existing session column preferences remain available until a named view is applied.
- Official and clone synchronization run through the existing durable import queue. Reloading restores history; interrupted uncertain writes still require inspection before repair. Successful items are not repeated.
- Publication preflight validates URL syntax/protocols and schedules, shows affected page links and keeps existing article previews. It does not claim remote URLs are reachable. Drafts remain savable. Partial event updates preserve omitted fields.
- Admin APIs return `x-operation-id`; server errors, staff audit records and import jobs share correlation context. Error and audit screens link to each other. Older records without this context remain readable.
- Public reads distinguish unavailability from empty results and real 404s, preserving independently available sections on home, dashboard, staff, photos, rankings and groups/forums.

### Data and verification

Additive migrations `0029_admin_table_views.sql` and `0030_profile_privacy.sql` run through the existing deployment migration runner. They create CMS-owned tables and do not change emulator user settings. Keep the existing shared storage volume and background jobs worker for durable imports.

Browser verification used real components with controlled data fixtures at 1280 and 390 pixels, including failure and partial-result cases. Production compilation and full lint were checked locally. No production content was created during those checks; real authenticated content and external source availability remain environment-dependent.

## Original furniture bundle recovery and progress

Catalog Studio queued imports and repairs now search other enabled Nitro sources when their initial downloads/conversion produce no local bundle. Recovery checks an exact classname, floor/wall type and positive revision against the source furnidata, then validates the bundle filename, internal name and PNG texture before writing it. It does not copy the alternative source's prices, IDs or descriptive metadata.

The recovery pass checks at most eight eligible sources, excludes the selected source, and has a 20-second network budget with four-second request limits. Catalog downloads are capped at 20 MiB; bundle downloads and attachment decompression are capped at 50 MiB. A bounded catalog cache avoids downloading full furnidata for every item. Blocked or incompatible sources can still require the original bundle to be attached manually.

Import history displays the current phase and elapsed time, the last phase on failure/interruption, and the source/revision of a recovered bundle. Phases are persisted under the existing worker lease; a retry clears old phase/provenance fields. Synchronization jobs also report their existing importer phases, but their clone-specific asset strategy is unchanged.

No additional secrets or environment variables are needed. Source definitions remain managed through the existing source configuration.

## Catalog workflow and public diagnostics

- Bulk offer edits retain the existing preview and now record complete price/category snapshots. The success notification offers an atomic batch Undo for 15 seconds; individual changes remain restorable from audit history afterward. Undo rejects changed records or missing categories rather than overwriting newer edits. No additional migration is needed beyond the existing history snapshot migration.
- Catalog Studio preserves the existing in-place search/filter/selection flow and now restores list scroll and focus after closing furniture details. Escape closes details before clearing selection. Obsolete list responses cannot replace a newer search; switching source invalidates pending review preparation.
- Import review groups furniture needing completion, conflicting records and unverified components. Each row lists missing or unknown components and suggests the next action. These are inspection recommendations; final import validation remains authoritative.
- DevOps performance has separate HK API and public-page groups, each limited to 200 recent samples for one hour. Public instrumentation measures root server page invocations on /me, news, profiles, events and search, including measured database/external work. It excludes metadata, separately rendered children, cached responses that do not invoke the page, network transfer and browser rendering. Static build invocations are excluded. Routes use fixed labels without usernames or search terms; component outcomes are distinct from HTTP status codes.
- Shared unsaved-change protection now coordinates dirty forms and protects global-search navigation. Prefix, badge and room-furniture editors protect explicit dismissal and remain open after failed saves. Browser Back is intercepted when the cancellable Navigation API is available; reload/close and links retain their existing protection. Prefix saving now waits for the real server action result before closing.
