# Notification center

Account-scoped live inbox at `/notifications`, reachable through the account menu. The authenticated session is the only source of the user ID. Source queries select only owned support tickets, incoming friend requests, and the user's published upcoming event registrations.

Each source is capped at 100 rows and the resulting feed uses server-clamped pages of 20. Read state uses the immutable support reply/request ID or event ID + registration ID + scheduled start. Repeated marks are idempotent; a new reply or rescheduled event is unread. Categories are opt-out preferences for this inbox only. No email is sent.

Persistence is additive via `0032_notification_state.sql`. Apply it through the normal deployment migration runner before enabling the page. No production migration was run during implementation.

Implementation: domain service and authorization tests; Drizzle source/state repository; strict authenticated GET/POST API; Query-powered public UI with loading, empty, retry and mutation-error states; translated en/it/nl labels; desktop/mobile fixture tests. The UI fixture verifies the real client component with mocked network responses; it does not prove live database integration.

The inbox is a bounded current feed, not a historical notification archive. Removed requests and past/unpublished/unregistered events disappear. Support includes the 100 latest replies from someone other than the ticket owner, including closed tickets. Friend request tables have no timestamp, so the UI does not invent one. Read state stays stored when a category is disabled or the source leaves the live window.

The exported component owns its query provider, matching the public route in UI tests. The visible inbox refreshes every 30 seconds and cancels abandoned requests. No browser fixture supplies hidden providers.
