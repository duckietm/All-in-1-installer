// @ts-nocheck
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { tryRemoveLocalPhotoFile } from "@/lib/admin/photo-files";

describe("setTradeLock drizzle + RCON contract", () => {
	const src = readFileSync("src/actions/bulk-users.ts", "utf8");
	const rconSrc = readFileSync("src/lib/services/rcon.ts", "utf8");

	it("writes sanctions + users_settings via Drizzle", () => {
		expect(src).toContain("@/lib/db");
		expect(src).toContain("UsersSettings");
		expect(src).toContain("Sanctions");
		expect(src).toContain("canTrade");
		expect(src).toContain("tradeLockedUntil");
		expect(src).toMatch(/export async function setTradeLock/);
		const fn = src.slice(src.indexOf("export async function setTradeLock"));
		expect(fn).toContain("db.");
	});

	it("syncs live hotel via RCON settradelock + alert + disconnect", () => {
		expect(rconSrc).toContain("settradelock");
		expect(rconSrc).toContain("setTradeLock(userId: number, locked: boolean)");
		expect(src).toContain("rcon.setTradeLock");
		expect(src).toContain("rcon.alertUser");
		expect(src).toContain("rcon.disconnectUser");
	});
});

describe("admin-photos drizzle contract", () => {
	const src = readFileSync("src/actions/admin-photos.ts", "utf8");

	it("deletes via Drizzle CameraWeb and attempts local file purge", () => {
		expect(src).toContain("@/lib/db");
		expect(src).toContain("CameraWeb");
		expect(src).toContain("tryRemoveLocalPhotoFile");
		expect(src).toContain("@/lib/db");
		expect(src).toContain('revalidatePath("/photos")');
	});
});

describe("tryRemoveLocalPhotoFile", () => {
	it("rejects path traversal and remote CDN urls", async () => {
		expect(await tryRemoveLocalPhotoFile("https://cdn.example/photo.png")).toBe(
			false,
		);
		expect(await tryRemoveLocalPhotoFile("/../../etc/passwd")).toBe(false);
		expect(await tryRemoveLocalPhotoFile("")).toBe(false);
	});
});
