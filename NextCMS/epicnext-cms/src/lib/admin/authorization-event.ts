export interface AuthorizationEvent {
	kind: "permission.denied" | "permission.load_error";
	userId: number;
	username?: string;
	rank: number;
	permission?: string;
	source: string;
	reason: string;
	error?: unknown;
}

const clean = (value: string) =>
	value
		.replace(
			/(token|password|secret|cookie|authorization|select|insert|update|delete)[^\s]*/gi,
			"[REDACTED]",
		)
		.slice(0, 160);

export function authorizationActivity(event: AuthorizationEvent) {
	const description = [
		`user=${clean(event.username ?? String(event.userId))}`,
		`rank=${event.rank}`,
		event.permission ? `permission=${clean(event.permission)}` : null,
		`source=${clean(event.source)}`,
		`reason=${clean(event.reason)}`,
	]
		.filter(Boolean)
		.join("; ");
	return {
		staffId: event.userId,
		action: event.kind,
		description,
		targetType: "user",
		targetId: event.userId,
	};
}
