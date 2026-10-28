import {
	type MessageFormatElement,
	parse,
	TYPE,
} from "@formatjs/icu-messageformat-parser";

/** Argument names and rich-text tags are a contract with the calling component. */
export function messageVariables(value: string): string[] {
	const names = new Set<string>();
	function visit(nodes: MessageFormatElement[]) {
		for (const node of nodes) {
			if (node.type !== TYPE.literal && node.type !== TYPE.pound)
				names.add(node.value);
			if (node.type === TYPE.select || node.type === TYPE.plural) {
				for (const option of Object.values(node.options)) visit(option.value);
			}
			if (node.type === TYPE.tag) visit(node.children);
		}
	}
	visit(parse(value));
	return [...names].sort();
}
export function validateCmsMessage(
	value: string,
	source: string,
): "empty" | "invalid" | "variables" | null {
	if (!value.trim()) return "empty";
	try {
		return messageVariables(value).join("\0") ===
			messageVariables(source).join("\0")
			? null
			: "variables";
	} catch {
		return "invalid";
	}
}
