// @ts-nocheck
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requirePermission } from "@/lib/admin/guard";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { PERMS } from "@/lib/permission-slugs";
import { siteSettings } from "@/lib/services/site-settings";
import { deleteFavicon, saveFavicon } from "./save-favicon";
import { saveLogo } from "./save-logo";

const database = vi.hoisted(() => ({
	upsert: vi.fn(),
	values: vi.fn(),
	where: vi.fn(),
}));
vi.mock("@/lib/admin/guard", () => ({ requirePermission: vi.fn() }));
vi.mock("@/lib/permissions", () => import("@/lib/permission-slugs"));
vi.mock("@/lib/db", () => ({
	db: {
		insert: vi.fn(() => ({ values: database.values })),
		delete: vi.fn(() => ({ where: database.where })),
	},
	WebsiteSetting: { key: "key" },
}));
vi.mock("@/lib/media-storage", () => ({
	resolveMediaPath: (name: string) => path.resolve("storage/test-media", name),
}));
vi.mock("@/lib/services/site-settings", () => ({
	siteSettings: { get: vi.fn(), reload: vi.fn() },
}));
vi.mock("node:fs/promises", () => ({
	mkdir: vi.fn(),
	writeFile: vi.fn(),
	unlink: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }));

beforeEach(() => {
	vi.resetAllMocks();
	vi.mocked(requirePermission).mockResolvedValue({
		id: 1,
		rank: 7,
		username: "editor",
	});
	database.values.mockReturnValue({ onDuplicateKeyUpdate: database.upsert });
});

function form(file: File | string) {
	const data = new FormData();
	data.set("file", file);
	return data;
}

function noMutation() {
	expect(mkdir).not.toHaveBeenCalled();
	expect(writeFile).not.toHaveBeenCalled();
	expect(unlink).not.toHaveBeenCalled();
	expect(db.insert).not.toHaveBeenCalled();
	expect(db.delete).not.toHaveBeenCalled();
	expect(siteSettings.reload).not.toHaveBeenCalled();
}

for (const [name, save] of [
	["logo", saveLogo],
	["favicon", saveFavicon],
] as const) {
	describe(name, () => {
		it.each(["anonymous", "settings viewer"])(
			"denies %s before reading the upload or settings",
			async () => {
				const denied = new Error("denied");
				vi.mocked(requirePermission).mockRejectedValue(denied);
				const data = new FormData();
				const read = vi.spyOn(data, "get");
				await expect(save(data)).rejects.toBe(denied);
				expect(requirePermission).toHaveBeenCalledWith(PERMS.SETTINGS_EDIT);
				expect(read).not.toHaveBeenCalled();
				expect(siteSettings.get).not.toHaveBeenCalled();
				noMutation();
			},
		);

		it.each([
			[
				"SVG",
				"image/svg+xml",
				'<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>',
			],
			["SVG disguised as PNG", "image/png", '<svg onload="alert(1)"/>'],
			[
				"HTML disguised as PNG",
				"image/png",
				"<!doctype html><script>alert(1)</script>",
			],
			["unknown MIME", "application/octet-stream", "not an image"],
		])(
			"rejects %s without changing files or settings",
			async (_name, type, content) => {
				const result = await save(
					form(new File([content], "upload.png", { type })),
				);
				expect(result.success).toBe(false);
				noMutation();
			},
		);

		it("rejects a form string as a file", async () => {
			expect((await save(form("image/png"))).success).toBe(false);
			noMutation();
		});

		it("rejects files above 2 MiB before reading their contents", async () => {
			const file = new File(
				[new Uint8Array(2 * 1024 * 1024 + 1)],
				"large.png",
				{ type: "image/png" },
			);
			const data = form(file);
			const read = vi.spyOn(data.get("file") as File, "arrayBuffer");
			expect((await save(data)).success).toBe(false);
			expect(read).not.toHaveBeenCalled();
			noMutation();
		});

		it.each(["png", "jpeg", "gif", "webp"] as const)(
			"keeps legitimate %s uploads working",
			async (format) => {
				const image = await sharp({
					create: { width: 2, height: 2, channels: 4, background: "#ff0000" },
				})
					.toFormat(format)
					.toBuffer();
				const result = await save(
					form(
						new File([new Uint8Array(image)], "upload", {
							type: `image/${format}`,
						}),
					),
				);
				expect(requirePermission).toHaveBeenCalledWith(PERMS.SETTINGS_EDIT);
				expect(result.success).toBe(true);
				expect(result.url).toMatch(
					new RegExp(
						`^/cms_api/media/${name}/[^/]+\\.${format === "jpeg" ? "jpg" : format}$`,
					),
				);
				expect(writeFile).toHaveBeenCalledWith(expect.any(String), image);
				expect(database.values).toHaveBeenCalledWith(
					expect.objectContaining({ key: `cms_${name}`, value: result.url }),
				);
			},
		);

		it("rejects a raster image whose bytes disagree with its MIME", async () => {
			const image = await sharp({
				create: { width: 1, height: 1, channels: 4, background: "#000" },
			})
				.png()
				.toBuffer();
			expect(
				(
					await save(
						form(
							new File([new Uint8Array(image)], "wrong.gif", {
								type: "image/gif",
							}),
						),
					)
				).success,
			).toBe(false);
			noMutation();
		});

		it("does not reveal filesystem errors to the caller", async () => {
			const image = await sharp({
				create: { width: 1, height: 1, channels: 4, background: "#000" },
			})
				.png()
				.toBuffer();
			vi.mocked(writeFile).mockRejectedValue(
				new Error("EACCES /private/media/secret.png"),
			);
			const result = await save(
				form(
					new File([new Uint8Array(image)], "logo.png", { type: "image/png" }),
				),
			);
			expect(result.success).toBe(false);
			expect(result.error).not.toMatch(/EACCES|private|secret/);
			expect(logger.error).toHaveBeenCalled();
		});
	});
}

