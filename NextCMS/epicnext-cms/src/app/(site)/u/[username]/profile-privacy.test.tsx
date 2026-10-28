import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ self: false, tables: [] as unknown[] }));
vi.mock("@/actions/guestbook", () => ({ postGuestbook: vi.fn() }));
vi.mock("@/actions/social", () => ({ sendFriendRequest: vi.fn() }));
vi.mock("@/lib/auth", () => ({
	auth: async () => (state.self ? { user: { id: "42" } } : null),
}));
vi.mock("@/lib/services/profile-privacy", () => ({
	loadProfilePrivacy: async () => ({
		values: {
			wallet: false,
			online: false,
			friends: false,
			photos: false,
			registered: false,
		},
		unavailable: false,
	}),
}));
vi.mock("next-intl/server", () => ({
	getTranslations: async () =>
		Object.assign((key: string) => key, { has: () => true }),
}));
vi.mock("@/lib/format-date", () => ({
	formatDate: () => "PRIVATE_REGISTRATION_DATE",
}));
vi.mock("@/components/link", () => ({
	default: ({ href, children }: { href: string; children: ReactNode }) => (
		<a href={href}>{children}</a>
	),
}));
vi.mock("@/components/public/ui", () => ({
	ContentCard: ({
		title,
		children,
	}: {
		title: string;
		children: ReactNode;
	}) => (
		<section>
			<h2>{title}</h2>
			{children}
		</section>
	),
	EmptyState: ({ children }: { children: ReactNode }) => <p>{children}</p>,
	OnlineBadge: () => <span>PRIVATE_ONLINE_STATUS</span>,
}));
vi.mock("@/components/shared/currency-icon", () => ({
	CurrencyIcon: () => <span>currency-icon</span>,
}));
vi.mock("@/lib/db", async () => {
	const schema = await import("@/db/schema");
	return {
		...schema,
		db: {
			select: () => {
				let rows: unknown[] = [];
				const chain = {
					from: (table: unknown) => {
						state.tables.push(table);
						rows =
							table === schema.User
								? [
										{
											id: 42,
											username: "Alice",
											motto: "Hello",
											look: "",
											credits: 987654321,
											online: "1",
											accountCreated: 100,
										},
									]
								: [];
						return chain;
					},
					where: () => chain,
					orderBy: () => chain,
					limit: () => chain,
					catch: () => Promise.resolve(rows),
					// biome-ignore lint/suspicious/noThenProperty: Drizzle query builders are awaitable.
					then: (resolve: (rows: unknown[]) => unknown) =>
						Promise.resolve(rows).then(resolve),
				};
				return chain;
			},
		},
	};
});

import { CameraWeb, MessengerFriendships, UsersCurrency } from "@/lib/db";
import ProfilePage from "./page";

describe("profile visibility rendering", () => {
	beforeEach(() => {
		state.self = false;
		state.tables = [];
	});
	it("omits private fields from visitor HTML and skips sensitive section queries", async () => {
		const html = renderToStaticMarkup(
			await ProfilePage({
				params: Promise.resolve({ username: "Alice" }),
				searchParams: Promise.resolve({}),
			}),
		);
		expect(html).toContain("Alice");
		expect(html).not.toContain("walletTitle");
		expect(html).not.toContain("PRIVATE_ONLINE_STATUS");
		expect(html).not.toContain("PRIVATE_REGISTRATION_DATE");
		expect(html).not.toContain("photosTitle");
		expect(html).not.toContain("friendsTitle");
		expect(state.tables).not.toContain(CameraWeb);
		expect(state.tables).not.toContain(MessengerFriendships);
		expect(state.tables).not.toContain(UsersCurrency);
	});
	it("lets the owner inspect their data with an explicit visibility-settings link", async () => {
		state.self = true;
		const html = renderToStaticMarkup(
			await ProfilePage({
				params: Promise.resolve({ username: "Alice" }),
				searchParams: Promise.resolve({}),
			}),
		);
		expect(html).toContain("walletTitle");
		expect(html).toContain("PRIVATE_ONLINE_STATUS");
		expect(html).toContain("/settings#profile-privacy");
	});
});
