# Catalog Studio code map

`studio-client.tsx` composes the workspace, selection and actions. Keep reusable data handling outside its render tree.

## Shared chrome

- `studio-page.tsx`: consistent header (icon tile, title, subtitle, actions) and padding for every studio sub-page; wraps `AdminPageShell`.

## Client responsibilities

- `studio-filters.ts`: pure filtering and sorting of the loaded furniture list; never mutates the input array.
- `use-studio-translations.ts`: language selection, persisted defaults and translation requests.
- `use-furniture-jobs.ts`: queue submission, retry identity, polling and completion notifications.
- `furniture-jobs.tsx`: job history and retry controls.
- `use-furniture-inspection.ts`: cancellable inspection requests and explicit rechecks.
- `furniture-inspector.tsx`: local component status, source comparison and repair controls.
- `import-review.tsx`: import review, actionable review groups and attachment confirmation.
- `import-recommendation.ts`: completion, conflict and verification recommendations from inspected component evidence.
- `studio-types.ts`: shared client data types.

## Server responsibilities

- `src/lib/services/furniture-inspection.ts`: reads SQL, catalog offers, furnidata and asset presence.
- `src/lib/furni/studio-inspection.ts`: shared validation, comparison and completeness classification.
- `src/lib/services/furniture-repair.ts`: preflight, preservation options and post-repair verification.
- `src/lib/services/furni-job-worker.ts`: durable queued work and per-item results.

Keep client modules free of filesystem/database imports. Background refreshes must not reset open editors or unsaved input. Completion status must come from verification, not optimistic UI flags.

Detail navigation keeps the mounted workspace state and restores the list scroll position and originating control on close. Escape closes an open detail before clearing selection. Furniture responses must belong to the latest list request; source changes invalidate pending detail, review and delete state. Selection is never persisted outside the mounted workspace.
