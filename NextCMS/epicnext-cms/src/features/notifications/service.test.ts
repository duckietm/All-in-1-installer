// @ts-nocheck
import { describe, expect, it } from "vitest";
import {
	createNotificationService,
	type NotificationRepository,
	type Preferences,
} from "./service";

const item = {
	key: "support:4",
	category: "support" as const,
	title: "Ticket",
	href: "/help/tickets/2",
	occurredAt: null,
};
function fixture() {
	const reads = new Set<string>();
	const preferences = new Map<number, Preferences>();
	let items = [item];
	const repository: NotificationRepository = {
		source: async (uid) => (uid === 1 ? items : []),
		reads: async (uid) =>
			[...reads]
				.filter((k) => k.startsWith(`${uid}/`))
				.map((k) => k.split("/")[1]),
		mark: async (uid, key) => {
			reads.add(`${uid}/${key}`);
		},
		preferences: async (uid) =>
			preferences.get(uid) ?? { support: true, friends: true, events: true },
		savePreferences: async (uid, value) => {
			preferences.set(uid, value);
		},
	};
	return {
		service: createNotificationService(repository),
		reads,
		reply: () => {
			items = [{ ...item, key: "support:5" }];
		},
		many: () => {
			items = Array.from({ length: 45 }, (_, i) => ({
				...item,
				key: `support:${i}`,
			}));
		},
	};
}
describe("notification account isolation", () => {
	it("rejects invalid account identifiers for every operation", async () => {
		const { service } = fixture();
		for (const uid of [0, -1, Number.NaN, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
			await expect(service.feed(uid, 1)).rejects.toThrow();
			await expect(service.mark(uid, item.key)).rejects.toThrow();
			await expect(
				service.preferences(uid, {
					support: true,
					friends: true,
					events: true,
				}),
			).rejects.toThrow();
		}
	});
	it("cannot read or mark another account's notification", async () => {
		const f = fixture();
		expect((await f.service.feed(2, 1)).items).toEqual([]);
		expect(await f.service.mark(2, item.key)).toBe(false);
		expect(f.reads.size).toBe(0);
	});
	it("persists idempotent reads but a new reply remains unread", async () => {
		const f = fixture();
		await f.service.mark(1, item.key);
		await f.service.mark(1, item.key);
		expect(f.reads.size).toBe(1);
		expect((await f.service.feed(1, 1)).items[0].read).toBe(true);
		f.reply();
		expect((await f.service.feed(1, 1)).items[0].read).toBe(false);
	});
	it("isolates preferences and retains reads across disabled categories", async () => {
		const f = fixture();
		await f.service.mark(1, item.key);
		await f.service.preferences(1, {
			support: false,
			friends: true,
			events: true,
		});
		const hidden = await f.service.feed(1, 1);
		expect(hidden.items).toEqual([]);
		expect(hidden.unread).toBe(0);
		expect((await f.service.feed(2, 1)).preferences.support).toBe(true);
		await f.service.preferences(1, {
			support: true,
			friends: true,
			events: true,
		});
		expect((await f.service.feed(1, 1)).items[0].read).toBe(true);
	});
	it("paginates the feed with total unread count and clamps hostile page numbers", async () => {
		const f = fixture();
		f.many();
		expect((await f.service.feed(1, Number.POSITIVE_INFINITY)).page).toBe(1);
		const last = await f.service.feed(1, 999);
		expect(last.page).toBe(3);
		expect(last.items).toHaveLength(5);
		expect(last.unread).toBe(45);
	});
});
