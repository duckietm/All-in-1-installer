import type { ImportJob } from "@/lib/furni/import-job";

export const furnitureJobFixture: ImportJob = {
	id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
	userId: 42,
	createdAt: "2030-01-01T12:00:00.000Z",
	updatedAt: "2030-01-01T12:00:00.000Z",
	state: "queued",
	translate: false,
	items: [
		{
			id: 1,
			classname: "chair",
			name: "Chair",
			description: "A chair",
			type: "flooritem",
			revision: 1,
			category: "chair",
			state: "pending",
		},
	],
};
export const furnitureCursorFixture = `${furnitureJobFixture.createdAt}|${furnitureJobFixture.id}`;
