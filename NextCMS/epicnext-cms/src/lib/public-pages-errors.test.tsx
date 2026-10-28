import { createTranslator, NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import GuildThread from "@/app/(site)/guilds/[id]/forum/[threadId]/page";
import GuildForum from "@/app/(site)/guilds/[id]/forum/page";
import GuildDetail from "@/app/(site)/guilds/[id]/page";
import messages from "@/messages/en.json";

const state = vi.hoisted(() => ({
	fail: new Set<string>(),
	rows: {} as Record<string, unknown[]>,
	log: vi.fn(),
}));
vi.mock("next/navigation", () => ({
	notFound: () => {
		throw Error("NOT_FOUND");
	},
}));
vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.mock("@/actions/social", () => ({ replyToThread: async () => {} }));
vi.mock("@/lib/logger", () => ({ logger: { error: state.log } }));
vi.mock("@/lib/cache", () => ({
	cached: (_key: string, _ttl: number, load: () => unknown) => load(),
}));
vi.mock("@/lib/services/site-settings", () => ({
	siteSettings: { get: async () => "7" },
}));
vi.mock("next-intl/server", () => ({
	getTranslations: async (
		namespace:
			| "pages.staff"
			| "pages.rankings"
			| "pages.photos"
			| "pages.guilds"
			| "pages.guild"
			| "pages.guildForum"
			| "pages.guildForumThread",
	) => createTranslator({ locale: "en", messages, namespace }),
}));
vi.mock("@/components/shared/profile-image", () => ({
	ProfileImage: () => null,
}));
vi.mock("@/components/shared/user-avatar-thumbnail", () => ({
	UserAvatarThumbnail: () => null,
}));
vi.mock("@/components/public/photo-lightbox", () => ({
	PhotoLightbox: () => null,
}));
vi.mock("@/lib/db", async () => {
	const schema = await import("@/db/schema");
	const { getTableName } = await import("drizzle-orm");
	return {
		...schema,
		db: {
			select: () => {
				let name = "";
				const load = async () => {
					if (state.fail.has(name)) throw Error("fixture unavailable");
					if (state.rows[name]) return state.rows[name];
					return name === "users"
						? [
								{
									username: "Available member",
									look: "",
									rank: 7,
									motto: "Hello",
									credits: 100,
									online: "1",
								},
							]
						: [];
				};
				const query = {
					from: (table: Parameters<typeof getTableName>[0]) => {
						name = getTableName(table);
						return query;
					},
					where: () => query,
					orderBy: () => query,
					limit: () => query,
					// biome-ignore lint/suspicious/noThenProperty: models Drizzle lazy query execution
					then: (...args: Parameters<ReturnType<typeof load>["then"]>) =>
						load().then(...args),
					catch: (...args: Parameters<ReturnType<typeof load>["catch"]>) =>
						load().catch(...args),
				};
				return query;
			},
		},
	};
});

import Guilds from "@/app/(site)/guilds/page";
import Photos from "@/app/(site)/photos/page";
import Rankings from "@/app/(site)/rankings/page";
import Staff from "@/app/(site)/staff/page";
import { publicReadFailure } from "@/lib/services/public-read";

const copy = {
	loadError: "Section unavailable",
	retry: "Retry",
	unavailable: "Unavailable",
};
async function render(page: () => Promise<React.ReactNode>) {
	return renderToStaticMarkup(
		<NextIntlClientProvider
			locale="en"
			messages={{ ...messages, publicData: copy }}
		>
			{await page()}
		</NextIntlClientProvider>,
	);
}
describe("public page read failures", () => {
	beforeEach(() => {
		state.fail.clear();
		state.rows = {};
		state.log.mockClear();
	});
	it.each([
		[Rankings, "users"],
		[Photos, "camera_web"],
		[Guilds, "guilds"],
	] as const)(
		"shows failure and retry instead of empty results",
		async (page, table) => {
			state.fail.add(table);
			const html = await render(page);
			expect(html).toContain('role="alert"');
			expect(html).toContain("Section unavailable");
			expect(html).toContain("Retry");
			expect(state.log).toHaveBeenCalled();
		},
	);
	it.each([Photos, Guilds])(
		"keeps genuine empty results distinct",
		async (page) => {
			const html = await render(page);
			expect(html).not.toContain('role="alert"');
			expect(state.log).not.toHaveBeenCalled();
		},
	);
	it("preserves staff members when team metadata fails", async () => {
		state.fail.add("website_teams");
		const html = await render(Staff);
		expect(html).toContain("Available member");
		expect(html).toContain("Section unavailable");
		expect(state.log).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({ section: "staff.teams" }),
		);
	});
	it("returns null and logs section context without changing successful values", async () => {
		const fail = publicReadFailure("home.news");
		const error = Error("unavailable");
		expect(await Promise.reject(error).catch(fail)).toBeNull();
		expect(await Promise.resolve([]).catch(fail)).toEqual([]);
		expect(await Promise.resolve(0).catch(fail)).toBe(0);
		expect(state.log).toHaveBeenCalledTimes(1);
	});
});

const detailPages = [
	() => GuildDetail({ params: Promise.resolve({ id: "1" }) }),
	() =>
		GuildForum({
			params: Promise.resolve({ id: "1" }),
			searchParams: Promise.resolve({}),
		}),
	() =>
		GuildThread({
			params: Promise.resolve({ id: "1", threadId: "2" }),
			searchParams: Promise.resolve({}),
		}),
];
describe("guild detail failures", () => {
	beforeEach(() => {
		state.fail.clear();
		state.log.mockClear();
		state.rows = {
			guilds: [
				{
					id: 1,
					name: "Available guild",
					description: "Community",
					badge: "",
					userId: 7,
					dateCreated: 1000,
				},
			],
			guilds_forums_threads: [
				{
					id: 2,
					subject: "Available thread",
					locked: 0,
					pinned: 0,
					openerId: 7,
					postsCount: 1,
					createdAt: 1000,
					updatedAt: 1000,
				},
			],
			guilds_forums_comments: [
				{ id: 3, userId: 7, message: "Available post", createdAt: 1000 },
			],
		};
	});
	it.each(detailPages)(
		"shows database failures without claiming a missing guild",
		async (page) => {
			state.fail.add("guilds");
			const html = await render(page);
			expect(html).toContain("Section unavailable");
		},
	);
	it.each(detailPages)("keeps real missing guilds as 404", async (page) => {
		state.rows.guilds = [];
		await expect(render(page)).rejects.toThrow("NOT_FOUND");
	});
	it("keeps guild metadata when members fail and avoids a false zero", async () => {
		state.fail.add("guilds_members");
		const html = await render(detailPages[0]);
		expect(html).toContain("Available guild");
		expect(html).toContain("Section unavailable");
		expect(html).toContain("—");
	});
	it("keeps forum threads when author names fail", async () => {
		state.fail.add("users");
		const html = await render(detailPages[1]);
		expect(html).toContain("Available thread");
		expect(html).toContain("Section unavailable");
	});
	it("keeps the thread header when posts fail", async () => {
		state.fail.add("guilds_forums_comments");
		const html = await render(detailPages[2]);
		expect(html).toContain("Available thread");
		expect(html).toContain("Section unavailable");
	});
});
