// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	abilities: '["*"]',
	queries: [] as string[],
}));
vi.mock("@/lib/db", async () => {
	const { createDbHelpers } = await import("@/test/db-helpers");
	const schema = await import("@/db/schema");
	const { drizzle } = await import("drizzle-orm/mysql-proxy");
	const db = drizzle(async (sql) => {
		state.queries.push(sql);
		if (
			sql.startsWith("select ") &&
			sql.includes(" from `personal_access_tokens`")
		) {
			const token: Record<string, unknown> = {
				id: "9",
				tokenable_id: "42",
				tokenable_type: "App\\Models\\User",
				abilities: state.abilities,
			};
			const columns = sql
				.slice(7, sql.indexOf(" from "))
				.split(", ")
				.map((column) => column.replaceAll("`", ""));
			return { rows: [columns.map((column) => token[column])] };
		}
		return { rows: [] };
	});
	const mockDb = Object.assign(db, {
		execute: async () => [[{ cnt: 0n }], []],
	});
	return {
		...schema,
		...createDbHelpers(mockDb.execute),
		db: mockDb,
	};
});
vi.mock("@/lib/auth", () => ({ auth: async () => ({ user: { id: "77" } }) }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: async () => ({ ok: true }) }));
vi.mock("next/server", async (original) => ({
	...(await original<typeof import("next/server")>()),
	connection: async () => {},
}));
vi.mock("@/lib/redis-cache", () => ({
	apiCacheKey: (key: string) => key,
	cacheSafe: (value: unknown) => value,
	redisCache: async () => ({
		badgeStats: [],
		totalBadges: { entries: [], totalPlayers: 0 },
		achievementLevel: { entries: [], totalPlayers: 0 },
		rarity: {},
	}),
}));

import { POST as articleComment } from "@/app/api/articles/[slug]/comment/route";
import { GET as badgeLeaderboard } from "@/app/api/badges/leaderboard/route";
import { GET as radioPoints } from "@/app/api/radio/points/route";
import { POST as radioShout } from "@/app/api/radio/shouts/route";
import { POST as ticketReply } from "@/app/api/tickets/[id]/reply/route";
import { GET as ticketGet } from "@/app/api/tickets/[id]/route";
import {
	GET as ticketsGet,
	POST as ticketsPost,
} from "@/app/api/tickets/route";

function request(method: string, bearer = true) {
	return new Request("https://hotel.test/api/test", {
		method,
		headers: bearer
			? {
					authorization: "Bearer test-token",
					"content-type": "application/json",
				}
			: {},
		...(method === "POST" ? { body: "{}" } : {}),
	});
}
const protectedRoutes = [
	{
		name: "GET tickets",
		scope: "tickets:read",
		method: "GET",
		run: ticketsGet,
		allowedStatus: 200,
	},
	{
		name: "POST tickets",
		scope: "tickets:write",
		method: "POST",
		run: ticketsPost,
		allowedStatus: 400,
	},
	{
		name: "GET ticket detail",
		scope: "tickets:read",
		method: "GET",
		run: (req: Request) =>
			ticketGet(req, { params: Promise.resolve({ id: "0" }) }),
		allowedStatus: 422,
	},
	{
		name: "POST ticket reply",
		scope: "tickets:write",
		method: "POST",
		run: (req: Request) =>
			ticketReply(req, { params: Promise.resolve({ id: "0" }) }),
		allowedStatus: 422,
	},
	{
		name: "POST article comment",
		scope: "articles:write",
		method: "POST",
		run: (req: Request) =>
			articleComment(req, { params: Promise.resolve({ slug: "article" }) }),
		allowedStatus: 422,
	},
	{
		name: "GET radio points",
		scope: "radio:read",
		method: "GET",
		run: radioPoints,
		allowedStatus: 200,
	},
	{
		name: "POST radio shout",
		scope: "radio:write",
		method: "POST",
		run: radioShout,
		allowedStatus: 422,
	},
];

beforeEach(() => {
	state.abilities = '["*"]';
	state.queries = [];
});
describe("API endpoint token scope boundaries", () => {
	it.each(protectedRoutes)(
		"$name rejects unrelated scopes before accessing endpoint data",
		async ({ scope, method, run }) => {
			state.abilities = JSON.stringify([
				scope.startsWith("tickets:") ? "radio:read" : "tickets:read",
			]);
			const response = await run(request(method));
			expect(response.status).toBe(401);
			expect(await response.json()).toEqual({ error: "Unauthorized" });
			expect(
				state.queries.every((sql) => sql.includes("personal_access_tokens")),
			).toBe(true);
		},
	);
	it.each(protectedRoutes)(
		"$name accepts its documented scope",
		async ({ scope, method, run, allowedStatus }) => {
			state.abilities = JSON.stringify([scope]);
			expect((await run(request(method))).status).toBe(allowedStatus);
		},
	);
	it.each(protectedRoutes)(
		"$name preserves existing wildcard tokens",
		async ({ method, run, allowedStatus }) => {
			expect((await run(request(method))).status).toBe(allowedStatus);
		},
	);
	it("does not let a read-only ticket token create a ticket", async () => {
		state.abilities = '["tickets:read"]';
		expect((await ticketsPost(request("POST"))).status).toBe(401);
	});
	it("does not let a read-only radio token post a shout", async () => {
		state.abilities = '["radio:read"]';
		expect((await radioShout(request("POST"))).status).toBe(401);
	});
	it("does not use session cookies to bypass a denied bearer scope on the public leaderboard", async () => {
		state.abilities = '["tickets:read"]';
		const response = await badgeLeaderboard(request("GET"));
		expect((await response.json()).viewerUserId).toBe(0);
	});
	it("personalizes the leaderboard only for the badges scope", async () => {
		state.abilities = '["badges:read"]';
		expect(
			(await (await badgeLeaderboard(request("GET"))).json()).viewerUserId,
		).toBe(42);
	});
	it("preserves session-only leaderboard personalization without a bearer header", async () => {
		expect(
			(await (await badgeLeaderboard(request("GET", false))).json())
				.viewerUserId,
		).toBe(77);
	});
});
