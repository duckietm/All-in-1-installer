// @ts-nocheck
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { digestFile } from "@/features/catalog/releases/files";
import {
	CATALOG_RELEASE_MANIFEST_PATH,
	createReleaseManifest,
} from "@/features/catalog/releases/manifest";
import { publishCatalogFiles } from "./catalog-git-core";

async function fixture() {
	const root = await mkdtemp(
		path.join(os.tmpdir(), "catalog-release-publish-"),
	);
	const remote = path.join(root, "remote.git");
	const checkout = path.join(root, "checkout");
	const git = (...args: string[]) =>
		execFileSync("git", args, {
			cwd: checkout,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		}).trim();
	execFileSync("git", ["init", "--bare", remote], { stdio: "ignore" });
	await mkdir(checkout);
	git("init", "-b", "catalog");
	git("config", "core.autocrlf", "false");
	git("config", "user.name", "Test");
	git("config", "user.email", "test@example.invalid");
	await writeFile(path.join(checkout, "README.md"), "fixture\n");
	git("add", ".");
	git("commit", "-m", "Initialize");
	git("remote", "add", "origin", remote);
	git("push", "-u", "origin", "catalog");
	const source = path.join(root, "asset");
	await writeFile(source, "asset\r\n");
	const { bytes, sha256 } = await digestFile(source);
	const manifest = createReleaseManifest([
		{ path: "Gamedata/icons/chair.png", bytes, sha256 },
	]);
	const manifestSource = path.join(root, "manifest.json");
	await writeFile(manifestSource, JSON.stringify(manifest));
	const options = {
		checkout,
		remote,
		branch: "catalog",
		files: [
			{ source, target: "Gamedata/icons/chair.png" },
			{ source: manifestSource, target: CATALOG_RELEASE_MANIFEST_PATH },
		],
	};
	return { options, git, manifestSource, source };
}

// Each test drives real `git` processes against a local bare remote: init,
// pull --rebase, ls-files --stage, push and rev-parse. That is deliberately
// real work, so the cost is process spawns competing with every other Vitest
// worker for CPU. On CI these land at 23-30s each, which is why the default
// 10s and even a hand-picked 30s are too tight; the first case measures two
// publications to prove identical data does not create a second commit.
// Keep the override well clear of a genuine hang.
const GIT_PUBLICATION_TIMEOUT = 120_000;

describe("catalog release Git publication", () => {
	it(
		"publishes exact files and does not create another commit for identical data",
		async () => {
			const { options, git } = await fixture();
			const first = await publishCatalogFiles(options);
			expect(await publishCatalogFiles(options)).toBe(first);
			expect(git("rev-list", "--count", "HEAD")).toBe("2");
			expect(
				await readFile(
					path.join(options.checkout, "Gamedata/icons/chair.png"),
					"utf8",
				),
			).toBe("asset\r\n");
		},
		GIT_PUBLICATION_TIMEOUT,
	);
	it(
		"rejects a snapshot changed after manifest creation and restores a clean checkout",
		async () => {
			const { options, source, git } = await fixture();
			const head = git("rev-parse", "HEAD");
			await writeFile(source, "tampered");
			await expect(publishCatalogFiles(options)).rejects.toThrow(
				"bytes mismatch",
			);
			expect(git("rev-parse", "HEAD")).toBe(head);
			expect(git("status", "--porcelain")).toBe("");
		},
		GIT_PUBLICATION_TIMEOUT,
	);
	it(
		"rejects Git newline normalization before creating a commit",
		async () => {
			const { options, git } = await fixture();
			await writeFile(
				path.join(options.checkout, ".gitattributes"),
				"Gamedata/** text eol=lf\n",
			);
			git("add", ".gitattributes");
			git("commit", "-m", "Normalize newlines");
			git("push");
			const head = git("rev-parse", "HEAD");
			await expect(publishCatalogFiles(options)).rejects.toThrow(
				"Staged catalog bytes mismatch",
			);
			expect(git("rev-parse", "HEAD")).toBe(head);
			expect(git("status", "--porcelain")).toBe("");
		},
		GIT_PUBLICATION_TIMEOUT,
	);
});
