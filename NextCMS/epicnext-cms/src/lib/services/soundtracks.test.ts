// @ts-nocheck
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fsMock = vi.hoisted(() => ({
	mkdir: vi.fn(),
	writeFile: vi.fn(),
	unlink: vi.fn(),
}));

const musicMetadataMock = vi.hoisted(() => ({
	parseBuffer: vi.fn(),
}));

vi.mock("node:fs", () => ({ promises: fsMock }));
vi.mock("music-metadata", () => musicMetadataMock);

import { promises as fs } from "node:fs";
import {
	deleteSoundtrackFile,
	ensureSoundtrackDir,
	extractMp3Duration,
	getSoundtrackPath,
	writeSoundtrackFile,
} from "./soundtracks";

describe("getSoundtrackPath", () => {
	it("rejects unsafe codes", () => {
		expect(() => getSoundtrackPath("../evil")).toThrow(
			"Unsafe soundtrack code",
		);
	});
	it("joins the safe code into the soundtrack dir", () => {
		expect(getSoundtrackPath("song").endsWith(join("mp3", "song.mp3"))).toBe(
			true,
		);
	});
});

describe("ensureSoundtrackDir", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});
	it("creates the dir recursively", async () => {
		fsMock.mkdir.mockResolvedValue(undefined);
		await ensureSoundtrackDir();
		expect(fs.mkdir).toHaveBeenCalled();
	});
});

describe("writeSoundtrackFile", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});
	it("creates dir and writes the buffer", async () => {
		fsMock.mkdir.mockResolvedValue(undefined);
		fsMock.writeFile.mockResolvedValue(undefined);
		await writeSoundtrackFile("track", Buffer.from("mp3data"));
		expect(fs.mkdir).toHaveBeenCalled();
		expect(fs.writeFile).toHaveBeenCalledWith(
			expect.stringContaining("track.mp3"),
			Buffer.from("mp3data"),
		);
	});
});

describe("deleteSoundtrackFile", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});
	it("ignores ENOENT errors", async () => {
		fsMock.unlink.mockRejectedValue(
			Object.assign(new Error("gone"), { code: "ENOENT" }),
		);
		await expect(deleteSoundtrackFile("track")).resolves.toBeUndefined();
	});
	it("rethrows other errors", async () => {
		fsMock.unlink.mockRejectedValue(new Error("permission denied"));
		await expect(deleteSoundtrackFile("track")).rejects.toThrow(
			"permission denied",
		);
	});
});

describe("extractMp3Duration", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});
	it("returns rounded duration", async () => {
		musicMetadataMock.parseBuffer.mockResolvedValue({
			format: { duration: 63.7 },
		});
		await expect(extractMp3Duration(Buffer.from("x"))).resolves.toBe(64);
	});
	it("returns 0 for invalid durations", async () => {
		musicMetadataMock.parseBuffer.mockResolvedValue({
			format: { duration: -1 },
		});
		await expect(extractMp3Duration(Buffer.from("x"))).resolves.toBe(0);
	});
	it("returns 0 when parsing throws", async () => {
		musicMetadataMock.parseBuffer.mockRejectedValue(new Error("bad"));
		await expect(extractMp3Duration(Buffer.from("x"))).resolves.toBe(0);
	});
});
