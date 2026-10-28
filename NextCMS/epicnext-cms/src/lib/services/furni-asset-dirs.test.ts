// @ts-nocheck
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getRuntimePath } from "@/lib/utils/runtime-path";

const { existsSyncMock, settingGetMock } = vi.hoisted(() => ({
	existsSyncMock: vi.fn(),
	settingGetMock: vi.fn(),
}));

vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs")>();
	return { ...actual, existsSync: existsSyncMock };
});

vi.mock("@/lib/services/site-settings", () => ({
	siteSettings: { get: settingGetMock },
}));

import { getFurniAssetWriteTargets } from "./furni-asset-dirs";

const primary = {
	swfDir: getRuntimePath("test-assets", "primary", "swf"),
	iconDir: getRuntimePath("test-assets", "primary", "icons"),
	nitroDir: getRuntimePath("test-assets", "primary", "furniture"),
};

function configureSettings(values: Record<string, string>): void {
	settingGetMock.mockImplementation(
		async (key: string, fallback: string | null = null) =>
			values[key] ?? fallback,
	);
}

describe("getFurniAssetWriteTargets", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		existsSyncMock.mockReturnValue(false);
	});

	it("maps a configured production Gamedata root to the directories served by Nitro", async () => {
		const gamedataRoot = getRuntimePath("test-assets", "Gamedata");
		configureSettings({
			furni_swf_dir: primary.swfDir,
			furni_icon_dir: primary.iconDir,
			furni_nitro_dir: primary.nitroDir,
			nitro_files_root: "",
			gamedata_root: gamedataRoot,
		});

		const targets = await getFurniAssetWriteTargets();

		expect(targets.mirrorDirs).toContainEqual({
			swfDir: primary.swfDir,
			iconDir: getRuntimePath(gamedataRoot, "icons"),
			nitroDir: getRuntimePath(gamedataRoot, "bundled", "furniture"),
		});
	});

	it("does not add a production mirror when no root is configured or present", async () => {
		configureSettings({
			furni_swf_dir: primary.swfDir,
			furni_icon_dir: primary.iconDir,
			furni_nitro_dir: primary.nitroDir,
			nitro_files_root: "",
			gamedata_root: "",
		});

		const targets = await getFurniAssetWriteTargets();

		expect(targets.mirrorDirs).toEqual([]);
	});

	it("does not duplicate a Gamedata layout already used as the primary target", async () => {
		const gamedataRoot = getRuntimePath("test-assets", "Gamedata");
		configureSettings({
			furni_swf_dir: primary.swfDir,
			furni_icon_dir: getRuntimePath(gamedataRoot, "icons"),
			furni_nitro_dir: getRuntimePath(gamedataRoot, "bundled", "furniture"),
			nitro_files_root: "",
			gamedata_root: gamedataRoot,
		});

		const targets = await getFurniAssetWriteTargets();

		expect(targets.mirrorDirs).toEqual([]);
	});
});
