import { expect, it } from "vitest";
import { createFurnitureImportRequests } from "./furniture-import-requests";

function storage() {
	const entries = new Map<string, string>();
	return {
		entries,
		getItem: (key: string) => entries.get(key) ?? null,
		setItem: (key: string, value: string) => {
			entries.set(key, value);
		},
		removeItem: (key: string) => {
			entries.delete(key);
		},
	};
}
it("reuses an uncertain request across reloads without storing furniture content", async () => {
	const saved = storage();
	const first = await createFurnitureImportRequests(7, () => saved).get(
		'{"name":"private furniture"}',
	);
	const resumed = await createFurnitureImportRequests(7, () => saved).get(
		'{"name":"private furniture"}',
	);
	expect(resumed.id).toBe(first.id);
	expect(JSON.stringify([...saved.entries])).not.toContain("private furniture");
});
it("keeps pending requests distinct across accounts and changed selections", async () => {
	const saved = storage();
	const client = createFurnitureImportRequests(7, () => saved);
	const first = await client.get("chair");
	const second = await client.get("lamp");
	const other = await createFurnitureImportRequests(8, () => saved).get(
		"chair",
	);
	expect(new Set([first.id, second.id, other.id]).size).toBe(3);
	expect((await client.get("chair")).id).toBe(first.id);
});
it("starts a new request only after the previous one was acknowledged", async () => {
	const saved = storage();
	const client = createFurnitureImportRequests(7, () => saved);
	const pending = await client.get("chair");
	client.acknowledge(pending);
	expect(
		(await createFurnitureImportRequests(7, () => saved).get("chair")).id,
	).not.toBe(pending.id);
});
it("keeps request identity in memory if session storage is unavailable", async () => {
	const client = createFurnitureImportRequests(7, () => {
		throw Error("denied");
	});
	const pending = await client.get("chair");
	expect((await client.get("chair")).id).toBe(pending.id);
	client.acknowledge(pending);
	expect((await client.get("chair")).id).not.toBe(pending.id);
});
it("does not persist an unscoped request and ignores corrupt saved IDs", async () => {
	const saved = storage();
	await createFurnitureImportRequests(undefined, () => saved).get("chair");
	expect(saved.entries.size).toBe(0);
	const first = await createFurnitureImportRequests(7, () => saved).get(
		"chair",
	);
	saved.setItem(first.key, "../invalid");
	const repaired = await createFurnitureImportRequests(7, () => saved).get(
		"chair",
	);
	expect(repaired.id).not.toBe("../invalid");
	expect(saved.getItem(first.key)).toBe(repaired.id);
});
