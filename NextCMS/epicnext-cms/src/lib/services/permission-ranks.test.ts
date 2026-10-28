// @ts-nocheck
import type { SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { describe, expect, it } from "vitest";

import {
	fetchEmulatorRankForEdit,
	getRankPermissionColumn,
	RANK_GENERAL_FIELDS,
	splitRankUpdateFields,
	toPermissionValue,
} from "./permission-ranks";

const dialect = new MySqlDialect();

function queryText(query: SQL | string) {
	return typeof query === "string" ? query : dialect.sqlToQuery(query).sql;
}

describe("getRankPermissionColumn", () => {
	it("returns rank_N for valid rank", () => {
		expect(getRankPermissionColumn(1)).toBe("rank_1");
		expect(getRankPermissionColumn(255)).toBe("rank_255");
	});

	it("throws for invalid rank", () => {
		expect(() => getRankPermissionColumn(0)).toThrow("Invalid rank id");
		expect(() => getRankPermissionColumn(256)).toThrow("Invalid rank id");
		expect(() => getRankPermissionColumn(1.5)).toThrow("Invalid rank id");
		expect(() => getRankPermissionColumn(-1)).toThrow("Invalid rank id");
	});
});

describe("toPermissionValue", () => {
	it("returns numeric value for valid input", () => {
		expect(toPermissionValue(5)).toBe(5);
		expect(toPermissionValue("10")).toBe(10);
		expect(toPermissionValue("255")).toBe(255);
	});

	it("clamps to 0-255 range", () => {
		expect(toPermissionValue(-1)).toBe(0);
		expect(toPermissionValue(256)).toBe(255);
		expect(toPermissionValue(999)).toBe(255);
	});

	it("returns 0 for non-numeric strings", () => {
		expect(toPermissionValue("abc")).toBe(0);
		expect(toPermissionValue(NaN)).toBe(0);
	});
});

describe("splitRankUpdateFields", () => {
	it("splits rank general fields from permission fields", () => {
		const { rankFields, permissionFields } = splitRankUpdateFields({
			rank_name: "Moderator",
			level: 5,
			cmd_ban: "1",
			cmd_kick: "1",
		});
		expect(rankFields).toEqual({ rank_name: "Moderator", level: 5 });
		expect(permissionFields).toEqual({ cmd_ban: 1, cmd_kick: 1 });
	});

	it("skips id field and invalid keys", () => {
		const { rankFields, permissionFields } = splitRankUpdateFields({
			id: 5,
			"": "test",
		});
		expect(rankFields).toEqual({});
		expect(permissionFields).toEqual({});
	});

	it("returns empty objects for empty input", () => {
		const { rankFields, permissionFields } = splitRankUpdateFields({});
		expect(rankFields).toEqual({});
		expect(permissionFields).toEqual({});
	});
});

describe("RANK_GENERAL_FIELDS", () => {
	it("contains expected fields", () => {
		expect(RANK_GENERAL_FIELDS.has("rank_name")).toBe(true);
		expect(RANK_GENERAL_FIELDS.has("badge")).toBe(true);
		expect(RANK_GENERAL_FIELDS.has("level")).toBe(true);
		expect(RANK_GENERAL_FIELDS.has("nonexistent")).toBe(false);
	});
});

describe("fetchEmulatorRankForEdit", () => {
	it("loads permissions from the legacy table when permission_definitions is absent", async () => {
		const db = {
			execute: async (query: SQL | string) => {
				const text = queryText(query);
				if (text.includes("FROM permission_ranks")) {
					return [
						[
							{
								id: 11,
								rank_name: "Developer",
								level: 11,
							},
						],
						[],
					];
				}
				if (text.includes("FROM information_schema.columns")) {
					return [[], []];
				}
				if (text.includes("FROM permissions")) {
					return [
						[
							{
								id: 11,
								rank_name: "Developer",
								level: 11,
								cmd_ban: 1,
								cmd_owner: 2,
							},
						],
						[],
					];
				}
				throw new Error(`Unexpected query: ${text}`);
			},
			transaction: async () => {
				throw new Error("Unexpected transaction");
			},
		};

		await expect(
			fetchEmulatorRankForEdit(db as never, 11),
		).resolves.toMatchObject({
			id: 11,
			permissions: { cmd_ban: "1", cmd_owner: "2" },
			permissionMaxValues: { cmd_ban: 1, cmd_owner: 2 },
		});
	});
});
