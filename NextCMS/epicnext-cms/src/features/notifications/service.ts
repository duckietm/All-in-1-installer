export type Category = "support" | "friends" | "events";
export type Preferences = Record<Category, boolean>;
export type Notification = {
	key: string;
	category: Category;
	title: string;
	href: string;
	occurredAt: string | null;
};
export interface NotificationRepository {
	source(userId: number): Promise<Notification[]>;
	reads(userId: number, keys: string[]): Promise<string[]>;
	mark(userId: number, key: string): Promise<void>;
	preferences(userId: number): Promise<Preferences>;
	savePreferences(userId: number, preferences: Preferences): Promise<void>;
}
function account(userId: number) {
	if (!Number.isSafeInteger(userId) || userId < 1)
		throw new Error("Invalid user");
}
export function createNotificationService(repo: NotificationRepository) {
	return {
		async feed(userId: number, requestedPage: number) {
			account(userId);
			const [source, preferences] = await Promise.all([
				repo.source(userId),
				repo.preferences(userId),
			]);
			const reads = await repo.reads(
				userId,
				source.map((item) => item.key),
			);
			const read = new Set(reads);
			const items = source
				.filter((item) => preferences[item.category])
				.map((item) => ({ ...item, read: read.has(item.key) }));
			const pages = Math.max(1, Math.ceil(items.length / 20));
			const page = Number.isSafeInteger(requestedPage)
				? Math.max(1, Math.min(pages, requestedPage))
				: 1;
			return {
				items: items.slice((page - 1) * 20, page * 20),
				page,
				pages,
				unread: items.filter((item) => !item.read).length,
				preferences,
			};
		},
		async mark(userId: number, key: string) {
			account(userId);
			if (!(await repo.source(userId)).some((item) => item.key === key))
				return false;
			await repo.mark(userId, key);
			return true;
		},
		async preferences(userId: number, preferences: Preferences) {
			account(userId);
			await repo.savePreferences(userId, preferences);
		},
	};
}
export type NotificationFeed = Awaited<
	ReturnType<ReturnType<typeof createNotificationService>["feed"]>
>;
