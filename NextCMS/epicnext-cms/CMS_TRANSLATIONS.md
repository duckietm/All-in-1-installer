# CMS translation audit and editor

The CMS editor at `/admin/translations/cms` now uses the same bundled catalogs as the request-time translator. Runtime changes are stored separately in `storage/cms-translations/<locale>.json`, inside the existing persistent `/app/storage` mount. No source-file write, environment-variable change or rebuild is required to apply an edit.

Only overrides are saved. Unchanged messages continue to receive updates from Git. Saves use a file lock, an atomic replacement and a revision check; a stale editor cannot overwrite another operator's changes. ICU syntax, argument names, rich-text tags and allowed keys are checked server-side. Invalid or obsolete overrides are excluded when reading a new release. Storage read errors are reported to the CMS error monitor and public pages fall back to bundled text.

The page starts in the operator's language. It shows all English reference keys, including missing translations, and supports search by key, translated text or English source. Filters separate missing, identical and modified text. Drafts survive language switches and failed saves. Users without `SETTINGS_EDIT` can review and export but cannot save.

## Audit outcome, 6 September 2026

- Scanned 25 JSON catalogs; 22 languages are selectable. The small Arabic, Finnish and Japanese catalogs are legacy files and remain outside the supported locale list.
- Repaired 66 malformed ICU messages across the 22 active catalogs, including HTML fragments and unescaped JSON examples.
- Added 199 missing English reference keys used by page components, with Italian translations, and fixed the incorrect navigation namespace in the admin error page.
- Completed the 31 previously missing Italian reference keys.
- Repaired missing `count` and `preset` variables in other locales.
- Final checks: zero malformed messages, zero argument/tag mismatches and zero missing references among the statically resolved translation calls.
- English contains 3,423 reference keys. Italian covers all of them; 629 values match English. Dutch is missing 524 reference keys and has 618 identical values. Matching English can be intentional for names and technical labels; this is not proof of translation quality.
- Found 1,577 literal JSX text candidates outside translation calls. These include labels, technical strings and names; they are an editorial inventory, not 1,577 confirmed bugs. The largest concentrations are the catalog item table (118), Studio main component (79), import audit (53), sound management (50) and permission editor (42).

## Repeatable checks

- `pnpm i18n:check`: fails on malformed messages, incompatible variables/tags, empty messages, source parsing errors or missing statically referenced keys. Runs in Gitea CI.
- `pnpm i18n:audit`: prints coverage and findings.
- `node scripts/audit-cms-translations.mjs --json`: full machine-readable inventory, including file and line references for literal JSX candidates.

Static analysis resolves literal translator namespaces and literal message keys. Dynamic key construction, prose embedded in arbitrary JavaScript strings, and the linguistic accuracy of all 22 translations still require targeted review. English fallback remains explicit; copying English into other catalogs would hide untranslated entries and is intentionally avoided.

## Validation

Automated tests exercise message syntax, actual translator output, persistent overrides, invalid-message rejection, revision conflicts and reset behavior. A browser fixture mounts the real editor and verifies missing-key editing, validation, failed-save preservation, language switching, successful saves, read-only access and mobile layout. Server actions are simulated in that fixture; authenticated production editing requires a staff session.
