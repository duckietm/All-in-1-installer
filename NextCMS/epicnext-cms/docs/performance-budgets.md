# Route JavaScript budgets (enforced)

Run after the existing production build; no second build or server is needed:

```sh
node scripts/performance-report.mjs --next-dir .next --config scripts/performance-budgets.json --output-dir build-reports
```

The command writes `report.json` and `report.md` and prints the Markdown report. An optional `PERFORMANCE_COMMIT_SHA` environment variable records the commit declared by the build caller; the script does not infer that an existing build matches the current checkout. JSON also records `BUILD_ID`, Node/zlib versions, manifest provenance, exact file paths, sizes and source entries.

## What is measured

For each configured App Router route, resolve its exact app path using `app-path-routes-manifest.json` and `server/app-paths-manifest.json`. Read its generated `page_client-reference-manifest.js` as a JSON assignment **without executing JavaScript**. Use its sibling `page/build-manifest.json`, falling back to the root build manifest only if that sibling is absent.

The **initial entry envelope** is the union of route bootstrap `rootMainFilesTree[appPath]` (or `rootMainFiles`) and every client chunk that route's client-reference manifest lists. This includes layout, page and boundary/loading entries.

The manifest exposes those chunks differently per bundler. Turbopack emits an explicit per-segment `entryJSFiles` map; webpack emits no such field and records chunks only per client module, as `clientModules[*].chunks`, in `[chunkId, fileName, chunkId, fileName, …]` order. The report reads `entryJSFiles` when present and otherwise derives the same envelope from `clientModules`, which is the source Next's own `static-routes-info` uses. Numeric chunk ids are skipped; a malformed chunk _path_ still fails rather than being dropped, so a broken manifest cannot quietly under-report a route.

> The build runs webpack (`next build --webpack`), so the `clientModules` path is the live one. An earlier revision only read `entryJSFiles`, and after the switch to webpack every route reported `unavailable` while the command still exited 0 — the budgets were silently not being measured. When a bundler switch changes the manifest layout again, re-check this section rather than trusting a clean exit.

The definition follows the data exposed by the installed Next 16.3.8 build and the `getLinkAndScriptTags` / `getRequiredScripts` renderer helpers; it is deliberately a build-artifact envelope, not a browser network trace. Conditional rendering, redirects, streaming and browser caches can change actual requests.
- Raw bytes are filesystem byte lengths of unique JavaScript assets in that envelope.
- Gzip bytes are the **sum of independent gzip level 9 compressions** of those files using the recorded Node/zlib runtime. They are not gzip of concatenated source, nor observed CDN transfer sizes.
- Deployment query strings and `/_next/` prefixes are normalized before deduplication. Shared files count once per route; each route is measured independently, with no misleading cross-route total.
- Legacy `nomodule` polyfills are measured separately, outside the modern initial budget. CSS, source maps, images, external scripts, HTML/RSC payloads and async-only chunks absent from the manifest's chunk lists are excluded.
- This report makes no claims about execution cost, LCP, hydration time or real-user performance.

## Initial limits

The limits are **baseline bytes × 1.15, rounded upward to the next 10 KiB (10,240 bytes)** independently for raw and gzip. They are size guardrails, not validated speed targets.

Baselines were last recalibrated against a local webpack production build (Next 16.4.1, `next build --webpack`) and cross-checked against the report the Docker image build emits: `/me` 621460/195411, `/news` 616712/193199, `/events` 617121/193450, `/search` 618536/194216, `/admin/catalog` 1049094/330369, `/admin/studio/furni` 1397566/447765 (raw/gzip). The earlier Turbopack numbers (previous revision) were **not** comparable and were dropped.

The image build compiles the app, then runs `scripts/performance-report.mjs` in the same `RUN` layer (`Dockerfile:48-53`). In `mode: enforce` a failing route therefore fails the image build, which blocks both the PR `preflight` job and the `deploy` job. Recalibrate the table and `scripts/performance-budgets.json` **together** in the same commit whenever the envelope legitimately grows (new route dependency, Next upgrade).

| Route                 | Baseline raw bytes | Baseline gzip bytes | Raw limit | Gzip limit |
| --------------------- | -----------------: | ------------------: | --------: | ---------: |
| `/me`                 |             621460 |              195411 |    716800 |     225280 |
| `/news`               |             616712 |              193199 |    716800 |     225280 |
| `/events`             |             617121 |              193450 |    716800 |     225280 |
| `/search`             |             618536 |              194216 |    716800 |     225280 |
| `/admin/catalog`      |            1049094 |              330369 |   1208320 |     389120 |
| `/admin/studio/furni` |            1397566 |              447765 |   1607680 |     522240 |

Configured limits are positive integer bytes; `null` explicitly means observe-only. `scripts/performance-budgets.json` runs `mode: enforce`: an `over-budget` route prints `Performance budgets enforced: <route> (over-budget)` and exits non-zero. Missing production `BUILD_ID`, unsupported manifests, missing routes or missing referenced assets produce `unavailable` with a reason and **no partial/zero total**; under `enforce` an `unavailable` route also fails the command, so a bundler change that breaks measurement cannot pass quietly. Malformed budget configuration or an unwritable output directory always fails the command. Set `mode` back to `informational` only while recalibrating, never as a permanent state.

Synthetic tests cover shared-chunk deduplication, exact byte/gzip calculations, route bootstrap selection, missing data, safe parsing and CLI exit behavior in both modes. Run `pnpm exec vitest run --coverage.enabled=false scripts/performance-report.test.mjs`.
