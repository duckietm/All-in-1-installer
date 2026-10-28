import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/services/furni-asset-dirs", () => ({
	getGamedataRoot: vi.fn(async () => ""),
}));

import { resolveGamedataFile } from "./asset-paths";

describe("resolveGamedataFile", () => {
	it("uses absolute external paths as-is", async () => {
		const absolutePath = path.win32.join(
			"E:\\",
			"Users",
			"simol",
			"Desktop",
			"DEV",
			"Nitro-Files",
			"nitro-assets",
			"gamedata",
			"FigureMap.json",
		);

		expect(await resolveGamedataFile(absolutePath, "FigureMap.json")).toBe(
			absolutePath,
		);
	});
});
