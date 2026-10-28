// @ts-nocheck
import { expect, it } from "vitest";
import { gitProcessEnvironment } from "./git-process-environment";

it("does not pass parent repository paths into catalog Git commands", () => {
	const env = gitProcessEnvironment({
		NODE_ENV: "test",
		PATH: "tools",
		GIT_DIR: "parent",
		GIT_WORK_TREE: "parent",
		GIT_INDEX_FILE: "parent-index",
		GIT_COMMON_DIR: "common",
		GIT_AUTHOR_NAME: "Catalog",
	});
	expect(env.GIT_DIR).toBeUndefined();
	expect(env.GIT_WORK_TREE).toBeUndefined();
	expect(env.GIT_INDEX_FILE).toBeUndefined();
	expect(env.GIT_COMMON_DIR).toBeUndefined();
	expect(env.PATH).toBe("tools");
	expect(env.GIT_AUTHOR_NAME).toBe("Catalog");
});
