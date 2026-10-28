# Isolated UI regression checks

Run `pnpm test:ui` after `pnpm install --frozen-lockfile` and `pnpm exec playwright install chromium`.
The fixture server bundles real CMS components with local HTTP/server-action fixtures. It does not use the database or production credentials. Production smoke tests remain in the separate `pnpm test:e2e` command.

The suite covers accessible settings switches, news editor/preview, support-table filters, import history, attachment recovery and news/event recovery. Axe checks WCAG A/AA rules. The sandboxed preview cannot execute Axe; its accessible name and keyboard exit are checked separately. Automated checks do not replace a full accessibility audit.

Visual references are committed under `__screenshots__/<platform>/<viewport>`. Normal runs compare references and must not update them. For an intentional UI change, use `pnpm test:ui:update`, inspect every changed PNG and commit only accepted references. Keep the Playwright browser version aligned with the lockfile. Linux references must be captured on the Linux runner; Windows references are not interchangeable.

Fixtures contain synthetic data only. Do not add production requests, environment secrets, ignored local documents or database access to tests. CI retains test reports and failures as the `ui-results` artifact.
