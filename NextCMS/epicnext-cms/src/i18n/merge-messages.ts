export type MessageTree = { [key: string]: string | MessageTree };

/** Fill missing translations before sending messages to server and client consumers. */
export function mergeMessages(
	fallback: MessageTree,
	localized: MessageTree,
): MessageTree {
	const result: MessageTree = { ...fallback };
	for (const [key, value] of Object.entries(localized)) {
		const base = fallback[key];
		result[key] =
			typeof value === "object" && typeof base === "object"
				? mergeMessages(base, value)
				: value;
	}
	return result;
}
