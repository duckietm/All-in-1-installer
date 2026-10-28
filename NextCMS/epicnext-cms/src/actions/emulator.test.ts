// @ts-nocheck
import { describe, expect, it, vi } from "vitest";
import { rcon } from "@/lib/services/rcon";

const { insertValues } = vi.hoisted(() => {
	const insertValues = vi.fn(() => ({
		onDuplicateKeyUpdate: vi.fn().mockResolvedValue([{ affectedRows: 1 }]),
	}));
	return { insertValues };
});

vi.mock("@/lib/permissions", () => ({
	PERMS: { SETTINGS_EDIT: "settings.edit" },
}));
vi.mock("@/lib/db", () => ({
	db: {
		insert: vi.fn(() => ({ values: insertValues })),
	},
	EmulatorSettings: { key: "key", value: "value" },
}));
vi.mock("@/lib/safe-action", () => ({
	adminAction: vi.fn(
		(_opts: unknown, fn: (...args: unknown[]) => unknown) => fn,
	),
}));
vi.mock("@/lib/safe-action-shared", () => ({ actionOk: vi.fn(() => "ok") }));
vi.mock("@/lib/services/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/services/rcon", () => ({ rcon: { updateConfig: vi.fn() } }));

describe("saveEmulatorSettings", () => {
	it("saves settings and calls rcon update", async () => {
		const handler = (await import("./emulator").then(
			(m) => m.saveEmulatorSettings,
		)) as unknown as (ctx: {
			data: { settings: Record<string, string> };
			session: { user: { id: string } };
		}) => Promise<string>;

		const result = await handler({
			data: { settings: { key1: "val1", key2: "val2" } },
			session: { user: { id: "1" } },
		});

		expect(insertValues).toHaveBeenCalledTimes(2);
		expect(rcon.updateConfig).toHaveBeenCalled();
		expect(result).toBe("ok");
	});
});