it("denies favicon deletion before reading settings or touching files", async () => {
	const denied = new Error("denied");
	vi.mocked(requirePermission).mockRejectedValue(denied);
	await expect(deleteFavicon()).rejects.toBe(denied);
	expect(requirePermission).toHaveBeenCalledWith(PERMS.SETTINGS_EDIT);
	expect(siteSettings.get).not.toHaveBeenCalled();
	noMutation();
});

it.each(["image/x-icon", "image/vnd.microsoft.icon"])(
	"accepts a valid ICO favicon with MIME %s",
	async (type) => {
		const png = await sharp({
			create: { width: 1, height: 1, channels: 4, background: "#000" },
		})
			.png()
			.toBuffer();
		const directory = Buffer.alloc(22);
		directory.writeUInt16LE(1, 2);
		directory.writeUInt16LE(1, 4);
		directory[6] = 1;
		directory[7] = 1;
		directory.writeUInt16LE(1, 10);
		directory.writeUInt16LE(32, 12);
		directory.writeUInt32LE(png.length, 14);
		directory.writeUInt32LE(22, 18);
		const bytes = Buffer.concat([directory, png]);
		const result = await saveFavicon(
			form(new File([new Uint8Array(bytes)], "icon.ico", { type })),
		);
		expect(result.success).toBe(true);
		expect(writeFile).toHaveBeenCalledWith(
			expect.stringMatching(/\.ico$/),
			bytes,
		);
	},
);

it("rejects active content behind a forged ICO header", async () => {
	const bytes = Buffer.concat([
		Buffer.from([0, 0, 1, 0, 1, 0]),
		Buffer.from('<svg onload="alert(1)"/>'),
	]);
	expect(
		(
			await saveFavicon(
				form(
					new File([new Uint8Array(bytes)], "icon.ico", {
						type: "image/x-icon",
					}),
				),
			)
		).success,
	).toBe(false);
	noMutation();
});

it("rejects a truncated image with a valid PNG signature", async () => {
	const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
	expect(
		(
			await saveLogo(
				form(new File([bytes], "image.png", { type: "image/png" })),
			)
		).success,
	).toBe(false);
	noMutation();
});

it("rejects disguised SVG before invoking any image decoder", async () => {
	const metadata = vi.spyOn(sharp.prototype, "metadata");
	try {
		const file = new File(
			['<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'],
			"logo.png",
			{ type: "image/png" },
		);
		expect((await saveLogo(form(file))).success).toBe(false);
		expect(metadata).not.toHaveBeenCalled();
		noMutation();
	} finally {
		metadata.mockRestore();
	}
});
