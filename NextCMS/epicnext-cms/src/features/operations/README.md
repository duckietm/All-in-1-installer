# Durable operations and background updates

Bulk offer apply and undo accept a request UUID. The authenticated actor, operation kind and UUID identify one mutation. A canonical payload hash rejects reuse for different changes. The result and outbox entries commit in the same database transaction as the offers and audit history; replay returns the stored result.

The jobs worker claims pending effects under a database lock with a 120-second lease. A claim token protects completion from stale workers. Failed delivery uses exponential retry, stopping after eight attempts. `/admin/devops/deliveries` shows the latest 100 effects to DEVOPS_VIEW; DEVOPS_EDIT can retry failed effects without replaying the catalog mutation.

Delivery is at least once: a crash after sending and before acknowledgement may repeat an effect. Catalog refresh is repeatable; export delivery means a request entered the existing export queue, not that Git publication or client refresh completed. Export disabled by configuration remains a no-op. Adapters cover bulk offer apply/undo and manual/scheduled news cache refresh, not every CMS mutation.

Migration0031 is required before the updated worker starts. Unit tests cover payload identity, dispatch limits, retries and authorization; the separate Docker integration suite covers concurrent SQL requests, transaction rollback and claim ownership. No production database was used for local tests.


The delivery screen separates saved content from its subsequent background update. New news operations persist only the article identifier and title alongside the existing result; no article body is stored for display. Article IDs remain strings to preserve bigint precision. Older records retain readable status and technical references even when no content metadata exists. Catalog operations show affected-offer counts; furniture import progress remains in the linked import history.

Content titles and links require the corresponding NEWS_VIEW or CATALOG_VIEW grant in addition to DEVOPS_VIEW. Raw result JSON and internal error text are never forwarded to the card. Each record shows its recorded time, staff/system actor, attempts, and scheduled retry time when applicable. Failures point to service diagnostics; exhausted attempts expose the existing permission-protected retry without repeating the content mutation. Delivery success does not imply Git publication or client refresh acknowledgement.

Browser fixtures verify the real cards on desktop/mobile, including long titles, denied metadata, exact links, unknown states and collapsed technical references. The fixture retry slot does not execute a backend action; backend authorization and state changes have separate tests.


Delivery failures retain the original exception in the redacted CMS diagnostic store,
alongside a delivery UUID and the persisted operation UUID. Request correlation is
kept separately. Only the diagnostic UUID is stored in the outbox error field.
The delivery card opens the matching error record; that record links back to the
exact delivery, including records older than the latest 100 entries. Refresh keeps
this selection. A historical diagnostic lookup shows that occurrence's context and
stack while retaining the current group's assignment and resolution status.

These links require existing DevOps access. Expired diagnostic records may no longer
be available after the error store's retention window; the delivery state remains
in SQL. Retry continues to require edit permission and an exhausted delivery.
