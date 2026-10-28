import { MySqlDialect } from "drizzle-orm/mysql-core";
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	sql: [] as string[],
	tables: [] as string[],
	failLogs: false,
}));
vi.mock("next/navigation", () => ({
	notFound: () => {
		throw new Error("not found");
	},
}));
vi.mock("@/lib/db", async () => {
	const tables = Object.fromEntries(
		["User", "Rooms", "RoomTradeLog", "UsersBadges", "UsersCurrency"].map(
			(name) => [name, { name }],
		),
	);
	const db = {
		select() {
			let name = "";
			const rows = () =>
				name === "User"
					? [{ id: 42, username: "User", rank: 2, online: "0" }]
					: [];
			const query = {
				from(table: { name: string }) {
					name = table.name;
					state.tables.push(name);
					return query;
				},
				where() {
					return query;
				},
				orderBy() {
					return query;
				},
				limit() {
					return query;
				},
				// biome-ignore lint/suspicious/noThenProperty: Drizzle queries are intentionally awaitable.
				then(resolve: (value: unknown[]) => unknown) {
					return Promise.resolve(rows()).then(resolve);
				},
				catch() {
					return Promise.resolve(rows());
				},
			};
			return query;
		},
		async execute(query: Parameters<MySqlDialect["sqlToQuery"]>[0]) {
			const compiled = new MySqlDialect().sqlToQuery(query).sql;
			state.sql.push(compiled);
			if (state.failLogs && compiled.includes("chatlogs_room"))
				throw new Error("unavailable");
			return [[], []];
		},
	};
	return {
		...tables,
		db,
		...(await import("@/test/db-helpers")).createDbHelpers(db.execute),
	};
});

import { loadUserById } from "./load-user";

beforeEach(() => {
	state.sql = [];
	state.tables = [];
	state.failLogs = false;
});
it("skips chat, commands, trade and ban queries when excluded by profile ACL", async () => {
	const user = await loadUserById("42", { logs: false, bans: false });
	expect(state.sql.join(" ")).not.toMatch(
		/chatlogs_room|commandlogs|FROM bans/,
	);
	expect(state.tables).not.toContain("RoomTradeLog");
	expect(user.chatLogs).toEqual([]);
	expect(user.commandLogs).toEqual([]);
	expect(user.user.bansReceived).toEqual([]);
});
it("keeps the user profile available and identifies a failed activity source", async () => {
	state.failLogs = true;
	const user = await loadUserById("42", { logs: true, bans: false });
	expect(user.user.id).toBe(42);
	expect(user.activityUnavailable).toBe(true);
});
