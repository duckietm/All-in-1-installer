import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import {
	detectMemoryLimitMb,
	heapLimitMb,
	runtimeNodeOptions,
} from "./docker-start.mjs";

it("imports runtime validation without starting the CMS", () => {
	const result = spawnSync(
		process.execPath,
		[
			"--input-type=module",
			"-e",
			"import {validateRuntime} from './scripts/docker-start.mjs';try{validateRuntime({});process.exit(1)}catch(error){if(!error.message.startsWith('Invalid runtime configuration'))throw error}",
		],
		{ encoding: "utf8" },
	);
	assert.equal(result.status, 0, result.stderr);
});

describe("heap limit", () => {
	it("leaves headroom for the memory V8 does not account for", () => {
		// 4 GB cgroup limit -> a 2867 MB heap, well under the ceiling.
		expect(heapLimitMb(4 * 1024 ** 3)).toBe(2867);
		expect(heapLimitMb(6 * 1024 ** 3)).toBe(4300);
	});

	it("clamps to a floor and a ceiling", () => {
		// Too small to run a Next.js server at all: floor wins.
		expect(heapLimitMb(256 * 1024 ** 2)).toBe(512);
		// A huge or absent limit must not turn into a 100 GB heap.
		expect(heapLimitMb(64 * 1024 ** 3)).toBe(8192);
		expect(heapLimitMb(Number.NaN)).toBe(8192);
		expect(heapLimitMb(0)).toBe(8192);
	});
});

describe("cgroup detection", () => {
	const asReader = (contents) => (path) => {
		if (!(path in contents)) throw new Error(`ENOENT: ${path}`);
		return contents[path];
	};

	it("reads the cgroup v2 limit", () => {
		expect(
			detectMemoryLimitMb(
				asReader({ "/sys/fs/cgroup/memory.max": "4294967296" }),
			),
		).toBe(2867);
	});

	it("falls back to cgroup v1 when v2 is absent", () => {
		expect(
			detectMemoryLimitMb(
				asReader({
					"/sys/fs/cgroup/memory.max": "",
					"/sys/fs/cgroup/memory/memory.limit_in_bytes": "6442450944",
				}),
			),
		).toBe(4300);
	});

	it("treats an unlimited cgroup as no limit at all", () => {
		// cgroup v1 reports "max"; a bare sentinel means the same thing.
		expect(
			detectMemoryLimitMb(asReader({ "/sys/fs/cgroup/memory.max": "max" })),
		).toBe(8192);
		expect(
			detectMemoryLimitMb(
				asReader({
					"/sys/fs/cgroup/memory/memory.limit_in_bytes": "9223372036854771712",
				}),
			),
		).toBe(8192);
	});

	it("falls back when neither cgroup file is readable", () => {
		expect(
			detectMemoryLimitMb(() => {
				throw new Error("ENOENT");
			}),
		).toBe(8192);
	});
});

describe("NODE_OPTIONS", () => {
	it("adds the cap when none is set", () => {
		expect(runtimeNodeOptions("", 2867)).toBe("--max-old-space-size=2867");
		expect(runtimeNodeOptions(undefined, 2867)).toBe(
			"--max-old-space-size=2867",
		);
	});

	it("keeps unrelated options already present", () => {
		expect(runtimeNodeOptions("--no-warnings", 2867)).toBe(
			"--no-warnings --max-old-space-size=2867",
		);
	});

	it("never overrides an explicit operator choice", () => {
		expect(runtimeNodeOptions("--max-old-space-size=8192", 2867)).toBe(
			"--max-old-space-size=8192",
		);
	});
});
