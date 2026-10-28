// @ts-nocheck
// @vitest-environment node
import { promises as fs } from "node:fs";
import os from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getRuntimePath } from "@/lib/utils/runtime-path";

const { getGamedataRootMock, getNitroFilesRootMock, settingGetMock } =
	vi.hoisted(() => ({
		getGamedataRootMock: vi.fn(),
		getNitroFilesRootMock: vi.fn(),
		settingGetMock: vi.fn(),
	}));

vi.mock("@/lib/services/furni-asset-dirs", () => ({
	getGamedataRoot: getGamedataRootMock,
	getNitroFilesRoot: getNitroFilesRootMock,
}));

vi.mock("@/lib/services/site-settings", () => ({
	siteSettings: { get: settingGetMock },
}));

import { getFurnitureDataPath, writeFurniData } from "./furni-data";

describe("writeFurniData production mirror", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(
			getRuntimePath(os.tmpdir(), "furni-data-paths-"),
		);
		getNitroFilesRootMock.mockResolvedValue("");
		getGamedataRootMock.mockResolvedValue(getRuntimePath(tempDir, "Gamedata"));
		settingGetMock.mockImplementation(
			async (key: string, fallback: string | null = null) => {
				if (key === "furni_data_url") {
					return getRuntimePath(tempDir, "cms", "FurnitureData.json");
				}
				if (key === "furni_data_mirror_path") return "";
				return fallback;
			},
		);
	});

	afterEach(async () => {
		await fs.rm(tempDir, { recursive: true, force: true });
		vi.clearAllMocks();
	});

	it("writes metadata into the config directory served by production", async () => {
		const data = { roomitemtypes: { furnitype: [{ id: 123 }] } };

		await writeFurniData(data);

		const livePath = getRuntimePath(
			tempDir,
			"Gamedata",
			"config",
			"FurnitureData.json",
		);
		await expect(fs.readFile(livePath, "utf-8")).resolves.toBe(
			JSON.stringify(data),
		);
	});

	it("resolves the default JSON file from the production Gamedata root", async () => {
		settingGetMock.mockImplementation(
			async (_key: string, fallback: string | null = null) => fallback,
		);

		await expect(getFurnitureDataPath()).resolves.toBe(
			getRuntimePath(tempDir, "Gamedata", "config", "FurnitureData.json"),
		);
	});
});
