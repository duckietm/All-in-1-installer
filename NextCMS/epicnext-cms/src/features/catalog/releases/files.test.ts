import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { digestFile, verifyStagedRelease } from "./files";

describe("release file integrity", () => {
	it("matches Git raw blob identity and rejects staged bytes changed by filters", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "release-index-"));
		const git = (...args: string[]) =>
			execFileSync("git", args, { cwd: root, encoding: "utf8" });
		git("init");
		git("config", "core.autocrlf", "false");
		await writeFile(path.join(root, "payload"), "first\n");
		const expected = await digestFile(path.join(root, "payload"));
		expect(expected.gitSha1).toBe(
			git("hash-object", "--no-filters", "payload").trim(),
		);
		git("add", "payload");
		const files = new Map([["payload", expected]]);
		expect(() =>
			verifyStagedRelease(git("ls-files", "--stage", "-z"), "sha1", files),
		).not.toThrow();
		await writeFile(path.join(root, "payload"), "other\n");
		git("add", "payload");
		expect(() =>
			verifyStagedRelease(git("ls-files", "--stage", "-z"), "sha1", files),
		).toThrow("Staged catalog bytes mismatch");
	});
	it("rejects missing and nonregular staged entries", () => {
		const digest = { bytes: 0, sha256: "", gitSha1: "abc", gitSha256: "def" };
		const files = new Map([["Gamedata/icons/a.png", digest]]);
		expect(() => verifyStagedRelease("", "sha1", files)).toThrow();
		expect(() =>
			verifyStagedRelease(
				"120000 abc 0\tGamedata/icons/a.png\0",
				"sha1",
				files,
			),
		).toThrow();
	});
});
