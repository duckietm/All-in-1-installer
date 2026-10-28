export interface PermissionSet {
	has(permission: string): boolean;
	hasAny(...permissions: string[]): boolean;
	hasAll(...permissions: string[]): boolean;
	isSuperAdmin: boolean;
}

export type WebhookAction =
	| "ban"
	| "unban"
	| "kick"
	| "disconnect"
	| "room_delete"
	| "user_edit"
	| "user_create"
	| "news_publish"
	| "news_delete"
	| "hotel_alert"
	| "staff_alert"
	| "ticket_create"
	| "event_create"
	| "event_update"
	| "event_cancel"
	| "poll_create"
	| "poll_close";

type AvatarSize = "s" | "m" | "l";
type Direction = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface AvatarOptions {
	/** Avatar size: s (small), m (medium), l (large) */
	size?: AvatarSize;
	/** Body direction (0-7) */
	direction?: Direction;
	/** Head direction (0-7) */
	headDirection?: Direction;
	/** Show only the head */
	headOnly?: boolean;
	/** Gesture: sml (smile), srp (surprised), sad, etc. */
	gesture?: string;
	/** Action: wav, sit, lay, etc. */
	action?: string;
	/** Effect ID (e.g., 14 for ghost) */
	effect?: string | number;
	/** Image format (e.g., "png", "apng") */
	img_format?: string;
}
