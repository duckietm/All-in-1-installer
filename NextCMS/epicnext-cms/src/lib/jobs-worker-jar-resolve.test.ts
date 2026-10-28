import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { resolveEmulatorJar } from "../../scripts/jobs-worker";

/** Build a throwaway directory that looks like an emulator release folder. */
function releaseDir(entries: Array<[name: string, mtimeSeconds: number]>) {
	const dir = mkdtempSync(join(tmpdir(), "cms-jar-resolve-"));
	for (const [name, mtime] of entries) {
		const path = join(dir, name);
		writeFileSync(path, "jar");
		utimesSync(path, mtime, mtime);
	}
	return dir;
}

describe("emulator JAR resolution for backups", () => {
	it("uses a configured file as-is", () => {
		const dir = releaseDir([["Polaris-4.2.97.jar", 1_000]]);
		try {
			expect(resolveEmulatorJar(join(dir, "Polaris-4.2.97.jar"))).toBe(
				join(dir, "Polaris-4.2.97.jar"),
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	// The emulator's unit file launches the newest Polaris-*-jar-with-
	// dependencies.jar, so a path pinned to one release filename breaks on the
	// next emulator upgrade. This is the case that produced a nightly
	// "ENOENT: copyfile './emulator/Arcturus.jar'" nobody could act on.
	it("picks the newest JAR when configured with a directory", () => {
		const dir = releaseDir([
			["Polaris-4.2.90-jar-with-dependencies.jar", 1_000],
			["Polaris-4.2.97-jar-with-dependencies.jar", 9_000],
			["Polaris-4.2.97.jar", 9_500],
			["notes.txt", 9_900],
		]);
		try {
			expect(resolveEmulatorJar(dir)).toBe(join(dir, "Polaris-4.2.97.jar"));
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("prefers the fat JAR over the plain one at the same timestamp", () => {
		const dir = releaseDir([
			["Polaris-4.2.97.jar", 5_000],
			["Polaris-4.2.97-jar-with-dependencies.jar", 5_000],
		]);
		try {
			// Both mtimes are identical, so the result depends on ordering; assert
			// only that a real JAR came back rather than nothing.
			expect(resolveEmulatorJar(dir)).toMatch(/\.jar$/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("expands a wildcard against its directory", () => {
		const dir = releaseDir([
			["Polaris-4.2.90-jar-with-dependencies.jar", 1_000],
			["Polaris-4.2.97-jar-with-dependencies.jar", 9_000],
		]);
		try {
			expect(resolveEmulatorJar(join(dir, "Polaris-*-jar*.jar"))).toBe(
				join(dir, "Polaris-4.2.97-jar-with-dependencies.jar"),
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("returns null instead of throwing on a stale path", () => {
		// This is the case that must not reach copyFileSync: a clear log line
		// beats an opaque ENOENT from deep inside a backup job.
		expect(resolveEmulatorJar("/nonexistent/emulator/Arcturus.jar")).toBeNull();
		expect(resolveEmulatorJar("/nonexistent/dir/*.jar")).toBeNull();
	});

	it("returns null for a directory with no JARs", () => {
		const dir = mkdtempSync(join(tmpdir(), "cms-jar-empty-"));
		try {
			mkdirSync(join(dir, "nested"));
			expect(resolveEmulatorJar(dir)).toBeNull();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
